import { TestBed } from '@angular/core/testing';

import { ComposerService } from './composer.service';
import { GeneratedTrack, progressionTrack } from './progression-track';
import { DEFAULT_VELOCITY } from '../models/progression-normalize';
import {
  ChordSlot,
  ProgressionDoc,
  createDefaultProgression,
  createDegreeSlot
} from '../models/progression.model';
import {
  ComposerState,
  GeneratedOrigin,
  NotePitch,
  TimeSignature,
  TrackDoc,
  effectiveTimeSignature
} from '../models/composer.model';

/**
 * The three commands that put a progression into a score, and the gate that
 * keeps the user out of what they wrote.
 *
 * `progression-track.spec.ts` has already checked the merge, the flatten and
 * the staleness read as pure functions, so nothing here re-checks them. What is
 * pinned below is only what the service adds around them, and each of the three
 * things it adds fails for a different reason:
 *
 *  - **Undo governs the marker.** Every write goes through `commit()`, so an
 *    Update is undoable like any edit and takes its marker back with it. That
 *    is the property the whole explicit-Update design rests on - the design
 *    doc's "Update is pressed, not inferred" argues it, and the spec three
 *    below is the one that would catch a rebuild that skipped `commit()`.
 *  - **The gate is a refusal, not a disabled button.** A command that reaches
 *    the service has to refuse there; a component that hid the key is one
 *    keyboard shortcut away from not having hidden it. It gates notes and
 *    beats and nothing else, so the caret can still rest on a generated track.
 *  - **Divergence is stamped by the commands that cause it.** `insertBar` and
 *    `removeBar` move a generated track's content while the progression's
 *    revision stands still, which is the one hole the counter cannot see. The
 *    stamp goes on the draft inside the same `commit()`, so an undo takes it
 *    back - pinned separately, because a stamp applied after the commit or by a
 *    subscriber would pass the spec that only checks the insertion.
 */
describe('ComposerService generated tracks', () => {
  let service: ComposerService;

  const IONIAN = [0, 2, 4, 5, 7, 9, 11];
  const THREE_FOUR: TimeSignature = { numerator: 3, denominator: 4, isCommon: false };

  /** Middle C, the pitch a note-entry command writes on a pitched staff. */
  const MIDDLE_C: NotePitch = { kind: 'pitched', noteValue: 0, octave: 4 };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  /** One bar-long triad on `degree`, voiced from `midis`. */
  function slotOn(degree: number, startBeat: number, midis: number[]): ChordSlot {
    return {
      ...createDegreeSlot(degree, startBeat),
      lengthBeats: 4,
      notes: midis.map(midi => ({
        midi,
        startBeat: 0,
        lengthBeats: 4,
        velocity: DEFAULT_VELOCITY
      }))
    };
  }

  /** One bar-long C major triad, which is what the roll writes for I. */
  function slotOf(startBeat: number): ChordSlot {
    return slotOn(0, startBeat, [60, 64, 67]);
  }

  /**
   * A two-bar progression stamped with `revision`.
   *
   * The id is fixed across calls, because a Send and the Update that refreshes
   * it are the *same* progression at two revisions - `mergeGeneratedTrack`
   * matches on `progressionId`, so a fresh id per call would append a second
   * track and quietly pass the spec that says it does not.
   */
  function atRevision(revision: number): ProgressionDoc {
    return {
      ...createDefaultProgression(),
      id: 'prog-1',
      name: 'Verse',
      revision,
      slots: [slotOf(0), slotOf(4)]
    };
  }

  /**
   * That progression projected in the score's own meter.
   *
   * The meter is read off the score rather than assumed, because that is the
   * precondition `sendProgression` states: a track barred in the progression's
   * meter would share bar lines it disagrees with.
   */
  function built(doc: ProgressionDoc): GeneratedTrack {
    return progressionTrack(doc, IONIAN, effectiveTimeSignature(service.doc.masterBars, 0));
  }

  /**
   * The same progression revised so that its second chord is a V, not a I.
   *
   * Two revisions of an *identical* progression cannot tell "the marker was
   * restored" from "the whole track was restored", because the two candidate
   * tracks are byte-identical. Changing a chord is what gives the undo spec
   * something to distinguish.
   */
  function withFifth(doc: ProgressionDoc): ProgressionDoc {
    return { ...doc, slots: [slotOf(0), slotOn(4, 4, [67, 71, 74])] };
  }

  /** The track this progression generated, or a failure. */
  function generatedTrack(): TrackDoc {
    const found = service.doc.tracks.find(track => track.generated?.progressionId === 'prog-1');
    if (!found) throw new Error('no generated track in the score');
    return found;
  }

  /** The marker on that track, or a failure. */
  function marker(): GeneratedOrigin {
    const origin = generatedTrack().generated;
    if (!origin) throw new Error('no generated track in the score');
    return origin;
  }

  /** That track's music, with the marker that rides on it left out. */
  function generatedMusic(): string {
    return JSON.stringify(generatedTrack().staves);
  }

  /** The published state, for the fields that are not the document. */
  function state(): ComposerState {
    const seen: ComposerState[] = [];
    service
      .getState()
      .subscribe(value => seen.push(value))
      .unsubscribe();
    const latest = seen[seen.length - 1];
    if (!latest) throw new Error('the service published no state');
    return latest;
  }

  /** The caret parked on the generated track's first beat. */
  function caretOnGenerated(): void {
    const index = service.doc.tracks.findIndex(track => track.generated !== null);
    service.setCursor({ trackIndex: index, staffIndex: 0, barIndex: 0, beatIndex: 0 });
  }

  it('sends, and marks the track with the progression\'s revision', () => {
    service.sendProgression(built(atRevision(4)));

    expect(marker()).toEqual({
      progressionId: 'prog-1',
      progressionName: 'Verse',
      source: { kind: 'revision', revision: 4 }
    });
  });

  it('updates in place rather than appending a second', () => {
    service.sendProgression(built(atRevision(4)));
    const trackCount = service.doc.tracks.length;

    service.sendProgression(built(atRevision(9)));

    expect(service.doc.tracks.length).toBe(trackCount);
    expect(marker().source).toEqual({ kind: 'revision', revision: 9 });
  });

  it('restores the old track and its marker on undo, so the stale badge comes back', () => {
    // The property the whole explicit-Update design rests on. Every write is a
    // user action through commit(), so undo governs the marker too - and the
    // music with it, which is the sentence the design actually writes. The two
    // revisions differ in a chord so that a restored marker over rebuilt music
    // could not pass this.
    service.sendProgression(built(atRevision(4)));
    const music = generatedMusic();
    service.sendProgression(built(withFifth(atRevision(9))));
    expect(generatedMusic()).not.toBe(music);

    service.undo();

    expect(marker().source).toEqual({ kind: 'revision', revision: 4 });
    expect(generatedMusic()).toBe(music);
  });

  it('refuses a projection barred in a meter the score does not use', () => {
    // Not a user's mistake but a caller's: the merged track shares the score's
    // masterBars, so bars written in 3/4 would sit under 4/4 bar lines. Loud,
    // because the silent version writes music that disagrees with its own
    // barring into a document the user has been working in.
    const wrongMeter = progressionTrack(atRevision(4), IONIAN, THREE_FOUR);

    // The message names `scoreMeter`, because the fix is at the call site and a
    // call site has no `score` variable to read the longhand off.
    expect(() => service.sendProgression(wrongMeter)).toThrowError(/scoreMeter/);
    expect(service.doc.tracks.every(track => track.generated === null)).toBeTrue();
  });

  it('offers the meter a caller has to build against', () => {
    // The contract as a getter rather than a line of prose: `scoreMeter` is the
    // one expression that always satisfies the check above.
    const inScoreMeter = progressionTrack(atRevision(4), IONIAN, service.scoreMeter);

    expect(() => service.sendProgression(inScoreMeter)).not.toThrow();
    expect(marker().source).toEqual({ kind: 'revision', revision: 4 });
  });

  it('refuses a note written into a generated track', () => {
    service.sendProgression(built(atRevision(4)));
    caretOnGenerated();
    const before = JSON.stringify(service.doc.tracks);

    service.setNoteAtCursor(MIDDLE_C);

    expect(JSON.stringify(service.doc.tracks)).toBe(before);
  });

  it('refuses a rest written into a generated track', () => {
    service.sendProgression(built(atRevision(4)));
    caretOnGenerated();
    const before = JSON.stringify(service.doc.tracks);

    service.setRestAtCursor();

    expect(JSON.stringify(service.doc.tracks)).toBe(before);
  });

  it('refuses a delete inside a generated track', () => {
    service.sendProgression(built(atRevision(4)));
    caretOnGenerated();
    const before = JSON.stringify(service.doc.tracks);

    service.deleteAtCursor();

    expect(JSON.stringify(service.doc.tracks)).toBe(before);
  });

  it('remembers a duration choice beside a generated track without writing it', () => {
    // Half of this command is refused and half of it is not. The palette and
    // the dot toggle are the only route to the input duration, so refusing the
    // whole command would freeze them for as long as the caret rested on a
    // track the design says the caret may rest on - including while the user
    // pre-selects a duration to carry back to their own track.
    service.sendProgression(built(atRevision(4)));
    caretOnGenerated();
    const before = JSON.stringify(service.doc.tracks);

    service.applyDurationAtCursor(8, 1);

    expect(JSON.stringify(service.doc.tracks)).toBe(before);
    expect(state().inputDuration).toBe(8);
    expect(state().inputDots).toBe(1);
  });

  it('spends no undo step on the half of that command it refused', () => {
    // The obvious way to keep the palette live - commit always, and gate inside
    // the callback - leaves an empty commit behind, so the user's next undo
    // takes back a duration change the score never received. The score-untouched
    // assertion above cannot see that; this one can.
    service.sendProgression(built(atRevision(4)));
    caretOnGenerated();

    service.applyDurationAtCursor(8, 1);
    service.undo();

    expect(service.doc.tracks.some(track => track.generated !== null)).toBeFalse();
  });

  it('refuses without spending an undo step', () => {
    // A refusal that committed would leave the user pressing undo to take back
    // an edit that never happened.
    service.sendProgression(built(atRevision(4)));
    caretOnGenerated();

    service.setNoteAtCursor(MIDDLE_C);
    service.undo();

    expect(service.doc.tracks.some(track => track.generated !== null)).toBeFalse();
  });

  it('still writes notes into the user\'s own track', () => {
    // The gate reads the caret's track, not the score's - a score holding a
    // generated track is not a read-only score.
    service.sendProgression(built(atRevision(4)));
    service.setCursor({ trackIndex: 0, staffIndex: 0, barIndex: 0, beatIndex: 0 });

    service.setNoteAtCursor(MIDDLE_C, false);

    expect(service.doc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes.length).toBe(1);
  });

  it('allows the caret to select one', () => {
    // A read-only track the caret cannot even rest on is worse than useless:
    // the user could not read it through the cursor, only look at it.
    service.sendProgression(built(atRevision(4)));
    const index = service.doc.tracks.findIndex(track => track.generated !== null);

    service.setCursor({ trackIndex: index });

    let trackIndex = -1;
    service
      .getState()
      .subscribe(state => (trackIndex = state.cursor.trackIndex))
      .unsubscribe();
    expect(trackIndex).toBe(index);
  });

  it('marks a generated track diverged when a bar is inserted', () => {
    // The hole the revision counter cannot see: the edit happened on the
    // score's side of the arrow.
    service.sendProgression(built(atRevision(4)));

    service.insertBar(1);

    expect(marker().source).toEqual({ kind: 'diverged' });
  });

  it('marks it diverged when a bar is removed', () => {
    service.sendProgression(built(atRevision(4)));

    service.removeBar(1);

    expect(marker().source).toEqual({ kind: 'diverged' });
  });

  it('takes the divergence back on undo', () => {
    // The stamp is applied to the draft inside the same commit() as the bar
    // edit, so it is undoable like the edit. A refactor that moved it into a
    // pass after the commit, or into a subscriber, would leave a track
    // permanently diverged by an insertion the user took back - which is
    // exactly what "Update is pressed, not inferred" warns against.
    service.sendProgression(built(atRevision(4)));
    service.insertBar(1);

    service.undo();

    expect(marker().source).toEqual({ kind: 'revision', revision: 4 });
  });

  it('leaves an unmarked track alone when a bar is inserted', () => {
    // Per-track, not per-score: the user's own track sits in the same document
    // as a generated one and must not pick up a marker from its neighbour.
    service.sendProgression(built(atRevision(4)));

    service.insertBar(1);

    expect(service.doc.tracks[0].generated).toBeNull();
  });

  it('clears divergence on update', () => {
    service.sendProgression(built(atRevision(4)));
    service.insertBar(1);

    service.sendProgression(built(atRevision(9)));

    expect(marker().source).toEqual({ kind: 'revision', revision: 9 });
  });

  it('flattens a generated track into an ordinary one', () => {
    service.sendProgression(built(atRevision(4)));
    const index = service.doc.tracks.findIndex(track => track.generated !== null);

    service.flattenTrack(index);

    expect(service.doc.tracks[index].generated).toBeNull();
    expect(service.doc.tracks.length).toBe(2);
  });

  it('opens a flattened track to editing', () => {
    // Everything the marker's absence unlocks follows from one cleared field,
    // so the gate is the check that it really was cleared.
    service.sendProgression(built(atRevision(4)));
    const index = service.doc.tracks.findIndex(track => track.generated !== null);
    service.flattenTrack(index);
    service.setCursor({ trackIndex: index, staffIndex: 0, barIndex: 0, beatIndex: 0 });
    const before = JSON.stringify(service.doc.tracks[index]);

    service.setNoteAtCursor(MIDDLE_C, false);

    expect(JSON.stringify(service.doc.tracks[index])).not.toBe(before);
  });

  it('spends no undo step flattening a track nobody generated', () => {
    // The no-op has to be a no-op all the way out: a commit that changed
    // nothing would still cost the user their next undo.
    service.sendProgression(built(atRevision(4)));

    service.flattenTrack(0);
    service.undo();

    expect(service.doc.tracks.some(track => track.generated !== null)).toBeFalse();
  });

  it('takes a flatten back on undo', () => {
    service.sendProgression(built(atRevision(4)));
    const index = service.doc.tracks.findIndex(track => track.generated !== null);
    service.flattenTrack(index);

    service.undo();

    expect(marker().source).toEqual({ kind: 'revision', revision: 4 });
  });
});
