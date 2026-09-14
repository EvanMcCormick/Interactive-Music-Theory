import { ComposerService } from './composer.service';
import {
  StaffSlot,
  caretHalfStepsOf,
  caretSlotIndexOf,
  dragContinues,
  dragExtends,
  highlightEndsOf,
  hoverKeyOf,
  penHoverHalfStepsOf,
  scorePressOf,
  scoreRedrawOf,
  seeksOnPress,
  snappedHoverX,
  staffSlotsOf
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
