import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { copiedBeatsOf, pasteBeats } from './beat-clipboard';
import { ComposerService } from './composer.service';
import { FretDigitEntry } from './composer-fret-entry';
import { caretSlotIndexOf, dragExtends, scorePressOf, staffSlotsOf, staffSlotsOfScore } from './composer-score-interaction';
import { toolStates } from './composer-tool-states';
import { COMPOSER_TOOLS } from './composer-tools';
import { deepFrozen } from './deep-frozen.spec-helper';
import { PERCUSSION } from './pitch-on-strings';
import { setStaffNumber, setStaffTuning } from './track-edits';
import { ArticulationDoc, EditCursor, NoteDoc, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

/**
 * What a percussion staff refuses, and what it lets through.
 *
 * One predicate, in `editRefusal`, which every press already asks: a drum hit has no string and no pitch, so every
 * fretted-only technique, every accidental, respelling, semitone and string moves, a hammer-on and a trill say so; what
 * reads no pitch - duration, dots, rest, dynamics, accents, staccato, ghost, tie, fermata - goes through. Asserted over
 * every tool `toolStates` answers for, so a tool added later cannot arrive without an answer.
 */
describe('a percussion staff', () => {
  /** A drum hit of `articulation`, with no effects. */
  const hit = (articulation: number): NoteDoc => ({
    pitch: { kind: 'percussion', articulation },
    isTied: false,
    accidental: 'auto',
    effects: createDefaultNoteEffects()
  });

  /** Guitar on track 0, a kit on track 1 with a snare on beats 0 and 1 of the first bar. */
  function kit(): ScoreDoc {
    const doc = ComposerService.createEmptyScore();
    const drums = ComposerService.createTrack('Drums', 'drm', 0, false, doc.masterBars);
    drums.staves[0].isPercussion = true;
    const beats = drums.staves[0].bars[0].voices[0].beats;
    for (const index of [0, 1]) {
      beats[index].isRest = false;
      beats[index].notes = [hit(38)];
    }
    doc.tracks.push(drums);
    return doc;
  }

  const onDrums = (beatIndex: number): EditCursor => ({ trackIndex: 1, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex, stringIndex: null });

  /** The tools a percussion staff refuses, with the percussion message. */
  const REFUSED = [
    'bend',
    'legatoSlide',
    'shiftSlide',
    'naturalHarmonic',
    'artificialHarmonic',
    'leftHandTap',
    'tap',
    'slap',
    'pop',
    'doubleFlat',
    'flat',
    'natural',
    'sharp',
    'doubleSharp',
    'respell',
    'hammerOn',
    'trill'
  ];

  /** Tools that read no pitch, so they go through on a drum hit: every length and dynamic, and what the design names. */
  const ALLOWED = [
    'whole',
    'half',
    'quarter',
    'eighth',
    'sixteenth',
    'thirtySecond',
    'sixtyFourth',
    'dot',
    'doubleDot',
    'tuplet',
    'rest',
    'ppp',
    'pp',
    'p',
    'mp',
    'mf',
    'f',
    'ff',
    'fff',
    'crescendo',
    'decrescendo',
    'accent',
    'heavyAccent',
    'tenuto',
    'staccato',
    'ghost',
    'dead',
    'tie',
    'fermata',
    'palmMute',
    'letRing',
    'vibrato',
    'wideVibrato',
    'pickDown',
    'pickUp',
    'fadeIn',
    'graceBefore',
    'graceOnBeat'
  ];

  /**
   * Tools that ask nothing of a note's pitch or string, so a drum hit is not what decides them: the entry modes, and
   * tools that act on bars and the timeline or open a popover that asks for itself. Each may still be refused on the
   * drum caret for a reason of its own - Triplet with no three beats of one value to group, Fix bar on a bar with
   * nothing to fix - but never with the percussion message.
   */
  const NOT_ASKED = [
    'select',
    'pen',
    'triplet',
    'timeSignature',
    'keySignature',
    'clef',
    'tripletFeel',
    'freeTime',
    'repeatOpen',
    'repeatClose',
    'alternateEnding',
    'section',
    'doubleBar',
    'fixBar',
    'insertBar',
    'appendBar',
    'deleteBar'
  ];

  describe('through the tool table', () => {
    // Beat 1: it has a snare before it to tie from, so Tie's own rule is met and only the staff is being asked about.
    const states = (): ReadonlyMap<string, { refusal: string | null }> => toolStates(deepFrozen(kit()), null, onDrums(1), 'select');

    it('refuses every fretted-only, pitch, spelling, hammer-on and trill tool with the percussion message', () => {
      const read = states();
      for (const id of REFUSED) expect(read.get(id)?.refusal).withContext(id).toBe(PERCUSSION);
    });

    it('lets through what reads no pitch', () => {
      const read = states();
      for (const id of ALLOWED) expect(read.get(id)?.refusal).withContext(id).toBeNull();
    });

    // Both ways: an unlisted tool fails here whether it refuses or not, so a new one that reads a pitch cannot slip
    // through as allowed - it has to be put in a list, and the list it goes in is asserted above or below.
    it('answers for every tool the table reads, so a new one cannot arrive unasked', () => {
      const read = states();
      const answered = new Set([...REFUSED, ...ALLOWED, ...NOT_ASKED]);
      for (const id of read.keys()) expect(answered.has(id)).withContext(`${id} is not listed`).toBeTrue();
      // Every listed id is a tool the palette has, so a renamed one cannot leave a stale name behind.
      const tools = new Set(COMPOSER_TOOLS.map(tool => tool.id));
      for (const id of answered) expect(tools.has(id)).withContext(`${id} is not a tool`).toBeTrue();
    });

    it('never refuses a tool that asks nothing of a pitch with the percussion message', () => {
      const read = states();
      for (const id of NOT_ASKED) expect(read.get(id)?.refusal).withContext(id).not.toBe(PERCUSSION);
    });

    it('refuses a range reaching a percussion staff whole, as any mixed range is refused', () => {
      const guitar: EditCursor = { trackIndex: 0, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0, stringIndex: 0 };
      const read = toolStates(deepFrozen(kit()), guitar, onDrums(0), 'select');

      expect(read.get('sharp')?.refusal).toBe(PERCUSSION);
    });
  });

  describe('through the service', () => {
    let composer: ComposerService;

    beforeEach(() => {
      TestBed.configureTestingModule({});
      composer = TestBed.inject(ComposerService);
      composer.replaceDocument(kit(), { markClean: true });
      composer.setCursor(onDrums(0));
    });

    it('refuses a semitone move, a string move and a respell, and changes nothing', () => {
      const before = composer.doc;
      for (const press of [() => composer.shiftSemitone(1), () => composer.moveNotesToString(1), () => composer.respell()]) {
        press();
        expect(composer.doc).toBe(before);
        expect(composer.state.refusal).toBe(PERCUSSION);
      }
    });

    it('says why a fret digit writes nothing', () => {
      const before = composer.doc;
      new FretDigitEntry(composer).type(3);

      expect(composer.doc).toBe(before);
      expect(composer.state.refusal).toBe(PERCUSSION);
    });

    it('writes nothing where a note would be entered', () => {
      composer.setNoteAtCursor({ kind: 'pitched', noteValue: 0, octave: 4 }, true);

      expect(composer.state.refusal).toBe(PERCUSSION);
      expect(composer.doc.tracks[1].staves[0].bars[0].voices[0].beats[0].notes).toEqual([hit(38)]);
    });

    it('still takes a duration, a dynamic and an accent', () => {
      composer.applyDurationAtCursor(8, 0);
      composer.setDynamics('pp');
      composer.toggleNoteEffect('accent', 'normal', 'none');

      const beat = composer.doc.tracks[1].staves[0].bars[0].voices[0].beats[0];
      expect(beat.duration).toBe(8);
      expect(beat.dynamics).toBe('pp');
      expect(beat.notes[0].effects.accent).toBe('normal');
    });

    it('takes off a trill a drum hit already carries, as every other technique comes off', () => {
      // An imported file can carry one; only setting a trill reads a pitch.
      const doc = kit();
      doc.tracks[1].staves[0].bars[0].voices[0].beats[0].notes[0].effects.trill = { value: 40, speed: 16 };
      composer.replaceDocument(doc, { markClean: true });
      composer.setCursor(onDrums(0));

      const trill = toolStates(composer.doc, null, onDrums(0), 'select').get('trill');
      expect(trill?.pressed).toBeTrue();
      expect(trill?.refusal).toBeNull();

      composer.toggleTrill();
      expect(composer.state.refusal).toBeNull();
      expect(composer.doc.tracks[1].staves[0].bars[0].voices[0].beats[0].notes[0].effects.trill).toBeNull();
    });
  });

  describe('tuning and capo', () => {
    it('refuses a tuning and a capo', () => {
      const doc = kit();

      expect(setStaffTuning(doc, 1, 0, [64, 59, 55, 50, 45, 40], 'Guitar')).toBe(PERCUSSION);
      expect(setStaffNumber(doc, 1, 0, 'capo', 2)).toBe(PERCUSSION);
      expect(doc.tracks[1].staves[0].tuning).toEqual([]);
      expect(doc.tracks[1].staves[0].capo).toBe(0);
    });
  });

  describe('on the score', () => {
    it("draws as a 'percussion' band where a pitched staff draws 'notation', so the ranks do not move", () => {
      expect(staffSlotsOf(kit()).map(slot => slot.kind)).toEqual(['notation', 'tab', 'percussion']);
    });

    it('reads the same from an alphaTab score', () => {
      const score = new alphaTab.model.Score();
      const track = new alphaTab.model.Track();
      const staff = new alphaTab.model.Staff();
      staff.isPercussion = true;
      track.addStaff(staff);
      score.addTrack(track);

      expect(staffSlotsOfScore(score).map(slot => slot.kind)).toEqual(['percussion']);
    });

    it('draws a caret with no string on the drum band, not a slash staff drawn above it', () => {
      const doc = kit();
      doc.tracks[1].staves[0].showSlash = true;
      const slots = staffSlotsOf(doc);

      expect(slots.map(slot => slot.kind)).toEqual(['notation', 'tab', 'slash', 'percussion']);
      expect(caretSlotIndexOf(slots, onDrums(0), null)).toBe(3);
    });

    it('takes a Pen press as a caret move, and a drag from it as a range', () => {
      expect(scorePressOf('pen', 'percussion', false)).toBe('caret');
      expect(dragExtends('pen', 'percussion')).toBeTrue();
    });
  });

  describe('paste', () => {
    const at = (trackIndex: number) => ({ trackIndex, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 });

    it('copies drums as drums', () => {
      expect(copiedBeatsOf(kit(), [at(1)])?.notes).toBe('percussion');
    });

    it('refuses drums onto a pitched staff, and a pitched copy onto drums', () => {
      const doc = kit();
      doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
      const drums = copiedBeatsOf(doc, [at(1)]);
      const piano = copiedBeatsOf(doc, [at(2)]);
      if (!drums || !piano) throw new Error('nothing copied');

      expect(pasteBeats(structuredClone(doc), at(2), drums)).toMatch(/copied from a percussion staff/);
      expect(pasteBeats(structuredClone(doc), at(1), piano)).toMatch(/copied from a pitched staff.*percussion staff/);
    });

    it('refuses fretted beats onto drums, and drums onto a fretted staff', () => {
      const doc = kit();
      const guitar = copiedBeatsOf(doc, [at(0)]);
      const drums = copiedBeatsOf(doc, [at(1)]);
      if (!guitar || !drums) throw new Error('nothing copied');

      expect(pasteBeats(structuredClone(doc), at(1), guitar)).toBe(
        'Those beats were copied from a fretted staff, and a percussion staff has no strings and no pitch.'
      );
      expect(pasteBeats(structuredClone(doc), at(0), drums)).toBe(
        'Those beats were copied from a percussion staff, and its drums have no pitch to write on this staff.'
      );
    });

    /** A kit entry for `id`, with every other number `seed`. */
    const entry = (id: number, seed = 0): ArticulationDoc => ({
      id,
      elementType: 'Snare',
      staffLine: seed,
      noteHeadDefault: seed,
      noteHeadHalf: seed,
      noteHeadWhole: seed,
      techniqueSymbol: seed,
      techniqueSymbolPlacement: seed,
      outputMidiNumber: id
    });

    /** `kit()` with `from` as track 1's kit, and a second drum track, track 2, whose kit is `onto`. */
    function twoKits(from: ArticulationDoc[], onto: ArticulationDoc[]): ScoreDoc {
      const doc = kit();
      doc.tracks[1].percussionArticulations = from;
      const other = ComposerService.createTrack('Drums 2', 'dr2', 0, false, doc.masterBars);
      other.staves[0].isPercussion = true;
      other.percussionArticulations = onto;
      doc.tracks.push(other);
      return doc;
    }

    it('refuses drums copied from another kit, whose numbers would name other drums here', () => {
      const from = [entry(38), entry(36)];
      // No kit, the same entries in another order, and one field changed.
      for (const onto of [[], [entry(36), entry(38)], [entry(38), entry(36, 1)]]) {
        const doc = twoKits(from, onto);
        const drums = copiedBeatsOf(doc, [at(1)]);
        if (!drums) throw new Error('nothing copied');

        expect(pasteBeats(doc, at(2), drums))
          .withContext(JSON.stringify(onto))
          .toBe('Those beats were copied from a drum track with another kit, so their drums would change here.');
      }
    });

    it('pastes drums between tracks whose kits are the same, field for field', () => {
      const kits: [ArticulationDoc[], ArticulationDoc[]][] = [
        [[entry(38), entry(36)], [entry(38), entry(36)]],
        [[], []]
      ];
      for (const [from, onto] of kits) {
        const doc = twoKits(from, onto);
        const drums = copiedBeatsOf(doc, [at(1)]);
        if (!drums) throw new Error('nothing copied');

        expect(typeof pasteBeats(doc, at(2), drums)).withContext(JSON.stringify(from)).toBe('object');
        expect(doc.tracks[2].staves[0].bars[0].voices[0].beats[0].notes).withContext(JSON.stringify(from)).toEqual([hit(38)]);
      }
    });

    it('pastes drums onto drums', () => {
      const doc = kit();
      const drums = copiedBeatsOf(doc, [at(1)]);
      if (!drums) throw new Error('nothing copied');

      expect(typeof pasteBeats(doc, { ...at(1), beatIndex: 2 }, drums)).toBe('object');
      expect(doc.tracks[1].staves[0].bars[0].voices[0].beats[2].notes).toEqual([hit(38)]);
    });
  });
});
