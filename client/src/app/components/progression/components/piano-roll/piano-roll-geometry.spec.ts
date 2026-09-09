import {
  MAX_BEAT_DIVISION,
  MIN_VISIBLE_SEMITONES,
  PITCH_PADDING_SEMITONES,
  beatToX,
  midiToY,
  rowCount,
  snapBeat,
  visibleMidiRange,
  xToBeat,
  yToMidi
} from './piano-roll-geometry';
import { MIN_NOTE_BEATS, VOICING_BASE_MIDI } from '../../../../models/progression-normalize';
import type { RollNote } from '../../../../models/progression.model';

/**
 * The roll's coordinate arithmetic, checked against a table.
 *
 * The same split, and for the same reason, as
 * `progression-strip-gestures.spec.ts`: a pointer position and some geometry go
 * in, a beat or a pitch comes out, and none of that needs a browser to pin
 * down. What a real `PointerEvent` on a rendered roll does before it reaches
 * here, and which service call the component makes with the answer, is Task 7's
 * component spec - written with live `getBoundingClientRect()` coordinates,
 * because the strip's review proved that half cannot be skipped.
 *
 * The load-bearing test in this file is not the round trip. A round trip holds
 * for a mapping wrong in the way M1's strip was wrong, because a proportional
 * layout is still perfectly invertible. What it is not is *translation
 * invariant*, and that is what `moves a note by exactly the pixels the pointer
 * moved` asserts.
 */

/** A pitch at a beat. The fields the geometry does not read are filled plausibly. */
function note(midi: number): RollNote {
  return { midi, startBeat: 0, lengthBeats: 1, velocity: 80 };
}

/** A comfortable roll: a beat is 64 pixels wide and a semitone 12 tall. */
const PX_PER_BEAT = 64;
const ROW_HEIGHT = 12;

describe('beatToX and xToBeat', () => {
  it('places a beat at its own multiple of the beat width', () => {
    expect(beatToX(0, PX_PER_BEAT)).toBe(0);
    expect(beatToX(1, PX_PER_BEAT)).toBe(64);
    expect(beatToX(4, PX_PER_BEAT)).toBe(256);
  });

  /** Free timing, so a fractional beat is an ordinary position rather than an edge case. */
  it('places a fraction of a beat proportionally', () => {
    expect(beatToX(0.5, PX_PER_BEAT)).toBe(32);
    expect(beatToX(2.25, PX_PER_BEAT)).toBe(144);
  });

  it('reads a pixel back as the beat it stands on', () => {
    expect(xToBeat(0, PX_PER_BEAT)).toBe(0);
    expect(xToBeat(64, PX_PER_BEAT)).toBe(1);
    expect(xToBeat(32, PX_PER_BEAT)).toBe(0.5);
  });

  it('round-trips a beat through pixels and back', () => {
    for (const beat of [0, 0.25, 1, 3.5, 17.75]) {
      expect(xToBeat(beatToX(beat, PX_PER_BEAT), PX_PER_BEAT)).toBeCloseTo(beat, 9);
    }
  });

  /**
   * The reason this file exists.
   *
   * M1's strip laid its cards out with `flex-grow`, so the pixels a beat was
   * worth depended on the card's own length, and the resize handle drifted up
   * to 525 pixels from the cursor. The roll is absolute - `width: calc(var(
   * --px-per-beat) * beats)` - and this is the property that buys: the beats a
   * pointer displacement is worth are the same wherever the drag started.
   *
   * A round trip would not have caught the old bug, because a proportional
   * mapping inverts perfectly well. Translation invariance is what it fails.
   */
  it('moves a note by exactly the pixels the pointer moved', () => {
    const displacement = 37;

    for (const from of [0, 100, 512, 3333, 40000]) {
      const moved = xToBeat(from + displacement, PX_PER_BEAT) - xToBeat(from, PX_PER_BEAT);
      // The displacement in beats, and it does not depend on `from`.
      expect(moved).toBeCloseTo(xToBeat(displacement, PX_PER_BEAT), 9);
      // And back in pixels it is the pixels the pointer travelled, exactly.
      expect(beatToX(moved, PX_PER_BEAT)).toBeCloseTo(displacement, 9);
    }
  });

  it('carries a leftward drag the same distance as a rightward one', () => {
    const there = xToBeat(1000 + 90, PX_PER_BEAT) - xToBeat(1000, PX_PER_BEAT);
    const back = xToBeat(1000, PX_PER_BEAT) - xToBeat(1000 + 90, PX_PER_BEAT);
    expect(there).toBeCloseTo(-back, 9);
    expect(beatToX(there, PX_PER_BEAT)).toBeCloseTo(90, 9);
  });

  /**
   * The guard `draggedBeats` has, for the reason it has it: dividing by a scale
   * that is not a positive number manufactures `Infinity` or `NaN` out of a
   * finite pointer position, and `normalizeRollNote` throws on both - which
   * aborts the gesture from inside a pointer handler rather than declining it.
   */
  it('declines to read a position when there is no beat width to divide by', () => {
    expect(xToBeat(500, 0)).toBe(0);
    expect(xToBeat(500, -64)).toBe(0);
    expect(xToBeat(500, Number.NaN)).toBe(0);
    expect(xToBeat(500, Number.POSITIVE_INFINITY)).toBe(0);
  });

  /** And the decline reads as "the drag did not move", which is what a drag asks. */
  it('declines by answering no displacement at all', () => {
    expect(xToBeat(900, 0) - xToBeat(100, 0)).toBe(0);
  });
});

describe('midiToY and yToMidi', () => {
  const TOP_MIDI = 84;

  it('puts the top pitch of the window on the top row', () => {
    expect(midiToY(TOP_MIDI, TOP_MIDI, ROW_HEIGHT)).toBe(0);
  });

  it('walks down one row per semitone', () => {
    expect(midiToY(83, TOP_MIDI, ROW_HEIGHT)).toBe(12);
    expect(midiToY(72, TOP_MIDI, ROW_HEIGHT)).toBe(144);
    expect(midiToY(60, TOP_MIDI, ROW_HEIGHT)).toBe(288);
  });

  /**
   * The axis is inverted, and this is the assertion that says so. Higher pitch
   * is higher on screen, so `y` *decreases* as `midi` increases - the kind of
   * thing that looks right until someone drags upward.
   */
  it('draws a higher pitch higher on the screen', () => {
    expect(midiToY(72, TOP_MIDI, ROW_HEIGHT)).toBeLessThan(
      midiToY(71, TOP_MIDI, ROW_HEIGHT)
    );
  });

  it('reads a row back as the pitch that owns it', () => {
    expect(yToMidi(0, TOP_MIDI, ROW_HEIGHT)).toBe(84);
    expect(yToMidi(12, TOP_MIDI, ROW_HEIGHT)).toBe(83);
    expect(yToMidi(288, TOP_MIDI, ROW_HEIGHT)).toBe(60);
  });

  /**
   * `midiToY` answers a row's *top* edge, so every pixel from there to just
   * short of the next one belongs to the same pitch. Floor rather than round;
   * rounding would put half of each row on its neighbour and offset the whole
   * grid by half a semitone.
   */
  it('reads every pixel of a row as the same pitch', () => {
    expect(yToMidi(0, TOP_MIDI, ROW_HEIGHT)).toBe(84);
    expect(yToMidi(11, TOP_MIDI, ROW_HEIGHT)).toBe(84);
    expect(yToMidi(11.99, TOP_MIDI, ROW_HEIGHT)).toBe(84);
    expect(yToMidi(12, TOP_MIDI, ROW_HEIGHT)).toBe(83);
  });

  it('round-trips a pitch through pixels and back', () => {
    for (const midi of [84, 80, 72, 61, 60]) {
      expect(yToMidi(midiToY(midi, TOP_MIDI, ROW_HEIGHT), TOP_MIDI, ROW_HEIGHT)).toBe(midi);
    }
  });

  /** Dragging up raises the pitch. The whole point of the inversion. */
  it('raises the pitch as the pointer moves up', () => {
    const start = midiToY(72, TOP_MIDI, ROW_HEIGHT);
    expect(yToMidi(start - ROW_HEIGHT, TOP_MIDI, ROW_HEIGHT)).toBe(73);
    expect(yToMidi(start - 3 * ROW_HEIGHT, TOP_MIDI, ROW_HEIGHT)).toBe(75);
    expect(yToMidi(start + 2 * ROW_HEIGHT, TOP_MIDI, ROW_HEIGHT)).toBe(70);
  });

  /** The same invariance the beat axis has, in the axis that is easier to get backwards. */
  it('moves a note by exactly the rows the pointer crossed', () => {
    for (const from of [0, 7, 144, 1000]) {
      const up = yToMidi(from - 5 * ROW_HEIGHT, TOP_MIDI, ROW_HEIGHT)
        - yToMidi(from, TOP_MIDI, ROW_HEIGHT);
      expect(up).toBe(5);
    }
  });

  /**
   * A pointer dragged above the window is a pitch above the window, not a pitch
   * pinned to its top. The window follows the notes; see `visibleMidiRange`.
   */
  it('reads a pointer above the window as a pitch above it', () => {
    expect(yToMidi(-1, TOP_MIDI, ROW_HEIGHT)).toBe(85);
    expect(yToMidi(-12, TOP_MIDI, ROW_HEIGHT)).toBe(85);
    expect(yToMidi(-13, TOP_MIDI, ROW_HEIGHT)).toBe(86);
  });

  it('declines to read a pitch when there is no row height to divide by', () => {
    expect(yToMidi(500, TOP_MIDI, 0)).toBe(TOP_MIDI);
    expect(yToMidi(500, TOP_MIDI, -12)).toBe(TOP_MIDI);
    expect(yToMidi(500, TOP_MIDI, Number.NaN)).toBe(TOP_MIDI);
  });

  it('declines by answering no displacement at all', () => {
    expect(yToMidi(900, TOP_MIDI, 0) - yToMidi(100, TOP_MIDI, 0)).toBe(0);
  });
});

describe('snapBeat', () => {
  it('leaves a position already on the grid where it is', () => {
    expect(snapBeat(2, 4)).toBe(2);
    expect(snapBeat(2.25, 4)).toBe(2.25);
  });

  it('pulls a position to the nearest grid line', () => {
    expect(snapBeat(1.3, 4)).toBe(1.25);
    expect(snapBeat(1.4, 4)).toBe(1.5);
    expect(snapBeat(0.1, 4)).toBe(0);
  });

  /**
   * The tie. A position exactly halfway between two grid lines lands on the
   * later one, which is `Math.round`'s own rule and arbitrary - but it has to
   * be *stated*, because it is the boundary a drag rests on and the one a
   * mutant flips.
   */
  it('breaks a tie in favour of the later grid line', () => {
    expect(snapBeat(0.125, 4)).toBe(0.25);
    expect(snapBeat(0.375, 4)).toBe(0.5);
    expect(snapBeat(0.5, 1)).toBe(1);
  });

  it('snaps to whole beats at a division of one', () => {
    expect(snapBeat(3.4, 1)).toBe(3);
    expect(snapBeat(3.6, 1)).toBe(4);
  });

  it('snaps a triplet grid without drifting off it', () => {
    expect(snapBeat(0.3, 3)).toBeCloseTo(1 / 3, 9);
    expect(snapBeat(0.7, 3)).toBeCloseTo(2 / 3, 9);
  });

  /**
   * The finest grid the roll may offer is the shortest note the model will
   * store. Finer than this and a resize snapped to the grid asks for a note
   * `boundNoteLength` then clamps back off it, so the edge would not sit where
   * the grid said it would.
   */
  it('reaches exactly the shortest note at its finest division', () => {
    expect(MAX_BEAT_DIVISION).toBe(16);
    expect(1 / MAX_BEAT_DIVISION).toBe(MIN_NOTE_BEATS);
    expect(snapBeat(MIN_NOTE_BEATS, MAX_BEAT_DIVISION)).toBe(MIN_NOTE_BEATS);
  });

  /**
   * No grid is free timing, which is what the roll is for - so this one has a
   * true identity to decline with, where the two divisions above have only the
   * origin.
   */
  it('leaves a position alone when there is no grid to snap it to', () => {
    expect(snapBeat(1.37, 0)).toBe(1.37);
    expect(snapBeat(1.37, -4)).toBe(1.37);
    expect(snapBeat(1.37, Number.NaN)).toBe(1.37);
    expect(snapBeat(1.37, Number.POSITIVE_INFINITY)).toBe(1.37);
  });
});

describe('visibleMidiRange', () => {
  it('pads the notes it is given on both sides', () => {
    const range = visibleMidiRange([note(40), note(100)]);
    expect(range.low).toBe(40 - PITCH_PADDING_SEMITONES);
    expect(range.high).toBe(100 + PITCH_PADDING_SEMITONES);
  });

  /**
   * A single note is five rows once padded, and a five-row grid is not a piano
   * roll. The floor keeps the grid the same height whether the slot holds one
   * note or a thirteenth chord, so adding a note does not resize the page.
   */
  it('opens the window to two octaves around a single note', () => {
    const range = visibleMidiRange([note(60)]);
    expect(range.high - range.low).toBe(MIN_VISIBLE_SEMITONES);
    expect(range.low).toBe(48);
    expect(range.high).toBe(72);
  });

  /** An odd semitone left over goes above, because a voicing grows upward. */
  it('gives an odd remainder to the top', () => {
    const range = visibleMidiRange([note(60), note(67)]);
    expect(range.high - range.low).toBe(MIN_VISIBLE_SEMITONES);
    expect(range.low).toBe(52);
    expect(range.high).toBe(76);
  });

  it('leaves a window already wider than the floor alone', () => {
    const range = visibleMidiRange([note(40), note(100)]);
    expect(range.high - range.low).toBe(64);
  });

  /**
   * An empty slot still needs a canvas. Two octaves up from middle C is where
   * the notes will appear - `generateSlotNotes` stacks from `VOICING_BASE_MIDI`
   * at octave 0 - so the grid does not jump the moment the first one arrives.
   */
  it('opens on two octaves from middle C when the slot is empty', () => {
    expect(visibleMidiRange([])).toEqual({
      low: VOICING_BASE_MIDI,
      high: VOICING_BASE_MIDI + MIN_VISIBLE_SEMITONES
    });
  });

  it('does not care what order the notes arrive in', () => {
    expect(visibleMidiRange([note(72), note(60), note(64)]))
      .toEqual(visibleMidiRange([note(60), note(64), note(72)]));
  });

  /**
   * `RollNote.midi` is deliberately unclamped - `boundNote` says so, and says
   * that where a pitch stops on screen is this file's decision. This is that
   * decision: the window follows the note. Clamping the window to MIDI's own
   * ends would hide a stored note rather than show the user what is there.
   */
  it('follows a note that sits outside MIDI range rather than hiding it', () => {
    const range = visibleMidiRange([note(200)]);
    expect(range.low).toBe(188);
    expect(range.high).toBe(212);
    expect(range.low).toBeGreaterThan(127);
  });
});

describe('rowCount', () => {
  /** Both ends are drawn, so a window of 24 semitones is 25 rows. */
  it('counts both ends of the window', () => {
    expect(rowCount({ low: 60, high: 84 })).toBe(25);
    expect(rowCount({ low: 60, high: 60 })).toBe(1);
    expect(rowCount(visibleMidiRange([]))).toBe(MIN_VISIBLE_SEMITONES + 1);
  });

  /** And it is the height the grid must be, in rows the two mappings agree on. */
  it('spans exactly the rows the mappings use', () => {
    const range = visibleMidiRange([note(60), note(64), note(67)]);
    expect(midiToY(range.low, range.high, ROW_HEIGHT) + ROW_HEIGHT)
      .toBe(rowCount(range) * ROW_HEIGHT);
  });
});
