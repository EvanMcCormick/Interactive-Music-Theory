import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import packageJson from '../../../package.json';
import {
  KeySignature,
  NoteLetter,
  NotePitch,
  ScoreDoc,
  createDefaultBeatEffects,
  createDefaultMasterBar,
  createDefaultNoteEffects,
  createDefaultPlaybackInfo
} from '../models/composer.model';
import { ScoreDocMapperService } from './score-doc-mapper.service';

/**
 * The letter a note asks to be engraved on, and how the mapper says it in
 * alphaTab's terms.
 *
 * `NoteAccidentalMode` is the only channel alphaTab offers, and its doc
 * comments describe a displacement relative to a default position they never
 * state. The behaviour the mapping rests on was therefore read out of the
 * bundle - `AccidentalHelper.getNoteValue` in
 * `@coderline/alphatab/dist/alphaTab.core.mjs`, around line 24936 - which
 * displaces the note by exactly the forced accidental and then draws *that*
 * value's line under the key signature, with the forced glyph.
 *
 * ## What these specs do not check, and what stands in for it
 *
 * They do not check that reading, and cannot. `AccidentalHelper` is exported
 * from neither the typings nor the bundle, so the real helper cannot be called.
 * `displacedValue` below is a switch written here, and the only thing it takes
 * from alphaTab is `note.displayValue`, which `accidentalMode` does not affect.
 * If alphaTab flipped ForceFlat's sign tomorrow, every spec in this file would
 * stay green. An earlier version of this header claimed the opposite.
 *
 * The tripwire that *is* available is the version assertion below: a coarse
 * one, but it fires on the event that could invalidate the reading, and it says
 * where to go and re-read.
 *
 * ## What they do check, which is worth having on its own
 *
 * `displacedValue` is an independently written oracle for the same table
 * `ALTER_BY_MODE` holds, arrived at from the bundle rather than from the
 * mapper's source, and the first spec pins the mapper against it across every
 * letter, every pitch class a double accidental can reach, and three key
 * signatures. A sign flipped, a pair swapped or a double dropped in
 * `ALTER_BY_MODE` fails here. So does a mapping that turned out to depend on
 * the key, which is the argument the whole approach rests on.
 */

/** Semitones above C of each letter's natural pitch. All white keys. */
const NATURAL: Record<NoteLetter, number> =
  { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const LETTERS: NoteLetter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/**
 * C major and one key either side of it, so both of alphaTab's step tables run.
 *
 * The mapping claims to be key-independent, and a sweep that only ever built C
 * major would never have touched `flatNoteSteps` to find out.
 */
const KEYS: readonly { readonly name: string; readonly key: KeySignature }[] = [
  { name: 'C major', key: { fifths: 0, mode: 'major' } },
  { name: 'B flat major', key: { fifths: -2, mode: 'major' } },
  { name: 'A major', key: { fifths: 3, mode: 'major' } }
];

const C_MAJOR = KEYS[0].key;
const B_FLAT_MAJOR = KEYS[1].key;

/** Every note below is written in this octave, so its value is predictable. */
const OCTAVE = 4;

/** What alphaTab numbers a pitch class in `OCTAVE`; its octave 0 is C-1. */
function soundingValue(pitchClass: number): number {
  return (OCTAVE + 1) * 12 + pitchClass;
}

/** How far a pitch class sits from a letter's natural pitch, normalised into ±6. */
function normalisedAlter(pitchClass: number, natural: number): number {
  return ((((pitchClass - natural + 6) % 12) + 12) % 12) - 6;
}

/**
 * `AccidentalHelper.getNoteValue`, mirrored.
 *
 * Reads `displayValue` because that is what the helper reads - the note has to
 * be attached to a beat, voice, bar and staff for it to resolve, which is why
 * every note here comes back out of a mapped score rather than being built bare.
 */
function displacedValue(note: alphaTab.model.Note): number {
  switch (note.accidentalMode) {
    case alphaTab.model.NoteAccidentalMode.ForceDoubleFlat:
      return note.displayValue + 2;
    case alphaTab.model.NoteAccidentalMode.ForceFlat:
      return note.displayValue + 1;
    case alphaTab.model.NoteAccidentalMode.ForceSharp:
      return note.displayValue - 1;
    case alphaTab.model.NoteAccidentalMode.ForceDoubleSharp:
      return note.displayValue - 2;
    default:
      return note.displayValue;
  }
}

/** One unfretted whole note in one bar, shaped as the progression's projection is. */
function buildDoc(pitch: NotePitch, keySignature: KeySignature): ScoreDoc {
  return {
    title: 'Spelling',
    subTitle: '',
    artist: '',
    album: '',
    tempo: 120,
    masterBars: [createDefaultMasterBar()],
    tracks: [
      {
        id: 'piano',
        name: 'Piano',
        shortName: 'Pno',
        color: '#2c3e50',
        playback: createDefaultPlaybackInfo(0),
        generated: null,
        staves: [
          {
            // Empty, which is what marks the staff as unfretted.
            tuning: [],
            tuningLabel: 'Piano',
            capo: 0,
            transpose: 0,
            displayTranspose: 0,
            showStandardNotation: true,
            showTablature: false,
            showSlash: false,
            showNumbered: false,
            bars: [
              {
                clef: 'g2',
                clefOttava: 'regular',
                keySignature,
                voices: [
                  {
                    beats: [
                      {
                        duration: 1,
                        dots: 0,
                        tuplet: null,
                        isRest: false,
                        notes: [
                          {
                            pitch,
                            isTied: false,
                            accidental: 'auto',
                            effects: createDefaultNoteEffects()
                          }
                        ],
                        dynamics: null,
                        lyrics: null,
                        text: null,
                        effects: createDefaultBeatEffects()
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

/**
 * The alphaTab this file's reading of `AccidentalHelper.getNoteValue` was taken
 * from, exactly as `client/package.json` declares it.
 *
 * The displacement is a dependency's internal that no assertion here can see,
 * so this stands in for one. A bump fails this spec, and the fix is to open
 * `AccidentalHelper.getNoteValue` in `dist/alphaTab.core.mjs`, check the four
 * Force* cases still displace by +2/+1/-1/-2, and only then move this string.
 */
const ALPHATAB_READ_AT = '^1.8.0';

describe('ScoreDocMapperService spelling', () => {
  let mapper: ScoreDocMapperService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mapper = TestBed.inject(ScoreDocMapperService);
  });

  it('is pinned to the alphaTab the displacement was read from', () => {
    expect(packageJson.dependencies['@coderline/alphatab']).toBe(ALPHATAB_READ_AT);
  });

  function mapOneNote(
    pitch: NotePitch,
    key: KeySignature = C_MAJOR
  ): alphaTab.model.Note {
    const score = mapper.toScore(buildDoc(pitch, key), new alphaTab.Settings());
    return score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
  }

  function roundTrip(pitch: NotePitch, key: KeySignature = C_MAJOR): NotePitch {
    const score = mapper.toScore(buildDoc(pitch, key), new alphaTab.Settings());
    return mapper.toDoc(score).tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0]
      .pitch;
  }

  it('displaces a forced note onto the letter its spelling names', () => {
    for (const { name, key } of KEYS) {
      for (const letter of LETTERS) {
        for (let pitchClass = 0; pitchClass < 12; pitchClass++) {
          const alter = normalisedAlter(pitchClass, NATURAL[letter]);
          if (Math.abs(alter) > 2) continue;

          const note = mapOneNote(
            { kind: 'pitched', noteValue: pitchClass, octave: OCTAVE, letter },
            key
          );
          const where = `${letter} against pitch class ${pitchClass} in ${name}`;

          // AccidentalHelper displaces by the forced accidental and draws THAT
          // value's line. The whole value is asserted, not its pitch class,
          // because the octave is half of what the displacement does: B♯ is
          // drawn on the B *below* the pitch it sounds and C♭ on the C above,
          // and a pitch class would call both of those right either way.
          expect(note.displayValue).withContext(where).toBe(soundingValue(pitchClass));
          expect(displacedValue(note))
            .withContext(where)
            .toBe(soundingValue(pitchClass) - alter);

          // And what it lands on is a white key - the letter's own natural
          // pitch - which is why no key signature can ambiguate the line, and
          // why the same three keys above all have to agree.
          expect(displacedValue(note) % 12).withContext(where).toBe(NATURAL[letter]);
        }
      }
    }
  });

  it('round-trips every letter that needs an accidental', () => {
    for (const letter of LETTERS) {
      for (let pitchClass = 0; pitchClass < 12; pitchClass++) {
        const alter = normalisedAlter(pitchClass, NATURAL[letter]);
        if (alter === 0 || Math.abs(alter) > 2) continue;

        const doc: NotePitch = {
          kind: 'pitched',
          noteValue: pitchClass,
          octave: OCTAVE,
          letter
        };
        expect(roundTrip(doc))
          .withContext(`${letter} against pitch class ${pitchClass}`)
          .toEqual(doc);
      }
    }
  });

  it('reads back a natural letter as no letter, which engraves the same', () => {
    // The one lossy corner, and it costs nothing. A natural forces nothing, so
    // the score carries `Default` and cannot say whether a letter was asked
    // for.
    //
    // "Engraves the same" is the claim, and the second half below is the whole
    // of what this file can show of it: the note built *with* the letter and
    // the note built from what the round trip gave back are the same alphaTab
    // note, so whatever alphaTab draws for one it draws for the other. That it
    // draws both on an E is read from the bundle - `sharpNoteSteps` and
    // `flatNoteSteps` put all seven white pitch classes on the same steps - and
    // is not proven here.
    const doc: NotePitch = {
      kind: 'pitched',
      noteValue: 4,
      octave: OCTAVE,
      letter: 'E'
    };
    const back = roundTrip(doc, B_FLAT_MAJOR);

    expect(back).toEqual({
      kind: 'pitched',
      noteValue: 4,
      octave: OCTAVE,
      letter: undefined
    });

    const asked = mapOneNote(doc, B_FLAT_MAJOR);
    const returned = mapOneNote(back, B_FLAT_MAJOR);
    expect(returned.accidentalMode).toBe(asked.accidentalMode);
    expect(returned.displayValue).toBe(asked.displayValue);
  });

  it('drops a letter more than a double accidental away', () => {
    // C against pitch class 6 is a triple sharp. Not notation, so no letter.
    const note = mapOneNote({ kind: 'pitched', noteValue: 6, octave: OCTAVE, letter: 'C' });
    expect(note.accidentalMode).toBe(alphaTab.model.NoteAccidentalMode.Default);
  });

  it('leaves a note with no letter exactly as it was', () => {
    const note = mapOneNote({ kind: 'pitched', noteValue: 11, octave: OCTAVE });
    expect(note.accidentalMode).toBe(alphaTab.model.NoteAccidentalMode.Default);
  });

  it('lets the letter overrule the accidental flag it subsumes', () => {
    // `accidental: 'explicit'` has always meant ForceSharp; a C flat asks for
    // the opposite. The letter decides, and the flag only speaks without one.
    const doc = buildDoc(
      { kind: 'pitched', noteValue: 11, octave: OCTAVE, letter: 'C' },
      C_MAJOR
    );
    doc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].accidental = 'explicit';

    const score = mapper.toScore(doc, new alphaTab.Settings());
    const note = score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];

    expect(note.accidentalMode).toBe(alphaTab.model.NoteAccidentalMode.ForceFlat);
  });

  it('still forces a sharp for an explicit accidental with no letter', () => {
    // The legacy half of that rule, and the only thing holding it up. Nothing
    // in the app sets `accidental: 'explicit'` yet, so the whole
    // `'explicit' ? ForceSharp` arm deletes without a single spec going red -
    // which is how it would go missing during a later tidy of the expression
    // this commit rewrote.
    //
    // The misnomer is deliberate and recorded rather than fixed: `'explicit'`
    // forces a *sharp*, so in B flat major pitch class 6 is engraved F♯ where
    // the key wants G♭. `letter` routes generated notes around it; a
    // composer-entered note keeps today's behaviour, because silently
    // respelling documents that already exist is not a spelling fix.
    const doc = buildDoc({ kind: 'pitched', noteValue: 6, octave: OCTAVE }, B_FLAT_MAJOR);
    doc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].accidental = 'explicit';

    const score = mapper.toScore(doc, new alphaTab.Settings());
    const note = score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];

    expect(note.accidentalMode).toBe(alphaTab.model.NoteAccidentalMode.ForceSharp);
  });
});
