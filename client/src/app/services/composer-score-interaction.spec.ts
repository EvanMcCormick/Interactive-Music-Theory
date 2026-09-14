import { ComposerService } from './composer.service';
import {
  StaffSlot,
  caretHalfStepsOf,
  caretSlotIndexOf,
  dragContinues,
  dragExtends,
  dragTargetOf,
  highlightEndsOf,
  hoverKeyOf,
  hoverSurvives,
  penHoverHalfStepsOf,
  sameCaret,
  scorePressOf,
  scoreRedrawOf,
  seeksOnPress,
  snappedHoverX,
  staffSlotsOf,
  writeSounds
} from './composer-score-interaction';
import { EditCursor } from '../models/composer.model';

const at = (trackIndex: number, barIndex: number, beatIndex: number, stringIndex: number | null = 0): EditCursor =>
  ({ trackIndex, staffIndex: 0, barIndex, voiceIndex: 0, beatIndex, stringIndex });

describe('staffSlotsOf', () => {
  it('lists the staves alphaTab draws, notation before tablature, track by track', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    expect(staffSlotsOf(doc)).toEqual([
      { trackIndex: 0, staffIndex: 0, kind: 'notation' },
      { trackIndex: 0, staffIndex: 0, kind: 'tab' },
      { trackIndex: 1, staffIndex: 0, kind: 'notation' }
    ]);
  });

  it('lists only tablature when notation is hidden, and only notation when tablature is', () => {
    const tabOnly = ComposerService.createEmptyScore();
    tabOnly.tracks[0].staves[0].showStandardNotation = false;
    const notationOnly = ComposerService.createEmptyScore();
    notationOnly.tracks[0].staves[0].showTablature = false;

    expect(staffSlotsOf(tabOnly)).toEqual([{ trackIndex: 0, staffIndex: 0, kind: 'tab' }]);
    expect(staffSlotsOf(notationOnly)).toEqual([{ trackIndex: 0, staffIndex: 0, kind: 'notation' }]);
  });

  it('lists no tablature for a staff with no strings, even with tablature shown', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].tuning = [];

    expect(staffSlotsOf(doc)).toEqual([{ trackIndex: 0, staffIndex: 0, kind: 'notation' }]);
  });
});

describe('scorePressOf and dragExtends', () => {
  it('writes only in Pen, on notation, without Shift', () => {
    expect(scorePressOf('pen', 'notation', false)).toBe('write');
    expect(scorePressOf('select', 'notation', false)).toBe('caret');
    expect(scorePressOf('pen', 'tab', false)).toBe('caret');
    expect(scorePressOf('pen', null, false)).toBe('caret');
  });

  it('extends with Shift in either mode', () => {
    expect(scorePressOf('pen', 'notation', true)).toBe('extend');
    expect(scorePressOf('select', 'tab', true)).toBe('extend');
  });

  it('drags a range anywhere in Select, and only on tablature in Pen', () => {
    expect(dragExtends('select', 'notation')).toBeTrue();
    expect(dragExtends('select', null)).toBeTrue();
    expect(dragExtends('pen', 'tab')).toBeTrue();
    expect(dragExtends('pen', 'notation')).toBeFalse();
  });
});

describe('dragContinues', () => {
  it('goes on only while the drag is on and the primary button is still down', () => {
    expect(dragContinues(true, 1)).toBeTrue();
    expect(dragContinues(true, 3)).toBeTrue();
    // Released outside the score: alphaTab never heard the mouse-up, and the button is up.
    expect(dragContinues(true, 0)).toBeFalse();
    expect(dragContinues(true, 2)).toBeFalse();
    expect(dragContinues(false, 1)).toBeFalse();
  });
});

describe('dragTargetOf', () => {
  const tab: StaffSlot = { trackIndex: 1, staffIndex: 0, kind: 'tab' };
  const notation: StaffSlot = { trackIndex: 1, staffIndex: 0, kind: 'notation' };

  it('extends onto the staff under the pointer, and on tablature onto its string', () => {
    expect(dragTargetOf({ slot: tab, stringIndex: 3 }, at(0, 2, 1, 5))).toEqual({ trackIndex: 1, staffIndex: 0, stringIndex: 3 });
    expect(dragTargetOf({ slot: notation, stringIndex: null }, at(0, 2, 1, 5))).toEqual({ trackIndex: 1, staffIndex: 0, stringIndex: 5 });
  });

  it('stays on the caret\'s track, staff and string while the pointer crosses the gap between staves', () => {
    // Not track 0, which alphaTab's beat - hit across every staff of the system - would report.
    expect(dragTargetOf(null, { ...at(2, 1, 0, 4), staffIndex: 1 })).toEqual({ trackIndex: 2, staffIndex: 1, stringIndex: 4 });
  });
});

describe('seeksOnPress', () => {
  it('moves the playback position on a click that moves the caret or writes, while playback is stopped', () => {
    expect(seeksOnPress('caret', false)).toBeTrue();
    expect(seeksOnPress('write', false)).toBeTrue();
    expect(seeksOnPress('extend', false)).toBeFalse();
    expect(seeksOnPress('caret', true)).toBeFalse();
  });
});

describe('scoreRedrawOf', () => {
  it('engraves again only for a document it has not engraved, and otherwise redraws what sits over it', () => {
    const doc = ComposerService.createEmptyScore();

    expect(scoreRedrawOf(null, doc)).toBe('render');
    expect(scoreRedrawOf(doc, doc)).toBe('overlay');
    expect(scoreRedrawOf(doc, structuredClone(doc))).toBe('render');
  });
});

describe('caretSlotIndexOf and caretHalfStepsOf', () => {
  const slots: StaffSlot[] = [
    { trackIndex: 0, staffIndex: 0, kind: 'notation' },
    { trackIndex: 0, staffIndex: 0, kind: 'tab' },
    { trackIndex: 1, staffIndex: 0, kind: 'notation' }
  ];

  it('draws the caret before any click: on tablature for a string, on notation without one', () => {
    expect(caretSlotIndexOf(slots, at(0, 0, 0, 2), null)).toBe(1);
    expect(caretSlotIndexOf(slots, at(1, 0, 0, null), null)).toBe(2);
  });

  it('keeps the staff last clicked while it is still the caret\'s', () => {
    expect(caretSlotIndexOf(slots, at(0, 1, 2), 0)).toBe(0);
    expect(caretSlotIndexOf(slots, at(1, 1, 2, null), 0)).toBe(2);
  });

  it('finds no staff for a caret on a track that draws none', () => {
    expect(caretSlotIndexOf(slots, at(4, 0, 0), null)).toBeNull();
  });

  it('does not keep a clicked staff of another track', () => {
    // Track 1's notation was clicked; the caret has since moved to track 0, with a string.
    expect(caretSlotIndexOf(slots, at(0, 0, 0, 2), 2)).toBe(1);
  });

  it('draws on the caret\'s other staff when the kind it wants is not drawn', () => {
    // Track 1 draws no tablature: a caret there with a string still draws on its notation.
    expect(caretSlotIndexOf(slots, at(1, 0, 0, 3), null)).toBe(2);
    // Track 0's notation hidden: a caret with no string draws on its tablature.
    expect(caretSlotIndexOf([slots[1], slots[2]], at(0, 0, 0, null), null)).toBe(0);
  });

  it('puts a tablature caret on a staff with no strings on the bottom line, not below it', () => {
    expect(caretHalfStepsOf('tab', 0, 0, null)).toBe(0);
    expect(caretHalfStepsOf('tab', 0, null, null)).toBe(0);
  });

  it('puts a tablature caret on its string, and a notation caret where it was clicked or on the middle line', () => {
    // Six lines, string 1 on top: string 1 is 10 half-steps above the bottom line, string 6 is 0.
    expect(caretHalfStepsOf('tab', 6, 0, null)).toBe(10);
    expect(caretHalfStepsOf('tab', 6, 5, null)).toBe(0);
    expect(caretHalfStepsOf('notation', 0, null, 7)).toBe(7);
    expect(caretHalfStepsOf('notation', 0, null, null)).toBe(4);
  });
});

describe('highlightEndsOf', () => {
  it('runs from the range\'s first beat to its last, whichever end was clicked first', () => {
    const doc = ComposerService.createEmptyScore();

    const ends = highlightEndsOf(doc, at(0, 1, 2), at(0, 0, 3));

    expect(ends?.first).toEqual({ trackIndex: 0, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 3 });
    expect(ends?.last).toEqual({ trackIndex: 0, staffIndex: 0, barIndex: 1, voiceIndex: 0, beatIndex: 2 });
  });

  it('runs across tracks from the first track\'s first beat to the last track\'s last beat, whole bars', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    const lastBeat = doc.tracks[1].staves[0].bars[1].voices[0].beats.length - 1;

    // The anchor on track 1 bar 2, the caret on track 0 bar 1: a rectangle of bars 1-2 on both tracks.
    const ends = highlightEndsOf(doc, at(1, 1, 0, null), at(0, 0, 2));

    expect(ends?.first).toEqual({ trackIndex: 0, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 });
    expect(ends?.last).toEqual({ trackIndex: 1, staffIndex: 0, barIndex: 1, voiceIndex: 0, beatIndex: lastBeat });
  });

  it('draws nothing for the caret alone', () => {
    const doc = ComposerService.createEmptyScore();

    expect(highlightEndsOf(doc, null, at(0, 0, 0))).toBeNull();
    expect(highlightEndsOf(doc, at(0, 0, 1), at(0, 0, 1))).toBeNull();
  });
});

describe('penHoverHalfStepsOf, snappedHoverX and hoverKeyOf', () => {
  it('places a hover notehead only in Pen, over notation, with a clef that has pitches', () => {
    // Treble clef's bottom line is E4, diatonic 30; G4, 32, is two half-steps above it.
    expect(penHoverHalfStepsOf('pen', 'notation', 32, 'g2')).toBe(2);
    expect(penHoverHalfStepsOf('select', 'notation', 32, 'g2')).toBeNull();
    expect(penHoverHalfStepsOf('pen', 'tab', 32, 'g2')).toBeNull();
    expect(penHoverHalfStepsOf('pen', 'notation', null, 'g2')).toBeNull();
    expect(penHoverHalfStepsOf('pen', 'notation', 32, 'n')).toBeNull();
  });

  it('counts from the bass clef\'s bottom line, and below a staff as well as above it', () => {
    // Bass clef's bottom line is G2, diatonic 18: B2, 20, is two half-steps above it, and E2, 16, two below.
    expect(penHoverHalfStepsOf('pen', 'notation', 20, 'f4')).toBe(2);
    expect(penHoverHalfStepsOf('pen', 'notation', 16, 'f4')).toBe(-2);
    // B3, 27, on a ledger line below the treble staff.
    expect(penHoverHalfStepsOf('pen', 'notation', 27, 'g2')).toBe(-3);
  });

  it('snaps the notehead\'s position to half a line spacing', () => {
    expect(snappedHoverX(101.5, 8)).toBe(100);
    expect(snappedHoverX(106.2, 8)).toBe(108);
    expect(snappedHoverX(6.4, 0)).toBe(6);
  });

  it('names a hover by what it draws, so a move within one snapped position changes nothing', () => {
    const key = hoverKeyOf(1, 4, 100, 8, 0);

    expect(hoverKeyOf(1, 4, snappedHoverX(101.5, 8), 8, 0)).toBe(key);
    expect(hoverKeyOf(2, 4, 100, 8, 0)).not.toBe(key);
    expect(hoverKeyOf(1, 5, 100, 8, 0)).not.toBe(key);
    expect(hoverKeyOf(1, 4, 104, 8, 0)).not.toBe(key);
    expect(hoverKeyOf(1, 4, 100, 8, 40)).not.toBe(key);
  });
});

describe('hoverSurvives', () => {
  it('keeps the hover notehead only while Pen is on and the document is the one it was drawn over', () => {
    const doc = ComposerService.createEmptyScore();

    // A caret move or a selection keeps the document.
    expect(hoverSurvives({ doc, entryMode: 'pen' }, { doc, entryMode: 'pen' })).toBeTrue();
    expect(hoverSurvives({ doc, entryMode: 'pen' }, { doc, entryMode: 'select' })).toBeFalse();
    // A write, an undo: the engraving under the notehead is about to move.
    expect(hoverSurvives({ doc, entryMode: 'pen' }, { doc: structuredClone(doc), entryMode: 'pen' })).toBeFalse();
    expect(hoverSurvives(null, { doc, entryMode: 'pen' })).toBeFalse();
  });
});

describe('sameCaret', () => {
  it('is the same caret only on the same track, staff, bar, voice, beat and string', () => {
    const caret: EditCursor = at(1, 2, 3, 4);

    expect(sameCaret(caret, { ...caret })).toBeTrue();
    expect(sameCaret(caret, { ...caret, stringIndex: 5 })).toBeFalse();
    expect(sameCaret(caret, { ...caret, stringIndex: null })).toBeFalse();
    expect(sameCaret(caret, { ...caret, voiceIndex: 1 })).toBeFalse();
    expect(sameCaret(caret, { ...caret, beatIndex: 0 })).toBeFalse();
    expect(sameCaret(caret, { ...caret, staffIndex: 1 })).toBeFalse();
  });
});

describe('writeSounds', () => {
  it('sounds a Pen note only when the write changed the document, not when it was refused', () => {
    const doc = ComposerService.createEmptyScore();

    expect(writeSounds(doc, doc)).toBeFalse();
    expect(writeSounds(doc, structuredClone(doc))).toBeTrue();
  });
});
