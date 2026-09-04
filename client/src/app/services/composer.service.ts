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
  createDefaultCursor,
  createDefaultMasterBar,
  createDefaultNoteEffects,
  createDefaultPlaybackInfo,
  createRestBeat,
  STANDARD_GUITAR_TUNING
} from '../models/composer.model';

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
      tracks: [ComposerService.createTrack('Guitar', 'gtr', 25, true, masterBars.length)]
    };
  }

  static createTrack(
    name: string,
    shortName: string,
    program: number,
    fretted: boolean,
    barCount: number
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
      bars: Array.from({ length: barCount }, () => createDefaultBar(fretted))
    };

    return {
      id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      shortName,
      color: fretted ? '#e74c3c' : '#3498db',
      playback: createDefaultPlaybackInfo(program),
      staves: [staff]
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
      if (advance) this.appendTrailingRest(draft, cursor, state.inputDuration);
    });

    if (advance) this.moveCursorByBeat(1);
  }

  /** Turns the beat at the caret into a rest. */
  setRestAtCursor(advance = true): void {
    const state = this.stateSubject.getValue();
    const cursor = state.cursor;

    this.commit(draft => {
      const beat = this.beatAt(draft, cursor);
      if (!beat) return;
      beat.notes = [];
      beat.isRest = true;
      beat.duration = state.inputDuration;
      beat.dots = state.inputDots;
      if (advance) this.appendTrailingRest(draft, cursor, state.inputDuration);
    });

    if (advance) this.moveCursorByBeat(1);
  }

  deleteAtCursor(): void {
    const cursor = this.stateSubject.getValue().cursor;
    this.commit(draft => {
      const voice = this.voiceAt(draft, cursor);
      if (!voice || voice.beats.length === 0) return;
      if (voice.beats.length === 1) {
        voice.beats[0] = createRestBeat(voice.beats[0].duration);
      } else {
        voice.beats.splice(cursor.beatIndex, 1);
      }
    });
  }

  setInputDuration(duration: DurationValue, dots = 0): void {
    const state = this.stateSubject.getValue();
    this.stateSubject.next({ ...state, inputDuration: duration, inputDots: dots });
  }

  /** Applies the current input duration to the beat under the caret. */
  applyDurationAtCursor(duration: DurationValue, dots: number): void {
    const cursor = this.stateSubject.getValue().cursor;
    this.commit(draft => {
      const beat = this.beatAt(draft, cursor);
      if (!beat) return;
      beat.duration = duration;
      beat.dots = dots;
    });
    this.setInputDuration(duration, dots);
  }

  /**
   * Appends a trailing rest when the caret sits on the final beat, so there is
   * always somewhere to type next. Call from inside an existing commit so note
   * entry stays a single undo step.
   */
  private appendTrailingRest(draft: ScoreDoc, cursor: EditCursor, duration: DurationValue): void {
    const voice = this.voiceAt(draft, cursor);
    if (voice && cursor.beatIndex >= voice.beats.length - 1) {
      voice.beats.push(createRestBeat(duration));
    }
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
          const bar = createDefaultBar(staff.showTablature);
          if (template) {
            bar.clef = template.clef;
            bar.clefOttava = template.clefOttava;
            bar.keySignature = { ...template.keySignature };
          }
          staff.bars.splice(at, 0, bar);
        }
      }
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
          draft.masterBars.length
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
