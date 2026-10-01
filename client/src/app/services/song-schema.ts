import { DOMOutputSpec, Node, Schema } from 'prosemirror-model';
import { TEMPO_MAX, TEMPO_MIN, createOwnership, normalizeChordSlot } from '../models/progression-normalize';
import type { ChordSlot, LiteralReason, RollNote, SlotHarmony, SlotOwnership } from '../models/progression.model';
import { ChordAtomAttrs, SECTION_KINDS, SectionKind } from '../models/song.model';
import { messageOf } from './error-message';

/**
 * The song's ProseMirror schema: what a song document can hold.
 *
 * ```
 * doc         attrs: title, artist, key, tempo, timeSignature      (SongMeta)
 *  └ section+         attrs: id, label, kind                       (SectionAttrs)
 *     └ (lyricLine | tabBlock | memo)+
 *        lyricLine    inline content: (text | chord)*, no marks
 *        chord        inline atom, attrs: a ChordSlot less startBeat (ChordAtomAttrs)
 *        tabBlock     block atom, attrs: id, name, score            (S3)
 *        memo         block atom, attrs: id, name, durationSec      (S4)
 * ```
 *
 * Design Part 1 has the reasoning; what follows is what the schema itself
 * decides.
 *
 * ## Every attribute is checked, at every door
 *
 * Each attribute carries a `validate`, which ProseMirror runs when a node is
 * created - from JSON, from a parse of pasted HTML, or by a step such as
 * `setNodeAttribute` - and again in `Node.check()`. So a chord the progression
 * model would refuse cannot get into a song by any road, and `songNodeOf` can
 * read a stored record by trusting nothing but this schema. The chord's checks
 * are the progression model's own (`normalizeChordSlot`), run on the one part
 * being checked: the song and the progression page cannot disagree about what a
 * valid chord is.
 *
 * A check *refuses*; it never repairs. `normalizeChordSlot` clamps some values
 * (a length under one beat) rather than throwing, and those pass here and are
 * clamped where they are played, by `sectionProgressionOf`'s `settle`. What it
 * throws on - a fractional MIDI note, a degree outside the scale - is refused.
 *
 * ## A section is never empty
 *
 * Its content is `+`, not `*`: an "empty" section is one holding a single empty
 * lyric line, which is where its caret goes. ProseMirror keeps that true by
 * itself - deleting everything in a section leaves the line, because `lyricLine`
 * is the first type the content expression can generate.
 *
 * The same rule at the top (`section+`) means ProseMirror must be able to
 * *generate* a section - after select-all and delete, say - and it refuses a
 * schema whose required child has a required attribute. So a section's
 * attributes have defaults: `NEW_SECTION`'s label and kind, and an `id` of
 * `null`, meaning "generated, not yet given one". Null is never stored and never
 * seen: `createSongIdsPlugin` gives such a section an id in the same dispatch,
 * and `songNodeOf` refuses a record with one. Every other node's attributes are
 * required, so a stored record missing one is refused rather than filled with a
 * guess.
 *
 * ## The clipboard
 *
 * Copy and paste go through `toDOM` and `parseDOM`. A chord, tab block or memo
 * carries its whole attribute set as JSON in a `data-` attribute, so a copy is
 * exact; a paste re-runs every check above and drops what fails rather than
 * inventing a chord. A pasted copy keeps the ids it was copied with - deciding
 * which of two equal ids is the copy needs the document before and after, so it
 * is `createSongIdsPlugin`'s job, not the parser's.
 */

/** What a section ProseMirror generates is called, and what a new song's first section is. */
export const NEW_SECTION: Readonly<{ label: string; kind: SectionKind }> = Object.freeze({
  label: 'Verse 1',
  kind: 'verse'
});

const LITERAL_REASONS: readonly LiteralReason[] = ['unrecognised', 'user-detached'];

/** A denominator a bar can have: a whole note divided by a power of two. */
const DENOMINATORS: readonly number[] = [1, 2, 4, 8, 16, 32, 64];

type Validate = (value: unknown) => void;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A value, briefly, for a message: enough to recognise, never a whole document. */
function shown(value: unknown): string {
  const text = value === undefined ? 'undefined' : JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function refuse(subject: string, rule: string, value: unknown): never {
  throw new RangeError(`${subject} must be ${rule}; got ${shown(value)}`);
}

function aString(subject: string): Validate {
  return value => {
    if (typeof value !== 'string') refuse(subject, 'text', value);
  };
}

function anId(subject: string): Validate {
  return value => {
    if (typeof value !== 'string' || value === '') refuse(subject, 'a non-empty id', value);
  };
}

// ---------------------------------------------------------------------------
// The song's facts
// ---------------------------------------------------------------------------

/**
 * A key as `ProgressionKey` has it. The tonic must already be 0-11:
 * `normalizeProgressionKey` would wrap a 12 into a 0, but a stored 12 is a
 * record something wrote wrongly, and a song key every writer bounds has no
 * business arriving out of range.
 */
const validKey: Validate = value => {
  const rule = 'a key: a whole tonic from 0 to 11, a scale id and preferSharps';
  if (!isRecord(value)) refuse('The song key', rule, value);
  const { tonic, scaleId, preferSharps } = value;
  if (typeof tonic !== 'number' || !Number.isInteger(tonic) || tonic < 0 || tonic > 11) {
    refuse('The song key', rule, value);
  }
  if (typeof scaleId !== 'string' || scaleId === '' || typeof preferSharps !== 'boolean') {
    refuse('The song key', rule, value);
  }
};

/** Bounded as the progression page bounds it, so a section hands over a tempo it will play. */
const validTempo: Validate = value => {
  if (typeof value !== 'number' || !(value >= TEMPO_MIN && value <= TEMPO_MAX)) {
    refuse('The song tempo', `a BPM from ${TEMPO_MIN} to ${TEMPO_MAX}`, value);
  }
};

const validTimeSignature: Validate = value => {
  const rule = 'a time signature: a whole number of beats over a power of two';
  if (!isRecord(value)) refuse('The song time signature', rule, value);
  const { numerator, denominator, isCommon } = value;
  if (typeof numerator !== 'number' || !Number.isInteger(numerator) || numerator < 1) {
    refuse('The song time signature', rule, value);
  }
  if (typeof denominator !== 'number' || !DENOMINATORS.includes(denominator) || typeof isCommon !== 'boolean') {
    refuse('The song time signature', rule, value);
  }
};

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** A string id, or null for a section ProseMirror generated (see the header). */
const validSectionId: Validate = value => {
  if (value !== null && (typeof value !== 'string' || value === '')) {
    refuse('A section id', 'a non-empty id', value);
  }
};

const validSectionKind: Validate = value => {
  if (!SECTION_KINDS.includes(value as SectionKind)) {
    refuse('A section kind', `one of ${SECTION_KINDS.join(', ')}`, value);
  }
};

// ---------------------------------------------------------------------------
// Chords
// ---------------------------------------------------------------------------

/**
 * Runs the progression model's own check on one part of a slot.
 *
 * The other parts come from a slot `normalizeChordSlot` accepts as it is, so
 * whatever it throws is about `part`. A literal harmony stands in for the
 * harmony because it has no degree of its own to check.
 */
function slotPartChecked(name: keyof ChordAtomAttrs, part: Partial<ChordSlot>): void {
  const probe: ChordSlot = {
    id: 'probe',
    harmony: { kind: 'literal', reason: 'unrecognised', from: null },
    startBeat: 0,
    lengthBeats: 1,
    notes: [],
    owned: createOwnership(),
    ...part
  };
  try {
    normalizeChordSlot(probe);
  } catch (error) {
    throw new RangeError(`A chord's ${name} is not one the progression model accepts: ${messageOf(error)}`);
  }
}

/**
 * One check per attribute, and the mapped type makes it every attribute: a
 * field `ChordSlot` gains is a compile error here until it has a check.
 *
 * The shape tests in front of `slotPartChecked` are the ones
 * `normalizeChordSlot` does not make, because the progression page only ever
 * hands it slots it built: that `harmony` is one of the two kinds, that
 * `owned` is an object. Without them a corrupt record would fail with a
 * `TypeError` from inside the model, or not at all.
 */
const CHORD_CHECKS: { readonly [K in keyof ChordAtomAttrs]: Validate } = {
  id: anId("A chord's id"),
  harmony: value => {
    const rule = 'a degree, or a literal chord with its reason';
    if (!isRecord(value)) refuse("A chord's harmony", rule, value);
    if (value['kind'] === 'degree') {
      if (!isRecord(value['degree'])) refuse("A chord's harmony", rule, value);
    } else if (value['kind'] !== 'literal' || !LITERAL_REASONS.includes(value['reason'] as LiteralReason)) {
      refuse("A chord's harmony", rule, value);
    }
    slotPartChecked('harmony', { harmony: value as unknown as SlotHarmony });
  },
  lengthBeats: value => {
    if (typeof value !== 'number' || !Number.isFinite(value)) refuse("A chord's lengthBeats", 'a number of beats', value);
  },
  notes: value => slotPartChecked('notes', { notes: value as RollNote[] }),
  owned: value => {
    if (!isRecord(value)) refuse("A chord's owned", 'three ownership flags', value);
    slotPartChecked('owned', { owned: value as unknown as SlotOwnership });
  }
};

/** Whether a value is a whole set of chord attributes, by the checks above. */
function isChordAtomAttrs(value: unknown): value is ChordAtomAttrs {
  if (!isRecord(value)) return false;
  try {
    for (const [name, check] of Object.entries(CHORD_CHECKS)) check(value[name]);
    return true;
  } catch {
    return false;
  }
}

/**
 * The attributes a chord atom keeps, from a set that may carry more.
 *
 * Listed rather than spread, so a stray `startBeat` - or anything else a pasted
 * or foreign object brings - is not carried into the document. (ProseMirror
 * would drop an attribute the schema does not declare anyway; this keeps the
 * parse rule from depending on that.)
 */
function chordAtomAttrsOf(attrs: ChordAtomAttrs): ChordAtomAttrs {
  return { id: attrs.id, harmony: attrs.harmony, lengthBeats: attrs.lengthBeats, notes: attrs.notes, owned: attrs.owned };
}

// ---------------------------------------------------------------------------
// Tab blocks and memos
// ---------------------------------------------------------------------------

/**
 * A tab block's score is checked only for being an object here. Its shape is
 * the composer's model, which S3 opens with the composer's own reader; this
 * schema would otherwise hold a second, weaker copy of those rules.
 */
const validScore: Validate = value => {
  if (!isRecord(value)) refuse("A tab block's score", 'a score document', value);
};

const validDuration: Validate = value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    refuse("A memo's durationSec", 'a length in seconds', value);
  }
};

/** A block atom's attributes from its `data-` attribute, or false so the parser skips it. */
function blockAttrsFrom(json: string | null, checks: Readonly<Record<string, Validate>>): Record<string, unknown> | false {
  try {
    const value: unknown = JSON.parse(json ?? '');
    if (!isRecord(value)) return false;
    const attrs: Record<string, unknown> = {};
    for (const [name, check] of Object.entries(checks)) {
      check(value[name]);
      attrs[name] = value[name];
    }
    return attrs;
  } catch {
    return false;
  }
}

const TAB_BLOCK_CHECKS: Readonly<Record<string, Validate>> = {
  id: anId("A tab block's id"),
  name: aString("A tab block's name"),
  score: validScore
};

const MEMO_CHECKS: Readonly<Record<string, Validate>> = {
  id: anId("A memo's id"),
  name: aString("A memo's name"),
  durationSec: validDuration
};

/** Required attributes, each with its check: the form every non-section node uses. */
function required(checks: Readonly<Record<string, Validate>>): Record<string, { validate: Validate }> {
  return Object.fromEntries(Object.entries(checks).map(([name, validate]) => [name, { validate }]));
}

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

export const songSchema = new Schema({
  nodes: {
    doc: {
      content: 'section+',
      attrs: required({
        title: aString('The song title'),
        artist: aString('The song artist'),
        key: validKey,
        tempo: validTempo,
        timeSignature: validTimeSignature
      })
    },

    section: {
      content: '(lyricLine | tabBlock | memo)+',
      attrs: {
        id: { default: null, validate: validSectionId },
        label: { default: NEW_SECTION.label, validate: aString('A section label') },
        kind: { default: NEW_SECTION.kind, validate: validSectionKind }
      },
      // A section boundary is structure, changed from the section's menu: a
      // backspace at the start of a chorus should not pull its first line up
      // into the verse above.
      isolating: true,
      parseDOM: [
        {
          tag: 'section[data-section-id]',
          getAttrs: (dom: HTMLElement) => {
            const kind = dom.getAttribute('data-kind');
            if (!SECTION_KINDS.includes(kind as SectionKind)) return false;
            return {
              id: dom.getAttribute('data-section-id') || null,
              label: dom.getAttribute('data-label') ?? NEW_SECTION.label,
              kind
            };
          }
        }
      ],
      toDOM: (node: Node): DOMOutputSpec => [
        'section',
        {
          class: 'song-section',
          'data-section-id': node.attrs['id'] ?? '',
          'data-label': node.attrs['label'],
          'data-kind': node.attrs['kind']
        },
        0
      ]
    },

    lyricLine: {
      content: 'inline*',
      // Lyrics are words, not formatting: no bold, no links. A paste from a web
      // page comes in as plain words, as a chord sheet's would.
      marks: '',
      parseDOM: [{ tag: 'p' }],
      toDOM: (): DOMOutputSpec => ['p', { class: 'song-lyric-line' }, 0]
    },

    chord: {
      inline: true,
      group: 'inline',
      atom: true,
      // Dragging a chord's name to another letter is how it moves (design Part 2).
      draggable: true,
      attrs: required(CHORD_CHECKS),
      parseDOM: [
        {
          tag: 'span[data-chord]',
          getAttrs: (dom: HTMLElement) => {
            try {
              const value: unknown = JSON.parse(dom.getAttribute('data-chord') ?? '');
              return isChordAtomAttrs(value) ? chordAtomAttrsOf(value) : false;
            } catch {
              return false;
            }
          }
        }
      ],
      toDOM: (node: Node): DOMOutputSpec => [
        'span',
        { class: 'song-chord', 'data-chord': JSON.stringify(node.attrs) }
      ]
    },

    tabBlock: {
      group: 'block',
      atom: true,
      draggable: true,
      attrs: required(TAB_BLOCK_CHECKS),
      parseDOM: [
        {
          tag: 'div[data-tab-block]',
          getAttrs: (dom: HTMLElement) => blockAttrsFrom(dom.getAttribute('data-tab-block'), TAB_BLOCK_CHECKS)
        }
      ],
      toDOM: (node: Node): DOMOutputSpec => [
        'div',
        { class: 'song-tab-block', 'data-tab-block': JSON.stringify(node.attrs) }
      ]
    },

    memo: {
      group: 'block',
      atom: true,
      draggable: true,
      attrs: required(MEMO_CHECKS),
      parseDOM: [
        {
          tag: 'div[data-memo]',
          getAttrs: (dom: HTMLElement) => blockAttrsFrom(dom.getAttribute('data-memo'), MEMO_CHECKS)
        }
      ],
      toDOM: (node: Node): DOMOutputSpec => ['div', { class: 'song-memo', 'data-memo': JSON.stringify(node.attrs) }]
    },

    text: { group: 'inline' }
  },
  marks: {}
});
