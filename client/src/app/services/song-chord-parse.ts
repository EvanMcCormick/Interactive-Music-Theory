import { ALTER_MAX, ALTER_MIN } from '../models/progression-normalize';
import type { ChordDegree, ProgressionKey } from '../models/progression.model';
import { SpelledNote, parseNoteName, pitchClassOf } from './note-spelling';
import { isNameable } from './progression-chord-names';
import { ChordIdentity, effectiveChord, isHeptatonic } from './progression-harmony';
import { nearest, parseChord, reduce } from './progression-parse';
import { atDegree, expressInKey } from './progression-recognise';
import { tonicSpelling } from './progression-spelling';

/**
 * Reading a chord typed into the song sheet's `[` field: a name (`Am`, `Bb7`,
 * `F/A`) or a numeral (`vi`, `♭VII`, `V7`), into the `ChordDegree` a chord atom
 * stores.
 *
 * Pure, with no Angular. The app reads chords from *notes* already
 * (`parseChord`) and writes a reading into a key already (`expressInKey`), and
 * this module is the small piece in front of them that neither had: it turns the
 * text into the chord's intervals above a root, and hands those to the same two
 * doors recognition uses. So a typed chord is decided - base shape, suspension,
 * extensions, which fields the key is left to answer - by exactly the rules a
 * chord played into the roll is, and `leadSheetNameOf` prints it back through
 * the same identity. `song-chord-parse.spec.ts` holds the two to a round trip
 * over every chord the app's scales build.
 *
 * ## What the field reads
 *
 * **A name** is a root (`A`-`G`, then up to two of `b`/`#`/`♭`/`♯`), a suffix,
 * and an optional `/Bass`. The suffix is a small grammar rather than a list, so
 * that everything `leadSheetNameOf` can print is something this can read:
 *
 *     [m|min|-] [dim|°|o|ø|aug|+] [maj|Maj|M|Δ] [6|6/9|add9|add2] [7|9|11|13]
 *     [b5|#5|b9|#9|#11|b13 ...] [sus2|sus4|sus]
 *
 * which covers every symbol in the chord catalogue (`CHORD_CATEGORIES`) except
 * `7b5`, plus the progression page's own spaced names (`C Maj7`, `A min`) and
 * the usual aliases (`M7`, `Δ`, `-7`, `m7b5`, `ø`, `m(maj7)`, `69`). Brackets
 * and commas around alterations are ignored, so `C7(b9)` is `C7b9`. An
 * alteration above the height fills the extensions under it, which is what a
 * chord of stacked thirds is: `C7#11` is read as `C9#11`, and printed so.
 *
 * **A numeral** is up to two of `b`/`#`/`♭`/`♯`, `I`-`VII` in one case, and the
 * same figure grammar without the `m` - the case is the third, as it is in
 * `romanNumeral`. Numerals are the key's own mode's, as the progression page's
 * are: `VII` in A aeolian is a G major triad.
 *
 * ## The letter typed is the numeral meant
 *
 * A name is written on the degree its **letter** names, and only falls back to
 * `expressInKey`'s ranking when that letter is too far from the root for the
 * model to store (more than a double accidental). `F#` in C is therefore `♯IV`
 * and `Gb` is `♭V`: one pitch class, two chords on the sheet, each printed back
 * as typed. That is the ruling `keptNumeral` records for recognition - a root
 * outside the key has two numerals, and what the user wrote is the evidence of
 * which they meant - and it is also what makes the round trip exact: the sheet
 * spells a root by its degree's letter, so a chord written on the typed letter
 * comes back spelled as typed. `Cb`, `E#` and `B#` follow from the same rule and
 * need nothing of their own.
 *
 * ## What it refuses, and why it never guesses
 *
 * An empty field; a key whose scale cannot build chords; a root that is not a
 * note; a suffix or alteration it does not read, named in the reason; a power
 * chord; a shape the model has no quality for (`7b5`); a numeral in mixed case,
 * past `VII`, or with a sign its case contradicts; a secondary numeral (`V/V`),
 * which names a function rather than a root; and **a slash bass that is not a
 * note of the chord**. The model stores a bass only as an inversion - an index
 * into the chord's own notes - and `expressInKey` reads any other bass as root
 * position, so `C/D` would be stored as a plain C with the D silently gone. The
 * field refuses it and says why instead.
 *
 * ## Two kinds of chord it reads back under another name
 *
 * The parse works on pitch classes, so where two readings sound the same pitch
 * classes it takes the one `parseChord` prefers, and the sheet then prints that
 * one. The notes are the same either way; the spec counts both and holds them
 * to exactly that.
 *
 *  - **A chord that sounds one pitch class twice** - a suspension tall enough to
 *    reach the extension it doubles (`Cmaj9sus2`, whose sus2 is its ninth), or a
 *    diminished seventh's thirteenth - is read at the shorter height. The voicing
 *    loses the doubled octave.
 *  - **A sus2 carrying a ♯9** is read as the minor chord with a ninth
 *    (`Cmaj7#9sus2` as `CmMaj9`), because the ♯9 is the minor third's pitch class
 *    and `parseChord` tries a third before a suspension. Only exotic scales build
 *    one unasked.
 */

/** What the field makes of a typed chord. */
export type TypedChord =
  | { kind: 'chord'; degree: ChordDegree }
  | { kind: 'refused'; reason: string };

const EMPTY_REASON = 'Type a chord name, such as Am, or a numeral, such as vi.';

const NO_CHORDS_REASON =
  "This key's scale can't build chords; choose a seven-note scale for the song.";

const MIXED_CASE_REASON =
  'Write a numeral in one case: VI for a major chord, vi for a minor one.';

const SECONDARY_REASON =
  'Secondary numerals like V/V are not read here; type the chord name instead.';

const POWER_CHORD_REASON =
  'A power chord has no third, and a chord here needs one (or a sus2 or sus4 in its place).';

const ROMAN_NUMERALS: readonly string[] = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** An accidental prefix, a run of numeral letters, and whatever follows. */
const NUMERAL = /^([b#]*)([IViv]+)(.*)$/;

/** A slash naming a numeral rather than a note: `V/V`, `V7/vi`. */
const SECONDARY = /\/[b#]*[IViv]/;

/** A root: one capital letter and up to two of one accidental. */
const ROOT = /^[A-G](?:#{1,2}|b{1,2})?/;

/**
 * The suffix grammar in the header, one optional group per slot, in the order a
 * chart writes them. `m(?!aj)` keeps `maj` from being read as a minor `m`.
 */
const FIGURE =
  /^(min|m(?!aj)|-)?(dim|°|o|ø|aug|\+)?(maj|Maj|M|Δ)?(6\/9|6|add9|add2)?(7|9|11|13)?((?:[b#](?:5|9|11|13))*)(sus2|sus4|sus)?$/;

/** One alteration out of the run the grammar's sixth group matched. */
const ALTERATION = /([b#])(5|9|11|13)/g;

/** The natural ninth, eleventh and thirteenth, as `EXTENSION_NATURALS` has them. */
const EXTENSION_NATURALS: readonly number[] = [14, 17, 21];

/** Which extension a height reaches, as an index into the naturals above. */
const TOP_EXTENSION: Readonly<Record<number, number>> = { 7: -1, 9: 0, 11: 1, 13: 2 };

/** The altered extensions a chord can carry, and the interval each puts there. */
const EXTENSION_ALTERATIONS: Readonly<Record<string, { index: number; interval: number }>> = {
  b9: { index: 0, interval: 13 },
  '#9': { index: 0, interval: 15 },
  '#11': { index: 1, interval: 18 },
  b13: { index: 2, interval: 20 }
};

/** Whether the figure's third comes from its own `m`, or from a numeral's case. */
type ThirdFrom = { kind: 'name' } | { kind: 'numeral'; minor: boolean };

/** A figure read into intervals above the root, or the reason it was not. */
type Figure = { intervals: readonly number[] } | { reason: string };

/**
 * A typed chord, read in a key: the degree a chord atom would store, or the
 * reason it was refused - a short sentence the user can act on.
 *
 * `scaleIntervals` is the key's scale, nullable so a caller can hand over
 * `ProgressionKeyContext.chordScaleFor(key)` directly; null or not heptatonic
 * is refused, as the progression palette refuses in a pentatonic key.
 */
export function chordFromText(
  text: string,
  key: ProgressionKey,
  scaleIntervals: readonly number[] | null
): TypedChord {
  const written = normalized(text);
  if (written === '') return refused(EMPTY_REASON);
  if (scaleIntervals === null || !isHeptatonic(scaleIntervals)) return refused(NO_CHORDS_REASON);

  const numeral = NUMERAL.exec(written);
  return numeral === null
    ? namedChord(written, key, scaleIntervals)
    : numeralChord(numeral, written, scaleIntervals);
}

/**
 * The text with its spaces taken out and the musical signs made ASCII.
 *
 * Spaces go everywhere, not only at the ends, because the progression page
 * prints `C Maj7` and `A min` and a user copying one should not be refused for
 * the space. Nothing the grammar reads contains one.
 */
function normalized(text: string): string {
  return text.replace(/\s+/g, '').replace(/♭/g, 'b').replace(/♯/g, '#');
}

function refused(reason: string): TypedChord {
  return { kind: 'refused', reason };
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

function namedChord(
  written: string,
  key: ProgressionKey,
  scaleIntervals: readonly number[]
): TypedChord {
  const { chordText, bassText } = splitBass(written);
  if (chordText === '') return refused('Type the chord before the slash, such as C/E.');

  const rootText = ROOT.exec(chordText)?.[0];
  // `ROOT` matches only what `parseNoteName` reads, so a match always parses;
  // the second test is the type checker's, not a second rule.
  const root = rootText === undefined ? null : parseNoteName(rootText);
  if (rootText === undefined || root === null) return refused(rootReason(chordText));

  const figure = figureOf(chordText.slice(rootText.length), { kind: 'name' });
  if ('reason' in figure) return refused(figure.reason);

  let bass: number | null = null;
  if (bassText !== null) {
    const spelled = parseNoteName(bassText);
    if (spelled === null) {
      return refused(`"${bassText}" after the slash is not a note; write the bass as A to G.`);
    }
    bass = reduce(pitchClassOf(spelled) - key.tonic);
  }

  const identity = identityOf(figure.intervals, reduce(pitchClassOf(root) - key.tonic));
  if (identity === null) return refused(unbuildableReason(chordText));

  if (bass !== null && !soundsPitchClass(identity, bass)) {
    return refused(
      `${bassText} is not a note of ${chordText}, and only a note of the chord can go under the slash.`
    );
  }

  const from = bass ?? identity.root;
  const degree =
    onLetter(identity, root, key, scaleIntervals, from) ??
    expressInKey(identity, scaleIntervals, 0, from);

  return chordOrRefusal(degree, scaleIntervals, chordText);
}

/**
 * The chord and its bass, split at the last slash that is followed by a letter.
 *
 * A slash followed by anything else belongs to the suffix: `C6/9` is a sixth
 * chord with a ninth, and `C6/9/E` is that chord over its third.
 */
function splitBass(written: string): { chordText: string; bassText: string | null } {
  const slash = written.lastIndexOf('/');
  const after = written.slice(slash + 1);

  return slash >= 0 && /^[A-Za-z]/.test(after)
    ? { chordText: written.slice(0, slash), bassText: after }
    : { chordText: written, bassText: null };
}

/**
 * Why the start of the text is not a root, said in the user's terms.
 *
 * A lower-case root is asked to be a capital rather than read, because a
 * lower-case `b` is also the flat that opens a numeral (`bVII`), and reading
 * `bb` as B flat would make the case of one letter decide which of two
 * grammars a chord is in.
 */
function rootReason(chordText: string): string {
  if (/^[a-g]/.test(chordText)) {
    return `Write the root as a capital letter: ${chordText[0].toUpperCase()}${chordText.slice(1)}.`;
  }

  const token = /^[A-Za-z]+/.exec(chordText)?.[0] ?? chordText[0];
  return `"${token}" is not a note: a chord name starts with a letter from A to G, and a numeral with I to VII.`;
}

/**
 * The chord written on the degree its root's letter names, or null when that
 * letter is too far from the root to be a numeral the model can store.
 *
 * See the header for why the letter decides. `atDegree` is handed a degree
 * whose root is the identity's by construction - `alter` is measured from that
 * degree to this root - which is the one check it leaves to its caller.
 */
function onLetter(
  identity: ChordIdentity,
  root: SpelledNote,
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  bass: number
): ChordDegree | null {
  const degree = (root.letter - tonicSpelling(key).letter + 7) % 7;
  const alter = nearest(identity.root - scaleIntervals[degree]);
  if (alter < ALTER_MIN || alter > ALTER_MAX) return null;

  return atDegree(identity, scaleIntervals, { degree, alter }, 0, bass);
}

// ---------------------------------------------------------------------------
// Numerals
// ---------------------------------------------------------------------------

function numeralChord(
  match: RegExpExecArray,
  written: string,
  scaleIntervals: readonly number[]
): TypedChord {
  const [, signs, roman, rest] = match;

  if (!/^(?:b{0,2}|#{0,2})$/.test(signs)) {
    return refused(`"${signs}" is not an accidental; put up to two b or # signs before the numeral.`);
  }

  const upper = roman.toUpperCase();
  if (roman !== upper && roman !== roman.toLowerCase()) return refused(MIXED_CASE_REASON);

  const degree = ROMAN_NUMERALS.indexOf(upper);
  if (degree < 0) return refused(`"${roman}" is not a scale degree; numerals run from I to VII.`);

  if (SECONDARY.test(rest)) return refused(SECONDARY_REASON);

  const figure = figureOf(rest, { kind: 'numeral', minor: roman !== upper });
  if ('reason' in figure) return refused(figure.reason);

  const alter = signs.startsWith('b') ? -signs.length : signs.length;
  const root = reduce(scaleIntervals[degree] + alter);

  const identity = identityOf(figure.intervals, root);
  if (identity === null) return refused(unbuildableReason(written));

  return chordOrRefusal(
    atDegree(identity, scaleIntervals, { degree, alter }, 0, root),
    scaleIntervals,
    written
  );
}

// ---------------------------------------------------------------------------
// The figure, and the two doors it goes through
// ---------------------------------------------------------------------------

/**
 * A suffix or a numeral's figure, read into the intervals of the chord it
 * names above its root - or the reason it cannot be.
 *
 * The intervals need not be in any order and may sit past the octave: they are
 * reduced into a set of pitch classes for `parseChord`, which decides from that
 * set what each note is. That is the point of handing over notes rather than a
 * shape: the field cannot disagree with recognition about what a chord is.
 */
function figureOf(raw: string, third: ThirdFrom): Figure {
  const subject = third.kind === 'name' ? 'chord type' : 'numeral figure';
  // Brackets and commas group alterations on a chart - `C7(b9,#11)` - and mean
  // nothing the grammar needs; `m(maj7)` is the one place they wrap a word.
  const figure = raw.replace(/[(),]/g, '');
  if (figure === '5') return { reason: POWER_CHORD_REASON };

  const parts = FIGURE.exec(figure);
  if (parts === null) return { reason: `"${raw}" is not a ${subject} this app reads.` };

  const [, minorMark, sign, majorMark, added, heightText, alterationText, suspension] = parts;
  const diminished = sign === 'dim' || sign === '°' || sign === 'o';
  const halfDiminished = sign === 'ø';
  const augmented = sign === 'aug' || sign === '+';

  // The third: the name's own `m`, or the numeral's case.
  let minor: boolean;
  if (third.kind === 'name') {
    if (minorMark !== undefined && sign !== undefined) {
      return { reason: `"${raw}" is not a ${subject} this app reads.` };
    }
    minor = minorMark !== undefined || diminished || halfDiminished;
  } else {
    if (minorMark !== undefined) return { reason: `"${raw}" is not a ${subject} this app reads.` };
    if ((diminished || halfDiminished) && !third.minor) {
      return { reason: 'A diminished numeral is written in lower case, such as vii°.' };
    }
    if (augmented && third.minor) {
      return { reason: 'An augmented numeral is written in upper case, such as III+.' };
    }
    minor = third.minor;
  }

  if (suspension !== undefined && (sign !== undefined || (third.kind === 'name' && minor))) {
    return {
      reason: `A sus chord has no third, so it can't also be minor, diminished or augmented: drop the "${minorMark ?? sign}".`
    };
  }

  let fifth = diminished || halfDiminished ? 6 : augmented ? 8 : 7;
  const height = heightText === undefined ? null : Number(heightText);

  // The seventh: a major one wherever the figure says so, a diminished one under
  // `°` with a height, a minor one under any other height and under a bare `ø`.
  let seventh: number | null = null;
  if (majorMark !== undefined) {
    if (majorMark === 'Δ' || height !== null) seventh = 11;
  } else if (height !== null) {
    seventh = diminished ? 9 : 10;
  } else if (halfDiminished) {
    seventh = 10;
  }

  // An added tone, which stands where a seventh would and takes no height - but
  // `69` is how `6/9` is often typed, and is read as it.
  let addedTones: number[] = [];
  let top = height === null ? -1 : TOP_EXTENSION[height];
  if (added !== undefined) {
    const sixNine = added === '6' && height === 9 && majorMark === undefined;
    if ((height !== null && !sixNine) || majorMark !== undefined) {
      return { reason: `"${raw}" is not a ${subject} this app reads.` };
    }
    addedTones = added === '6' ? (sixNine ? [9, 14] : [9]) : added === '6/9' ? [9, 14] : [14];
    seventh = null;
    top = -1;
  }

  // The alterations, each to the one note it moves.
  const extensions: (number | null)[] = [null, null, null];
  let fifthAltered = false;
  for (const [alteration, accidental, number] of alterationText.matchAll(ALTERATION)) {
    if (number === '5') {
      if (fifth !== 7 || fifthAltered) {
        return { reason: `"${alteration}" contradicts the rest of "${raw}".` };
      }
      fifth = accidental === 'b' ? 6 : 8;
      fifthAltered = true;
      continue;
    }

    const extension = EXTENSION_ALTERATIONS[alteration];
    if (extension === undefined) {
      return {
        reason: `"${alteration}" is not an alteration this app can build; it reads b5, #5, b9, #9, #11 and b13.`
      };
    }
    if (seventh === null) {
      return { reason: `"${alteration}" needs a seventh chord under it, such as 7${alteration}.` };
    }
    if (extensions[extension.index] !== null) {
      return { reason: `"${alteration}" contradicts the rest of "${raw}".` };
    }
    extensions[extension.index] = extension.interval;
    top = Math.max(top, extension.index);
  }

  // Every extension up to the highest one named, natural unless altered: a
  // stack of thirds has no gaps, so `7#11` carries its ninth.
  const stacked: number[] = [];
  for (let index = 0; index <= top; index++) {
    stacked.push(extensions[index] ?? EXTENSION_NATURALS[index]);
  }

  const position1 = suspension === 'sus2' ? 2 : suspension !== undefined ? 5 : minor ? 3 : 4;
  return {
    intervals: [0, position1, fifth, ...(seventh === null ? [] : [seventh]), ...addedTones, ...stacked]
  };
}

/**
 * The chord these intervals make over this root, through `parseChord` - or null
 * when it reads none, or reads one the model has no quality for.
 *
 * `root` is relative to the key's tonic, which is the frame `expressInKey`
 * works in. A base of `'other'` is refused here rather than handed on, because
 * `writeAt` would try every quality, build none of them, and return nothing
 * anyway - the reason is the shape, and saying so is more useful than saying
 * the key could not write it.
 */
function identityOf(intervals: readonly number[], root: number): ChordIdentity | null {
  const pitchClasses = new Set(intervals.map(interval => reduce(root + interval)));
  const identity = parseChord(pitchClasses, root);
  return identity === null || identity.base === 'other' ? null : identity;
}

/** Whether a chord sounds this pitch class, in the tonic-relative frame. */
function soundsPitchClass(identity: ChordIdentity, pitchClass: number): boolean {
  return identity.intervals.some(interval => reduce(identity.root + interval) === pitchClass);
}

/**
 * The degree as a reading, or the refusal for a chord the key could not write
 * or the sheet could not name.
 *
 * The second test is the round trip's guarantee rather than a rule of its own:
 * a chord accepted here is printed by `leadSheetNameOf`, and a chord it would
 * print as `?` is one the user could not read back off the sheet.
 */
function chordOrRefusal(
  degree: ChordDegree | null,
  scaleIntervals: readonly number[],
  subject: string
): TypedChord {
  if (degree === null) return refused(`${subject} can't be written as a chord of this key.`);
  if (!isNameable(effectiveChord(scaleIntervals, degree))) return refused(unbuildableReason(subject));
  return { kind: 'chord', degree };
}

function unbuildableReason(subject: string): string {
  return `This app has no chord shape for ${subject}, so it can't go on the sheet.`;
}
