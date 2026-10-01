import { EditorState } from 'prosemirror-state';
import { chordLabelOf } from '../components/songs/song-sheet/chord-view';
import { createExtensions } from '../models/progression-normalize';
import type { ChordAtomAttrs } from '../models/song.model';
import type { ChordDegree, ProgressionKey } from '../models/progression.model';
import { MusicTheoryService } from './music-theory.service';
import { ProgressionKeyContext } from './progression-key-context';
import { chordVocabulary } from './progression-vocabulary';
import { chordFromText } from './song-chord-parse';
import { insertChord } from './song-commands';
import { chordSlotOf, createSongContent } from './song-document';
import { SongPaletteOption, SongPaletteRows, isSameChord, songPaletteOf } from './song-palette';

const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];
const MAJOR_PENTATONIC = [0, 2, 4, 7, 9];
const FOUR_FOUR = { numerator: 4, denominator: 4, isCommon: true };

const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const A_MINOR: ProgressionKey = { tonic: 9, scaleId: 'aeolian', preferSharps: true };
const D_DORIAN: ProgressionKey = { tonic: 2, scaleId: 'dorian', preferSharps: false };
const A_HARMONIC_MINOR: ProgressionKey = { tonic: 9, scaleId: 'harmonicMinor', preferSharps: true };

/** The four rows of a key that can build chords; a refusal fails the spec. */
function rowsOf(key: ProgressionKey, scaleIntervals: readonly number[]): SongPaletteRows {
  const palette = songPaletteOf(key, scaleIntervals);
  if (palette.kind !== 'rows') throw new Error(`Refused: ${palette.reason}`);
  return palette.rows;
}

const names = (options: readonly SongPaletteOption[]): string[] => options.map(option => option.name);
const numerals = (options: readonly SongPaletteOption[]): string[] => options.map(option => option.numeral);

function degreeOf(degree: number, extent: 3 | 7 = 3, inversion = 0): ChordDegree {
  return {
    degree,
    alter: 0,
    extent,
    quality: null,
    inversion,
    suspension: 'none',
    extensions: createExtensions(),
    octave: 0
  };
}

/**
 * The Chords tab's four rows: the key's own triads and sevenths, built here, and the borrowed chords and secondary
 * dominants the progression palette's vocabulary offers - every one written as the sheet writes it.
 */
describe('songPaletteOf', () => {
  describe('the diatonic rows', () => {
    it('gives C ionian its seven triads and seven sevenths', () => {
      const rows = rowsOf(C_MAJOR, IONIAN);

      expect(numerals(rows.triads)).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
      expect(names(rows.triads)).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'B°']);
      expect(numerals(rows.sevenths)).toEqual(['Imaj7', 'ii7', 'iii7', 'IVmaj7', 'V7', 'vi7', 'viiø7']);
      expect(names(rows.sevenths)).toEqual(['Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bø7']);
    });

    it('numbers A aeolian from its own tonic', () => {
      const rows = rowsOf(A_MINOR, AEOLIAN);

      expect(numerals(rows.triads)).toEqual(['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']);
      expect(names(rows.triads)).toEqual(['Am', 'B°', 'C', 'Dm', 'Em', 'F', 'G']);
      expect(names(rows.sevenths)).toEqual(['Am7', 'Bø7', 'Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7']);
    });

    it('builds D dorian’s chords from its own scale, not the major scale’s', () => {
      const rows = rowsOf(D_DORIAN, DORIAN);

      expect(numerals(rows.triads)).toEqual(['i', 'ii', 'III', 'IV', 'v', 'vi°', 'VII']);
      expect(names(rows.triads)).toEqual(['Dm', 'Em', 'F', 'G', 'Am', 'B°', 'C']);
      expect(names(rows.sevenths)).toEqual(['Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bø7', 'Cmaj7']);
    });

    it('stacks harmonic minor’s raised seventh into its chords: the major V7 and the leading-tone vii°7', () => {
      const rows = rowsOf(A_HARMONIC_MINOR, HARMONIC_MINOR);

      expect(names(rows.triads)).toEqual(['Am', 'B°', 'C+', 'Dm', 'E', 'F', 'G#°']);
      expect(names(rows.sevenths)).toEqual(['AmMaj7', 'Bø7', 'C+maj7', 'Dm7', 'E7', 'Fmaj7', 'G#°7']);
      expect(numerals(rows.sevenths)[4]).toBe('V7');
      expect(numerals(rows.sevenths)[6]).toBe('vii°7');
    });

    it('places each diatonic chord as the key gives it: degree by degree, no override, at its row’s height', () => {
      const rows = rowsOf(C_MAJOR, IONIAN);

      expect(rows.triads.map(option => option.degree)).toEqual([0, 1, 2, 3, 4, 5, 6].map(degree => degreeOf(degree)));
      expect(rows.sevenths.map(option => option.degree)).toEqual([0, 1, 2, 3, 4, 5, 6].map(degree => degreeOf(degree, 7)));
    });

    it('says each chord for assistive technology by its name, not its numeral', () => {
      const rows = rowsOf(C_MAJOR, IONIAN);
      expect(rows.triads[5].spoken).toBe('A minor');
      expect(rows.sevenths[6].spoken).toBe('B half diminished seventh');
    });
  });

  describe('the borrowed and secondary rows', () => {
    it('are the vocabulary’s, chord for chord and in its order', () => {
      for (const [key, scale] of [
        [C_MAJOR, IONIAN],
        [A_MINOR, AEOLIAN],
        [D_DORIAN, DORIAN]
      ] as const) {
        const rows = rowsOf(key, scale);
        const vocabulary = chordVocabulary(key, scale, null);
        const shape = (degree: ChordDegree): unknown => [degree.degree, degree.alter, degree.quality, degree.extent];

        expect(rows.borrowed.map(option => shape(option.degree))).toEqual(
          vocabulary.borrowed.map(option => [option.degree, option.alter, option.quality, option.extent])
        );
        expect(rows.secondary.map(option => shape(option.degree))).toEqual(
          vocabulary.secondary.map(option => [option.degree, option.alter, option.quality, option.extent])
        );
      }
    });

    it('names them the sheet’s way, and keeps the secondary dominants’ slash numerals as their role', () => {
      const rows = rowsOf(C_MAJOR, IONIAN);

      expect(names(rows.borrowed)).toEqual(['Db', 'Eb', 'Fm', 'Ab', 'Bb']);
      expect(numerals(rows.borrowed)).toEqual(['♭II', '♭III', 'iv', '♭VI', '♭VII']);
      expect(rows.borrowed.map(option => option.role)).toEqual([null, null, null, null, null]);

      expect(names(rows.secondary)).toEqual(['A7', 'B7', 'C7', 'D7', 'E7']);
      expect(rows.secondary.map(option => option.role)).toEqual(['V/ii', 'V/iii', 'V/IV', 'V/V', 'V/vi']);
      // The numeral is the one the sheet prints for the chord once placed: its place in the key.
      expect(numerals(rows.secondary)).toEqual(['VI7', 'VII7', 'I7', 'II7', 'III7']);
      expect(rows.secondary[0].spoken).toBe('A dominant seventh, leading to D minor');
    });

    it('offers a minor key its major dominant and leading-tone triad as borrowed chords', () => {
      expect(names(rowsOf(A_MINOR, AEOLIAN).borrowed)).toEqual(['Bb', 'E', 'G#°']);
    });
  });

  it('refuses a key whose scale cannot build chords, with the reason', () => {
    const pentatonic = songPaletteOf({ tonic: 0, scaleId: 'majorPentatonic', preferSharps: true }, MAJOR_PENTATONIC);
    const unknown = songPaletteOf({ tonic: 0, scaleId: 'nothing', preferSharps: true }, null);

    for (const palette of [pentatonic, unknown]) {
      expect(palette).toEqual({
        kind: 'refused',
        reason: "This key's scale can't build chords; choose a seven-note scale for the song."
      });
    }
  });

  it('gives options the sheet places and prints as the panel writes them, in every key a song can be in', () => {
    const keys = new ProgressionKeyContext(new MusicTheoryService());
    const scales = new MusicTheoryService()
      .getScaleCategories()
      .flatMap(category => category.scales)
      .filter(scale => keys.chordScale(scale) !== null);
    expect(scales.length).toBeGreaterThan(10);

    const problems: string[] = [];
    for (const scale of scales) {
      for (const [tonic, preferSharps] of [
        [0, true],
        [3, false],
        [6, true],
        [10, false]
      ] as const) {
        const key: ProgressionKey = { tonic, scaleId: scale.id, preferSharps };
        const rows = rowsOf(key, scale.intervals);
        const state = EditorState.create({ doc: createSongContent({ key }) });

        for (const option of [...rows.triads, ...rows.sevenths, ...rows.borrowed, ...rows.secondary]) {
          const outcome = insertChord(chordSlotOf(option.degree, key, scale.intervals, FOUR_FOUR))(state);
          if (outcome.kind !== 'edit') {
            problems.push(`${scale.id} ${tonic} ${option.name}: ${outcome.kind}`);
            continue;
          }
          // The new song's caret is in its first line, at 2: the atom is there.
          const attrs = outcome.tr.doc.nodeAt(2)?.attrs as ChordAtomAttrs;
          const named = chordLabelOf(attrs, { key, scaleIntervals: scale.intervals, numerals: false });
          const numbered = chordLabelOf(attrs, { key, scaleIntervals: scale.intervals, numerals: true });
          if (named.text !== option.name || numbered.text !== option.numeral) {
            problems.push(`${scale.id} ${tonic}: ${option.name} ${option.numeral} printed ${named.text} ${numbered.text}`);
          }
          if (named.spoken !== `chord ${option.spoken.split(', ')[0]}`) {
            problems.push(`${scale.id} ${tonic}: ${option.spoken} said as ${named.spoken}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

/** Which cell the chord selected on the sheet is: the chord it builds, wherever it came from. */
describe('isSameChord', () => {
  let rows: SongPaletteRows;

  beforeEach(() => {
    rows = rowsOf(C_MAJOR, IONIAN);
  });

  it('finds a placed chord’s own cell, and no other diatonic cell', () => {
    const placed = chordSlotOf(rows.triads[5].degree, C_MAJOR, IONIAN, FOUR_FOUR).harmony;
    if (placed.kind !== 'degree') throw new Error('Placed a literal');
    const cells = [...rows.triads, ...rows.sevenths, ...rows.borrowed, ...rows.secondary];

    expect(cells.filter(option => isSameChord(option.degree, placed.degree, IONIAN)).map(option => option.name)).toEqual([
      'Am'
    ]);
  });

  it('knows a typed chord, and an inverted one, by the chord it builds', () => {
    const typed = chordFromText('Bb', C_MAJOR, IONIAN);
    if (typed.kind !== 'chord') throw new Error(typed.reason);

    expect(isSameChord(rows.borrowed[4].degree, typed.degree, IONIAN)).toBeTrue();
    expect(isSameChord(rows.triads[0].degree, degreeOf(0, 3, 1), IONIAN)).toBeTrue();
  });

  it('tells a triad from its seventh', () => {
    expect(isSameChord(rows.triads[4].degree, degreeOf(4, 7), IONIAN)).toBeFalse();
    expect(isSameChord(rows.sevenths[4].degree, degreeOf(4, 7), IONIAN)).toBeTrue();
  });
});
