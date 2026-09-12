import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  BarDoc,
  BeatDoc,
  ComposerState,
  DurationValue,
  EditCursor,
  MasterBarDoc,
  NoteDoc,
  NotePitch,
  ScoreDoc,
  StaffDoc,
  TrackDoc,
  createDefaultBar,
  effectiveTimeSignature,
  createDefaultCursor,
  createDefaultMasterBar,
  createDefaultNoteEffects,
  createDefaultPlaybackInfo,
  createRestBeat,
  STANDARD_GUITAR_TUNING
} from '../models/composer.model';
import { GeneratedTrack, flattenGeneratedTrack, mergeGeneratedTrack } from './progression-track';

/**
 * Owns the editable score document, the edit caret, and undo/redo.
 *
 * All mutations go through `commit()`, which snapshots the previous document
 * onto the undo stack. ScoreDoc is an acyclic plain object, so a snapshot is a
 * structuredClone - this is the reason the composer keeps its own model rather
 * than mutating alphaTab's Score, whose cyclic parent references cannot be
 * cloned cheaply.
 *
 * INVARIANT: every staff of every track has exactly `masterBars.length` bars.
 * Bar insertion and removal always apply across all tracks, so the shared
 * timeline can never desync.
 *
 * A track carrying a `GeneratedOrigin` is a progression's rather than the
 * user's: `sendProgression` writes it, the note- and beat-level commands refuse
 * it, and `flattenTrack` hands it over. That every one of those is an ordinary
 * `commit()` is the point rather than a convenience - it is what makes undo
 * restore a track together with the marker that says how fresh it is. See
 * "Update is pressed, not inferred" in the progression composer design doc.
 */
@Injectable({ providedIn: 'root' })
export class ComposerService {
  private static readonly MAX_HISTORY = 100;

  private readonly stateSubject: BehaviorSubject<ComposerState>;
  private undoStack: ScoreDoc[] = [];
  private redoStack: ScoreDoc[] = [];

  constructor() {
    this.stateSubject = new BehaviorSubject<ComposerState>({
      doc: ComposerService.createEmptyScore(),
      cursor: createDefaultCursor(),
      inputDuration: 4,
      inputDots: 0,
      isDirty: false,
      canUndo: false,
      canRedo: false
    });
  }

  getState(): Observable<ComposerState> {
    return this.stateSubject.asObservable();
  }

  get doc(): ScoreDoc {
    return this.stateSubject.getValue().doc;
  }

  // -------------------------------------------------------------------------
  // Document creation
  // -------------------------------------------------------------------------

  static createEmptyScore(): ScoreDoc {
    const masterBars: MasterBarDoc[] = [
      {
        ...createDefaultMasterBar(),
        timeSignature: { numerator: 4, denominator: 4, isCommon: true }
      },
      createDefaultMasterBar(),
      createDefaultMasterBar(),
      createDefaultMasterBar()
    ];

    return {
      title: 'Untitled',
      subTitle: '',
      artist: '',
      album: '',
      tempo: 120,
      masterBars,
      tracks: [ComposerService.createTrack('Guitar', 'gtr', 25, true, masterBars)]
    };
  }

  static createTrack(
    name: string,
    shortName: string,
    program: number,
    fretted: boolean,
    masterBars: MasterBarDoc[]
  ): TrackDoc {
    const staff: StaffDoc = {
      tuning: fretted ? STANDARD_GUITAR_TUNING.slice() : [],
      tuningLabel: fretted ? 'Guitar Standard Tuning' : '',
      capo: 0,
      transpose: 0,
      displayTranspose: 0,
      showStandardNotation: true,
      showTablature: fretted,
      showSlash: false,
      showNumbered: false,
      bars: masterBars.map((_, index) =>
        createDefaultBar(fretted, effectiveTimeSignature(masterBars, index))
      )
    };

    return {
      id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      shortName,
      color: fretted ? '#e74c3c' : '#3498db',
      playback: createDefaultPlaybackInfo(program),
      staves: [staff],
      generated: null
    };
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  /** Applies a mutation to a cloned document and pushes the old one onto undo. */
  private commit(mutate: (draft: ScoreDoc) => void, cursor?: EditCursor): void {
    const state = this.stateSubject.getValue();
    const previous = structuredClone(state.doc);
    const draft = structuredClone(state.doc);

    mutate(draft);

    this.undoStack.push(previous);
    if (this.undoStack.length > ComposerService.MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];

    this.stateSubject.next({
      ...state,
      doc: draft,
      cursor: cursor ? this.clampCursor(cursor, draft) : this.clampCursor(state.cursor, draft),
      isDirty: true,
      canUndo: true,
      canRedo: false
    });
  }

  undo(): void {
    const state = this.stateSubject.getValue();
    const previous = this.undoStack.pop();
    if (!previous) return;

    this.redoStack.push(structuredClone(state.doc));
    this.stateSubject.next({
      ...state,
      doc: previous,
      cursor: this.clampCursor(state.cursor, previous),
      isDirty: true,
      canUndo: this.undoStack.length > 0,
      canRedo: true
    });
  }

  redo(): void {
    const state = this.stateSubject.getValue();
    const next = this.redoStack.pop();
    if (!next) return;

    this.undoStack.push(structuredClone(state.doc));
    this.stateSubject.next({
      ...state,
      doc: next,
      cursor: this.clampCursor(state.cursor, next),
      isDirty: true,
      canUndo: true,
      canRedo: this.redoStack.length > 0
    });
  }

  /** Replaces the whole document, e.g. after importing edited alphaTex. */
  replaceDocument(doc: ScoreDoc, markClean = false): void {
    const state = this.stateSubject.getValue();
    this.undoStack.push(structuredClone(state.doc));
    this.redoStack = [];

    this.stateSubject.next({
      ...state,
      doc,
      cursor: this.clampCursor(state.cursor, doc),
      isDirty: !markClean,
      canUndo: true,
      canRedo: false
    });
  }

  markSaved(): void {
    const state = this.stateSubject.getValue();
    this.stateSubject.next({ ...state, isDirty: false });
  }

  // -------------------------------------------------------------------------
  // Cursor
  // -------------------------------------------------------------------------

  setCursor(cursor: Partial<EditCursor>): void {
    const state = this.stateSubject.getValue();
    this.stateSubject.next({
      ...state,
      cursor: this.clampCursor({ ...state.cursor, ...cursor }, state.doc)
    });
  }

  /** Moves the caret forward or backward, wrapping across bars. */
  moveCursorByBeat(delta: number): void {
    const state = this.stateSubject.getValue();
    const cursor = { ...state.cursor };
    const staff = this.staffAt(state.doc, cursor);
    if (!staff) return;

    let beatIndex = cursor.beatIndex + delta;

    while (beatIndex < 0 && cursor.barIndex > 0) {
      cursor.barIndex--;
      beatIndex += staff.bars[cursor.barIndex].voices[cursor.voiceIndex]?.beats.length ?? 1;
    }
    while (
      cursor.barIndex < staff.bars.length - 1 &&
      beatIndex >= (staff.bars[cursor.barIndex].voices[cursor.voiceIndex]?.beats.length ?? 1)
    ) {
      beatIndex -= staff.bars[cursor.barIndex].voices[cursor.voiceIndex]?.beats.length ?? 1;
      cursor.barIndex++;
    }

    cursor.beatIndex = beatIndex;
    this.setCursor(cursor);
  }

  moveCursorByString(delta: number): void {
    const state = this.stateSubject.getValue();
    const staff = this.staffAt(state.doc, state.cursor);
    if (!staff || staff.tuning.length === 0) return;

    const current = state.cursor.stringIndex ?? 0;
    const next = Math.max(0, Math.min(staff.tuning.length - 1, current + delta));
    this.setCursor({ stringIndex: next });
  }

  private clampCursor(cursor: EditCursor, doc: ScoreDoc): EditCursor {
    const trackIndex = this.clamp(cursor.trackIndex, 0, doc.tracks.length - 1);
    const track = doc.tracks[trackIndex];
    if (!track) return createDefaultCursor();

    const staffIndex = this.clamp(cursor.staffIndex, 0, track.staves.length - 1);
    const staff = track.staves[staffIndex];
    const barIndex = this.clamp(cursor.barIndex, 0, staff.bars.length - 1);
    const bar = staff.bars[barIndex];
    const voiceIndex = this.clamp(cursor.voiceIndex, 0, bar.voices.length - 1);
    const beats = bar.voices[voiceIndex].beats;
    const beatIndex = this.clamp(cursor.beatIndex, 0, Math.max(0, beats.length - 1));

    const stringIndex =
      staff.tuning.length > 0
        ? this.clamp(cursor.stringIndex ?? 0, 0, staff.tuning.length - 1)
        : null;

    return { trackIndex, staffIndex, barIndex, voiceIndex, beatIndex, stringIndex };
  }

  private clamp(value: number, min: number, max: number): number {
    if (max < min) return min;
    return Math.max(min, Math.min(max, value));
  }

  // -------------------------------------------------------------------------
  // Note entry
  // -------------------------------------------------------------------------

  /** Writes a note at the caret, replacing any note already on that string. */
  setNoteAtCursor(pitch: NotePitch, advance = true): void {
    const state = this.stateSubject.getValue();
    const cursor = state.cursor;
    if (this.isGenerated(state.doc, cursor.trackIndex)) return;

    this.commit(draft => {
      const beat = this.beatAt(draft, cursor);
      if (!beat) return;

      beat.isRest = false;
      beat.duration = state.inputDuration;
      beat.dots = state.inputDots;

      const note: NoteDoc = {
        pitch,
        isTied: false,
        accidental: 'auto',
        effects: createDefaultNoteEffects()
      };

      // On a fretted staff one string holds at most one note, so replace.
      if (pitch.kind === 'fretted') {
        const existing = beat.notes.findIndex(
          n => n.pitch.kind === 'fretted' && n.pitch.string === pitch.string
        );
        if (existing >= 0) {
          beat.notes[existing] = note;
          return;
        }
      } else {
        const existing = beat.notes.findIndex(
          n =>
            n.pitch.kind === 'pitched' &&
            n.pitch.noteValue === pitch.noteValue &&
            n.pitch.octave === pitch.octave
        );
        if (existing >= 0) {
          beat.notes.splice(existing, 1);
          beat.isRest = beat.notes.length === 0;
          return;
        }
      }

      beat.notes.push(note);
    });

    if (advance) this.moveCursorByBeat(1);
  }

  /** Turns the beat at the caret into a rest. */
  setRestAtCursor(advance = true): void {
    const state = this.stateSubject.getValue();
    const cursor = state.cursor;
    if (this.isGenerated(state.doc, cursor.trackIndex)) return;

    this.commit(draft => {
      const beat = this.beatAt(draft, cursor);
      if (!beat) return;
      beat.notes = [];
      beat.isRest = true;
      beat.duration = state.inputDuration;
      beat.dots = state.inputDots;
    });

    if (advance) this.moveCursorByBeat(1);
  }

  /**
   * Clears the beat at the caret back to a rest.
   *
   * The slot is kept rather than removed: bars are pre-filled with a full
   * measure of rests, so deleting a note should empty its position, not
   * shorten the bar.
   */
  deleteAtCursor(): void {
    const state = this.stateSubject.getValue();
    const cursor = state.cursor;
    if (this.isGenerated(state.doc, cursor.trackIndex)) return;

    this.commit(draft => {
      const voice = this.voiceAt(draft, cursor);
      const beat = voice?.beats[cursor.beatIndex];
      if (!beat) return;
      beat.notes = [];
      beat.isRest = true;
    });
  }

  setInputDuration(duration: DurationValue, dots = 0): void {
    const state = this.stateSubject.getValue();
    this.stateSubject.next({ ...state, inputDuration: duration, inputDots: dots });
  }

  /**
   * Applies the current input duration to the beat under the caret.
   *
   * A refusal on a generated track takes the palette with it: this command
   * writes a beat *and* remembers the choice, and half of it happening would
   * leave the toolbar showing a duration the score never received. The toolbar
   * has `setInputDuration` for changing the choice on its own.
   */
  applyDurationAtCursor(duration: DurationValue, dots: number): void {
    const state = this.stateSubject.getValue();
    const cursor = state.cursor;
    if (this.isGenerated(state.doc, cursor.trackIndex)) return;

    this.commit(draft => {
      const beat = this.beatAt(draft, cursor);
      if (!beat) return;
      beat.duration = duration;
      beat.dots = dots;
    });
    this.setInputDuration(duration, dots);
  }


  // -------------------------------------------------------------------------
  // Structure: bars and tracks
  // -------------------------------------------------------------------------

  /**
   * Inserts a bar at `index` across every track, preserving the invariant that
   * the timeline is shared.
   */
  insertBar(index: number): void {
    this.commit(draft => {
      const at = this.clamp(index, 0, draft.masterBars.length);
      draft.masterBars.splice(at, 0, createDefaultMasterBar());
      for (const track of draft.tracks) {
        for (const staff of track.staves) {
          const template = staff.bars[Math.min(at, staff.bars.length - 1)];
          const bar = createDefaultBar(
            staff.showTablature,
            effectiveTimeSignature(draft.masterBars, at)
          );
          if (template) {
            bar.clef = template.clef;
            bar.clefOttava = template.clefOttava;
            bar.keySignature = { ...template.keySignature };
          }
          staff.bars.splice(at, 0, bar);
        }
      }
      this.markDiverged(draft);
    });
  }

  appendBar(): void {
    this.insertBar(this.doc.masterBars.length);
  }

  removeBar(index: number): void {
    if (this.doc.masterBars.length <= 1) return;
    this.commit(draft => {
      const at = this.clamp(index, 0, draft.masterBars.length - 1);
      draft.masterBars.splice(at, 1);
      for (const track of draft.tracks) {
        for (const staff of track.staves) {
          staff.bars.splice(at, 1);
        }
      }
      this.markDiverged(draft);
    });
  }

  addTrack(name: string, program: number, fretted: boolean): void {
    this.commit(draft => {
      draft.tracks.push(
        ComposerService.createTrack(
          name,
          name.slice(0, 3).toLowerCase(),
          program,
          fretted,
          draft.masterBars
        )
      );
    });
  }

  removeTrack(index: number): void {
    if (this.doc.tracks.length <= 1) return;
    this.commit(draft => {
      draft.tracks.splice(index, 1);
    });
  }

  updateScoreInfo(changes: Partial<ScoreDoc>): void {
    this.commit(draft => {
      Object.assign(draft, changes);
    });
  }

  setTempo(tempo: number): void {
    this.commit(draft => {
      draft.tempo = Math.max(20, Math.min(400, Math.round(tempo)));
    });
  }

  // -------------------------------------------------------------------------
  // Generated tracks
  // -------------------------------------------------------------------------

  /**
   * Puts the progression into the score, or refreshes the one already there.
   *
   * Send and Update are one method, because they are one operation: the merge
   * appends when the score holds nothing of this progression and replaces in
   * place when it does, so the difference is a fact about the score rather than
   * a choice the caller makes. Two methods would have to agree about the
   * marker, the divergence and the bar growth forever; the UI naming this one
   * twice costs nothing and cannot drift.
   *
   * Both go through `commit()` like any edit, which is the whole reason the
   * explicit-Update model is safe: undo restores the old track *and* its old
   * marker, so the badge cannot end up claiming a freshness the document does
   * not have. `composer.service.generated.spec.ts` pins that rather than
   * assuming it, and the design doc argues it under "Update is pressed, not
   * inferred".
   *
   * **`generated` must be freshly built and not retained.** `mergeGeneratedTrack`
   * is pure but not deep: the score it returns shares `TrackDoc`, `StaffDoc`
   * and `MasterBarDoc` nodes with both of its inputs, so the document this
   * commit publishes points at the caller's `GeneratedTrack`. That is safe
   * here only because `commit()` deep-clones before every later mutation - a
   * caller that kept the object and edited it afterwards would be writing into
   * a committed score behind undo's back.
   */
  sendProgression(generated: GeneratedTrack): void {
    this.requireScoreMeter(generated);
    this.commit(draft => Object.assign(draft, mergeGeneratedTrack(draft, generated)));
  }

  /**
   * Detaches a generated track from its progression, leaving the music.
   *
   * The guard is what keeps the no-op honest. `flattenGeneratedTrack` hands
   * back the score it was given when the index names no marked track, but
   * committing that would still push an undo entry and set `isDirty` - a
   * command that did nothing and cost the user their next undo.
   */
  flattenTrack(index: number): void {
    if (!this.isGenerated(this.doc, index)) return;
    this.commit(draft => Object.assign(draft, flattenGeneratedTrack(draft, index)));
  }

  /**
   * True when the track at `trackIndex` is a progression's rather than the
   * user's.
   *
   * The whole edit gate, consulted at the top of every command that writes a
   * note or a beat. It deliberately does not reach `insertBar`, `removeBar` or
   * the caret: bars are score-wide and stamp divergence instead, and a
   * read-only track the caret cannot even rest on is worse than useless - the
   * user could not read the track through the cursor, only look at it. The
   * design doc settles both under "Where the controls are".
   *
   * The refusal lives here and not only in a disabled button because the
   * button is not the only way in: a keyboard shortcut, a paste, or the next
   * component to call the service all arrive past it.
   */
  private isGenerated(doc: ScoreDoc, trackIndex: number): boolean {
    return doc.tracks[trackIndex]?.generated != null;
  }

  /**
   * Stamps every marked track as diverged from its progression.
   *
   * Bar insertion and removal are score-wide, so they move a generated track's
   * content without moving `ProgressionDoc.revision` - the one staleness the
   * counter cannot see, because the edit happened on the score's side of the
   * arrow. Marking the source rather than raising a flag beside it is what
   * makes a revision and a divergence unable to disagree; see "Divergence is a
   * state of the source, not a second check".
   *
   * Called inside the same `commit()` as the bar edit, so undoing the insertion
   * takes the divergence back with it.
   */
  private markDiverged(draft: ScoreDoc): void {
    for (const track of draft.tracks) {
      if (track.generated) track.generated = { ...track.generated, source: { kind: 'diverged' } };
    }
  }

  /**
   * Refuses a projection that was barred in some other meter than this score's.
   *
   * The precondition `mergeGeneratedTrack` cannot check for itself, checked at
   * the one place that knows both halves. A generated track shares the score's
   * `masterBars`, so a projection barred in 3/4 merged into a 4/4 score writes
   * music that disagrees with the bar lines drawn over it - and the caller has
   * no freedom worth preserving here, since exactly one meter is ever right.
   *
   * It throws rather than returning quietly. This is a caller's bug and not a
   * user's input, and both silent answers are worse: merging corrupts a
   * document the user has been working in, and returning does nothing where
   * the user pressed a button. `progressionTrack` takes the meter as an
   * argument, so the fix at every call site is one expression -
   * `effectiveTimeSignature(composer.doc.masterBars, 0)`.
   *
   * An empty projection is let through: it has no bars to be in the wrong
   * meter, and `effectiveTimeSignature` would answer for it with a 4/4 default
   * that means "nothing said" rather than "this meter".
   */
  private requireScoreMeter(generated: GeneratedTrack): void {
    if (generated.masterBars.length === 0) return;

    const score = effectiveTimeSignature(this.doc.masterBars, 0);
    const projected = effectiveTimeSignature(generated.masterBars, 0);
    if (projected.numerator === score.numerator && projected.denominator === score.denominator) {
      return;
    }

    throw new Error(
      `Generated track is barred in ${projected.numerator}/${projected.denominator}, but the ` +
        `score's meter is ${score.numerator}/${score.denominator}. Project it with ` +
        'effectiveTimeSignature(score.masterBars, 0).'
    );
  }

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  staffAt(doc: ScoreDoc, cursor: EditCursor): StaffDoc | null {
    return doc.tracks[cursor.trackIndex]?.staves[cursor.staffIndex] ?? null;
  }

  barAt(doc: ScoreDoc, cursor: EditCursor): BarDoc | null {
    return this.staffAt(doc, cursor)?.bars[cursor.barIndex] ?? null;
  }

  voiceAt(doc: ScoreDoc, cursor: EditCursor) {
    return this.barAt(doc, cursor)?.voices[cursor.voiceIndex] ?? null;
  }

  beatAt(doc: ScoreDoc, cursor: EditCursor): BeatDoc | null {
    return this.voiceAt(doc, cursor)?.beats[cursor.beatIndex] ?? null;
  }

  reset(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.stateSubject.next({
      doc: ComposerService.createEmptyScore(),
      cursor: createDefaultCursor(),
      inputDuration: 4,
      inputDots: 0,
      isDirty: false,
      canUndo: false,
      canRedo: false
    });
  }
}
