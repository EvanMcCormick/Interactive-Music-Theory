import { TestBed } from '@angular/core/testing';

import { ProgressionService } from './progression.service';
import {
  ChordDegree,
  ChordSlot,
  ProgressionState,
  RollNote,
  SlotHarmony
} from '../models/progression.model';

/**
 * Recognition wired to a gesture: when a slot is read back, what the reading
 * costs in undo steps, and how the user takes it back.
 *
 * The recogniser itself is pinned in `progression-recognise.spec.ts` - what a
 * set of notes parses as, how the readings are ranked, what the round trip
 * guarantees. None of that is retested here. This file is about the four things
 * only the service can answer:
 *
 *  1. **Which edits reach it.** A setter that claims the pitches, and no other.
 *     `setNoteTiming` and `setNoteVelocity` can change which notes are
 *     structural and must still never change what a slot is called - the M1 rule
 *     the whole milestone rests on.
 *  2. **How many undo steps a relabel costs.** One, together with the notes that
 *     caused it, whether the edit was a single call or a drag that committed
 *     forty times.
 *  3. **When the chip goes away.** `ProgressionState.relabel` is page state, so
 *     every document change, every selection change and every step through the
 *     history takes it down.
 *  4. **The three ways out**: another reading, the old label back with the notes
 *     kept, and the door marked `user-detached` that the recogniser never opens
 *     again.
 *
 * ## Why this is not in `progression.service.spec.ts`
 *
 * That file was over three times the project's 1000-line cap, and M3 Tasks 6 and
 * 8 both declined to grow it further - a second topic-named spec with its own
 * local fixtures, the two cross-referencing. `progression.service.tensions.spec.ts`
 * and `progression.service.literal.spec.ts` are the two precedents; this is the
 * third. What the roll's setters do to *notes* is untouched here.
 *
 * The end of M3 split that file five ways on the same argument, so those
 * setters are now `progression.service.roll.spec.ts`, which is the file this
 * one sits beside.
 */
describe('ProgressionService: recognition on a pitch edit', () => {
  let service: ProgressionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProgressionService);
  });

  function currentState(): ProgressionState {
    let captured: ProgressionState | undefined;
    service.getState().subscribe(value => (captured = value)).unsubscribe();
    if (captured === undefined) throw new Error('getState published nothing on subscribe');
    return captured;
  }

  function slot(id: string): ChordSlot {
    const found = currentState().doc.slots.find(candidate => candidate.id === id);
    if (!found) throw new Error(`no slot ${id}`);
    return found;
  }

  function harmonyOf(id: string): SlotHarmony {
    return slot(id).harmony;
  }

  function degreeOf(id: string): ChordDegree {
    const harmony = harmonyOf(id);
    if (harmony.kind !== 'degree') throw new Error(`slot ${id} is literal`);
    return harmony.degree;
  }

  function midiOf(id: string): number[] {
    return slot(id).notes.map(note => note.midi);
  }

  /** A fresh slot on `degree`, and its id. `appendSlot` selects it too. */
  function append(degree: number): string {
    service.appendSlot(degree);
    const slots = currentState().doc.slots;
    return slots[slots.length - 1].id;
  }

  /**
   * A copy of a slot's notes, detached from the document.
   *
   * Copied because a drag's "before" is a snapshot taken at pointerdown and the
   * document is replaced on every commit - the roll's `Gesture.notes` is exactly
   * this, and passing the live array would be testing something the roll never
   * does.
   */
  function notesOf(id: string): RollNote[] {
    return slot(id).notes.map(note => ({ ...note }));
  }

  /** The same notes with one of them on a different pitch. */
  function withMidi(notes: readonly RollNote[], index: number, midi: number): RollNote[] {
    return notes.map((note, at) => (at === index ? { ...note, midi } : { ...note }));
  }

  /** The same notes with one more on `midi`, sounding the whole slot. */
  function plus(notes: readonly RollNote[], midi: number): RollNote[] {
    return [...notes.map(note => ({ ...note })), { ...notes[0], midi }];
  }

  // -------------------------------------------------------------------------
  // When it runs
  // -------------------------------------------------------------------------

  /**
   * The one-shot case, and the undo promise that goes with it.
   *
   * A flat seventh added to a `I` is the commonest way there is to make a
   * secondary dominant, and it moves two fields at once - `extent` and
   * `quality` - which is what the older "vary one attribute" design could not
   * see. One undo takes back the note and the numeral together, because the
   * recogniser commits inside the same entry the note did.
   */
  it('relabels on a one-shot pitch edit, in the same undo entry', () => {
    const id = append(0);

    service.setSlotNotes(id, plus(notesOf(id), 70));

    expect(degreeOf(id)).toEqual(
      jasmine.objectContaining({ degree: 0, extent: 7, quality: 'dominant7' })
    );
    expect(currentState().relabel?.slotId).toBe(id);

    service.undo();

    expect(midiOf(id)).toEqual([60, 64, 67]);
    expect(degreeOf(id).quality).toBeNull();
  });

  /**
   * The drag, which is the case the deferral exists for.
   *
   * Three commits under one run key, none of them recognising - the card must
   * not flicker through the chords the note is only travelling over - and then
   * one settle that folds the reading into the entry the drag opened. **One**
   * undo takes back the notes and the label.
   */
  it('defers a drag to its end, and folds the relabel into the drag', () => {
    const id = append(0);
    const before = notesOf(id);

    service.placeNotes(id, withMidi(before, 1, 65), { deferRecognition: true });
    service.placeNotes(id, withMidi(before, 1, 66), { coalesce: true, deferRecognition: true });
    service.placeNotes(id, withMidi(before, 1, 65), { coalesce: true, deferRecognition: true });

    expect(degreeOf(id).suspension).toBe('none');
    expect(currentState().relabel).toBeNull();

    expect(service.settlePitchGesture(id, before)).toBeTrue();

    expect(degreeOf(id).suspension).toBe('sus4');
    expect(currentState().relabel?.slotId).toBe(id);

    service.undo();

    expect(midiOf(id)).toEqual([60, 64, 67]);
    expect(degreeOf(id).suspension).toBe('none');
  });

  /**
   * A drag that ended where it began has nothing to read and records nothing.
   * It answers so, on `writeNotes`' terms: a caller that counted its own calls
   * instead would be counting something else.
   */
  it('records nothing when a settled gesture left the notes as they were', () => {
    const id = append(0);
    const before = notesOf(id);

    expect(service.settlePitchGesture(id, before)).toBeFalse();
    expect(currentState().canUndo).toBeTrue(); // the append, and nothing since
  });

  /**
   * M1's rule, and the one this milestone is most able to break. Moving the
   * third off the downbeat and shortening it to a sixteenth takes it out of the
   * structural set entirely - the slot now sounds C and G at the downbeat - and
   * the label does not move a millimetre, because a timing edit never reaches
   * the recogniser at all.
   */
  it('never recognises on a timing edit', () => {
    const id = append(0);

    service.setNoteTiming(id, 1, 3.75, 0.25);

    expect(degreeOf(id)).toEqual(jasmine.objectContaining({ degree: 0, quality: null }));
    expect(currentState().relabel).toBeNull();
  });

  /** The same rule on the third axis: dynamics say nothing about harmony. */
  it('never recognises on a velocity edit', () => {
    const id = append(0);

    service.setNoteVelocity(id, 0, 42);

    expect(degreeOf(id)).toEqual(jasmine.objectContaining({ degree: 0, quality: null }));
    expect(currentState().relabel).toBeNull();
  });

  /**
   * Nothing fits, so the slot keeps every note and loses its numeral - the rule
   * the whole strip is built on. The notice still goes out, because the chip has
   * to say so: `No chord matches`, and what it was.
   */
  it('degrades to literal, keeping the degree it fell from', () => {
    const id = append(0);
    const notes = notesOf(id);

    service.setSlotNotes(id, [
      { ...notes[0], midi: 60 },
      { ...notes[0], midi: 61 },
      { ...notes[0], midi: 62 }
    ]);

    const harmony = harmonyOf(id);
    expect(harmony.kind).toBe('literal');
    if (harmony.kind !== 'literal') throw new Error('unreachable');
    expect(harmony.reason).toBe('unrecognised');
    expect(harmony.from).toEqual(jasmine.objectContaining({ degree: 0 }));

    const notice = currentState().relabel;
    expect(notice?.current.kind).toBe('literal');
    expect(notice?.previous.kind).toBe('degree');
    expect(notice?.alternates).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // What clears the notice
  // -------------------------------------------------------------------------

  /**
   * Page state, so anything that moves the page takes it down. The three below
   * are the three the design doc names, and the last is the one with a reason
   * beyond tidiness: an undo can take away the very relabel the chip describes.
   */
  it('clears the notice on the next document change', () => {
    const id = append(0);
    service.setSlotNotes(id, plus(notesOf(id), 70));
    expect(currentState().relabel).not.toBeNull();

    service.setTempo(90);

    expect(currentState().relabel).toBeNull();
  });

  it('clears the notice on a selection change', () => {
    const id = append(0);
    service.setSlotNotes(id, plus(notesOf(id), 70));

    service.selectSlot(null);

    expect(currentState().relabel).toBeNull();
  });

  it('clears the notice on undo, and on redo', () => {
    const id = append(0);
    service.setSlotNotes(id, plus(notesOf(id), 70));

    service.undo();
    expect(currentState().relabel).toBeNull();

    service.redo();
    expect(currentState().relabel).toBeNull();
  });

  // -------------------------------------------------------------------------
  // The three ways out
  // -------------------------------------------------------------------------

  /**
   * *Back to `I`*, and the half of it that is easy to get wrong: the notes stay.
   *
   * Reverting is not an undo. The user played a flat seventh on purpose and is
   * saying only that it is not a new chord, so throwing the note away would
   * discard the edit that was the point of the gesture.
   */
  it('keeps the notes when the label is put back', () => {
    const id = append(0);
    service.setSlotNotes(id, plus(notesOf(id), 70));

    expect(service.revertRelabel(id)).toBeTrue();

    expect(degreeOf(id).quality).toBeNull();
    expect(midiOf(id)).toEqual([60, 64, 67, 70]);
    expect(currentState().relabel).toBeNull();
  });

  /** Its own undo entry: two decisions, two steps back. */
  it('makes reverting a step of its own', () => {
    const id = append(0);
    service.setSlotNotes(id, plus(notesOf(id), 70));
    service.revertRelabel(id);

    service.undo();

    expect(degreeOf(id).quality).toBe('dominant7');
    expect(midiOf(id)).toEqual([60, 64, 67, 70]);
  });

  /** A notice for another slot is no evidence about this one. */
  it('refuses to revert a slot the notice does not name', () => {
    const first = append(0);
    const second = append(4);
    service.setSlotNotes(first, plus(notesOf(first), 70));

    expect(service.revertRelabel(second)).toBeFalse();
  });

  /**
   * The chip's runners-up are other numerals for the notes that are there, so
   * picking one moves the label and nothing else.
   */
  it('takes an alternate reading, keeping the notes', () => {
    const id = append(0);
    service.setSlotNotes(id, plus(notesOf(id), 69)); // C E G A

    const alternates = currentState().relabel?.alternates ?? [];
    expect(alternates.length).toBeGreaterThan(0);

    expect(service.chooseRelabelAlternate(id, alternates[0])).toBeTrue();

    expect(degreeOf(id)).toEqual(jasmine.objectContaining({ degree: alternates[0].degree }));
    expect(midiOf(id)).toEqual([60, 64, 67, 69]);
    expect(currentState().relabel).toBeNull();
  });

  /**
   * *Keep as literal*, and the promise that makes it different from the
   * degradation above: `user-detached` is never re-read. A second pitch edit on
   * a detached slot leaves the label exactly where the user put it, which is the
   * only way saying it once can mean anything.
   */
  it('detaches a slot on keep-as-literal, and never re-reads it', () => {
    const id = append(0);
    service.setSlotNotes(id, plus(notesOf(id), 70));

    expect(service.keepAsLiteral(id)).toBeTrue();

    const detached = harmonyOf(id);
    expect(detached.kind).toBe('literal');
    if (detached.kind !== 'literal') throw new Error('unreachable');
    expect(detached.reason).toBe('user-detached');
    // The reading it was carrying, kept so Reset to chord still leads back out.
    expect(detached.from).toEqual(jasmine.objectContaining({ quality: 'dominant7' }));

    service.setSlotNotes(id, withMidi(notesOf(id), 1, 65));

    expect(harmonyOf(id)).toEqual(jasmine.objectContaining({ reason: 'user-detached' }));
    expect(currentState().relabel).toBeNull();
  });

  /**
   * And nothing recognises in a key that cannot stack thirds. There is no degree
   * to express anything as, so a hand-edited slot keeps the label it had rather
   * than being punished for the key it is in.
   */
  it('recognises nothing in a key that can build no chords', () => {
    const id = append(0);
    service.setKey(0, 'majorPentatonic');

    service.setSlotNotes(id, plus(notesOf(id), 70));

    expect(degreeOf(id).quality).toBeNull();
    expect(currentState().relabel).toBeNull();
  });
});
