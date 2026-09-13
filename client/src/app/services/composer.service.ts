import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  AccidentalMode,
  BarDoc,
  BeatDoc,
  BeatEffectsDoc,
  ClefKind,
  ComposerState,
  DurationValue,
  DynamicValue,
  EditCursor,
  KeySignature,
  MasterBarDoc,
  NoteDoc,
  NoteEffectsDoc,
  NotePitch,
  OttaviaKind,
  PlaybackInfoDoc,
  ScoreDoc,
  StaffDoc,
  TimeSignature,
  TrackDoc,
  Tuplet,
  createDefaultBar,
  effectiveTimeSignature,
  createDefaultCursor,
  createDefaultMasterBar,
  createDefaultNoteEffects,
  createDefaultPlaybackInfo,
  createRestBeat,
  STANDARD_GUITAR_TUNING
} from '../models/composer.model';
import {
  keySignatureFault,
  setClef,
  setKeySignature,
  setMasterBarValue,
  setTimeSignature,
  timeSignatureFault,
  toggleMasterBarFlag
} from './bar-edits';
import { barFillAt, fixBarOverflow } from './bar-fill';
import {
  beatsAt,
  setBeatDurations,
  setDynamics,
  setGrace,
  setTuplet,
  toggleBeatEffect,
  toggledValue
} from './beat-edits';
import { BeatRef, selectedBars, selectionTargets } from './composer-selection';
import { EditScope, editRefusal } from './edit-refusals';
import { setAccidental, toggleNoteEffect, toggleTie } from './note-edits';
import { GeneratedTrack, flattenGeneratedTrack, mergeGeneratedTrack } from './progression-track';
import { insertBarInto } from './score-structure';
import { renameTrack, setPlayback, setStaffNumber, setStaffTuning, setStaffViews } from './track-edits';

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
      anchor: null,
      refusal: null,
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

  /**
   * The meter a projection must be barred in to be merged into this score.
   *
   * `requireScoreMeter` refuses anything else, and the refusal used to be
   * answerable only by copying an expression out of a docstring. Naming it here
   * makes the contract one word at the call site -
   * `progressionTrack(doc, intervals, composer.scoreMeter)` - and puts the
   * definition of "the score's meter" in one place, so a caller cannot
   * accidentally answer a differently-shaped question than the guard asks.
   *
   * Bar 1's signature, with everything that costs: see `requireScoreMeter`.
   */
  get scoreMeter(): TimeSignature {
    return effectiveTimeSignature(this.doc.masterBars, 0);
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

  /** Applies a mutation to a cloned document and commits the result. */
  private commit(mutate: (draft: ScoreDoc) => void, cursor?: EditCursor): void {
    const draft = structuredClone(this.stateSubject.getValue().doc);
    mutate(draft);
    this.commitDocument(draft, cursor);
  }

  /**
   * Publishes a prepared document and pushes the old one onto undo. For edits that can
   * refuse part-way: they run on a clone, and only a clone that succeeded arrives here.
   */
  private commitDocument(next: ScoreDoc, cursor?: EditCursor): void {
    const state = this.stateSubject.getValue();
    this.undoStack.push(structuredClone(state.doc));
    if (this.undoStack.length > ComposerService.MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];

    this.stateSubject.next({
      ...state,
      doc: next,
      cursor: this.clampCursor(cursor ?? state.cursor, next),
      anchor: state.anchor ? this.clampCursor(state.anchor, next) : null,
      refusal: null,
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
      anchor: state.anchor ? this.clampCursor(state.anchor, previous) : null,
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
      anchor: state.anchor ? this.clampCursor(state.anchor, next) : null,
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
      anchor: null,
      refusal: null,
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

  /** Moves the caret, and drops any range: a plain click or arrow key. */
  setCursor(cursor: Partial<EditCursor>): void {
    const state = this.stateSubject.getValue();
    this.stateSubject.next({
      ...state,
      anchor: null,
      cursor: this.clampCursor({ ...state.cursor, ...cursor }, state.doc)
    });
  }

  /**
   * Moves the selection's moving end, fixing the other end where the caret was if no range
   * existed yet: shift-click and shift-arrow.
   */
  extendSelectionTo(cursor: Partial<EditCursor>): void {
    const state = this.stateSubject.getValue();
    this.stateSubject.next({
      ...state,
      anchor: state.anchor ?? state.cursor,
      cursor: this.clampCursor({ ...state.cursor, ...cursor }, state.doc)
    });
  }

  /** Selects every beat of the caret's staff, first bar to last. */
  selectAllInTrack(): void {
    const state = this.stateSubject.getValue();
    const staff = this.staffAt(state.doc, state.cursor);
    if (!staff) return;
    const lastBar = staff.bars.length - 1;
    const lastBeat = (staff.bars[lastBar]?.voices[state.cursor.voiceIndex]?.beats.length ?? 1) - 1;
    this.stateSubject.next({
      ...state,
      anchor: { ...state.cursor, barIndex: 0, beatIndex: 0 },
      cursor: this.clampCursor({ ...state.cursor, barIndex: lastBar, beatIndex: lastBeat }, state.doc)
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
    this.stateSubject.next({ ...state, cursor: { ...state.cursor, stringIndex: next } });
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

      // Length first, so the bar settles before the note lands. Settling only removes or
      // inserts beats after this one, so `beat` is still the caret's beat.
      setBeatDurations(draft, [cursor], state.inputDuration, state.inputDots);
      beat.isRest = false;

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
      setBeatDurations(draft, [cursor], state.inputDuration, state.inputDots);
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
   * Applies the current input duration to the beat under the caret, and
   * remembers it as the choice for the next note.
   *
   * The gate covers the write and stops there, because these are two effects
   * and only one of them is the generated track's business. The score is the
   * track's; the input duration is the *toolbar's*, and the toolbar belongs to
   * whichever track the caret moves to next.
   *
   * Refusing both is what a read of the gate suggests and it is wrong twice
   * over. Every route to the input duration runs through here - the palette,
   * the dot toggle, and the `+`/`-` keys all call this method, and nothing else
   * in the app calls `setInputDuration` - so a blanket refusal freezes the
   * palette outright for as long as the caret rests on a generated track, which
   * the design explicitly permits and which is how a user reads one. It also
   * takes away the pre-selection: choose a duration while looking at the
   * generated track, move back to your own, and type.
   *
   * Nor is there an atomicity to protect. `commit()` runs its callback against
   * a draft, so a caret on an empty beat already returns early and lands an
   * empty commit with the choice remembered anyway - "write the beat and
   * remember the choice, always together" was never the invariant. What is
   * left is the honest half: a toolbar showing a duration the score under the
   * caret does not have, which is what a toolbar showing an *input* duration
   * means everywhere else in the editor.
   *
   * It acts on the selection, not only the caret, and keeps each bar honest through
   * `setBeatDurations`: a gap fills with rests where it opened, and a beat that grows takes
   * only rests.
   */
  applyDurationAtCursor(duration: DurationValue, dots: number): void {
    const state = this.stateSubject.getValue();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);

    if (!editRefusal(state.doc, refs, { family: 'beat' }, null)) {
      this.commit(draft => setBeatDurations(draft, refs, duration, dots));
    }

    this.setInputDuration(duration, dots);
  }

  // -------------------------------------------------------------------------
  // Edits on the selection
  // -------------------------------------------------------------------------

  /** Presses a note effect tool on the selection. See `toggleNoteEffect` in note-edits.ts. */
  toggleNoteEffect<K extends keyof NoteEffectsDoc>(key: K, on: NoteEffectsDoc[K], off: NoteEffectsDoc[K]): void {
    this.applyEdit({ family: 'note', key }, (draft, refs, focus) => toggleNoteEffect(draft, refs, focus, key, on, off));
  }

  setAccidental(accidental: AccidentalMode): void {
    this.applyEdit({ family: 'note', key: 'accidental', accidental }, (draft, refs, focus) => setAccidental(draft, refs, focus, accidental));
  }

  toggleTie(): void {
    this.applyEdit({ family: 'note', key: 'tie' }, (draft, refs, focus) => toggleTie(draft, refs, focus));
  }

  /** Presses a beat effect tool on the selection. Not grace: see `toggleGrace`. */
  toggleBeatEffect<K extends Exclude<keyof BeatEffectsDoc, 'grace'>>(
    key: K,
    on: BeatEffectsDoc[K],
    off: BeatEffectsDoc[K]
  ): void {
    this.applyEdit({ family: 'beat' }, (draft, refs) => toggleBeatEffect(draft, refs, key, on, off));
  }

  /**
   * Presses Grace before or Grace on beat, by the toggle rule: when every target is already
   * that grace, they become ordinary beats again. A grace takes no room, so this is a length
   * change, and `setGrace` settles each bar as a duration change does.
   *
   * With the caret alone, the caret follows its beat. The rests that fill a new grace's gap go
   * where its value stood, in front of it, so the grace's index moves forward by however many
   * rests that took. Left where it was, the caret would sit on one of those rests, and pressing
   * the same tool again - to undo a mistaken press by the toggle rule, or to add an effect to
   * the grace - would act on the rest instead. A range keeps its ends, which name beats by
   * position; see `selectionTargets`.
   */
  toggleGrace(grace: Exclude<BeatEffectsDoc['grace'], 'none'>): void {
    const { anchor, cursor } = this.stateSubject.getValue();
    let followed: number | null = null;

    this.applyEdit({ family: 'beat' }, (draft, refs) => {
      const caretBeat = anchor ? null : this.beatAt(draft, cursor);
      setGrace(draft, refs, toggledValue(beatsAt(draft, refs).map(beat => beat.effects.grace), grace, 'none'));
      const index = caretBeat ? (this.voiceAt(draft, cursor)?.beats.indexOf(caretBeat) ?? -1) : -1;
      followed = index >= 0 ? index : null;
    });

    if (followed !== null) this.setCursor({ beatIndex: followed });
  }

  setDynamics(dynamics: DynamicValue | null): void {
    this.applyEdit({ family: 'beat' }, (draft, refs) => setDynamics(draft, refs, dynamics));
  }

  setTuplet(tuplet: Tuplet | null): void {
    this.applyEdit({ family: 'beat' }, (draft, refs) => setTuplet(draft, refs, tuplet));
  }

  /**
   * The one way a note or beat edit reaches the document.
   *
   * A refusal is published and nothing is committed, so a refused press costs no undo step
   * and changes nothing at all - not half a range. The focused string applies only when the
   * selection is the caret alone: a range means every note in it.
   */
  private applyEdit(
    scope: EditScope,
    edit: (draft: ScoreDoc, refs: BeatRef[], focus: number | null) => void
  ): void {
    const state = this.stateSubject.getValue();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);
    const focus = state.anchor ? null : state.cursor.stringIndex;
    const refusal = editRefusal(state.doc, refs, scope, focus);
    if (refusal) {
      this.refuse(refusal);
      return;
    }
    this.commit(draft => edit(draft, refs, focus));
  }

  /** Publishes why a command did nothing. Commits nothing, so it costs no undo step. */
  private refuse(reason: string): void {
    this.stateSubject.next({ ...this.stateSubject.getValue(), refusal: reason });
  }

  // -------------------------------------------------------------------------
  // Bar and track edits
  // -------------------------------------------------------------------------

  setTimeSignature(timeSignature: TimeSignature): void {
    const fault = timeSignatureFault(timeSignature);
    if (fault) return this.refuse(fault);
    this.applyBarEdit((draft, bars) => setTimeSignature(draft, bars.first, timeSignature));
  }

  setKeySignature(keySignature: KeySignature): void {
    const fault = keySignatureFault(keySignature);
    if (fault) return this.refuse(fault);
    this.applyBarEdit((draft, bars) => setKeySignature(draft, bars.first, keySignature));
  }

  setClef(clef: ClefKind, ottava: OttaviaKind): void {
    const { trackIndex, staffIndex } = this.stateSubject.getValue().cursor;
    this.applyBarEdit((draft, bars) => setClef(draft, trackIndex, staffIndex, bars.first, clef, ottava));
  }

  /**
   * A bar flag over the selected bars. Taking bars out of free time fits them to their meter
   * in the same commit (`toggleMasterBarFlag`), so that is one undo step too, and like any bar
   * edit it stamps generated tracks diverged.
   */
  toggleMasterBarFlag(key: 'isRepeatStart' | 'isDoubleBar' | 'isFreeTime'): void {
    this.applyBarEdit((draft, bars) => toggleMasterBarFlag(draft, bars, key));
  }

  setMasterBarValue<K extends 'repeatCount' | 'alternateEndings' | 'tripletFeel' | 'section'>(
    key: K,
    value: MasterBarDoc[K]
  ): void {
    if (key === 'section' && value !== null && !(value as MasterBarDoc['section'])?.text.trim()) {
      return this.refuse('A section needs a name.');
    }
    if ((key === 'repeatCount' || key === 'alternateEndings') && (value as number) < 0) {
      return this.refuse('That cannot be negative.');
    }
    this.applyBarEdit((draft, bars) => setMasterBarValue(draft, bars, key, value));
  }

  setStaffTuning(tuning: number[], label: string): void {
    this.applyTrackEdit(true, (draft, t, s) => setStaffTuning(draft, t, s, tuning, label));
  }

  setStaffNumber(key: 'capo' | 'transpose' | 'displayTranspose', value: number): void {
    this.applyTrackEdit(true, (draft, t, s) => setStaffNumber(draft, t, s, key, value));
  }

  setStaffViews(views: Partial<Pick<StaffDoc, 'showStandardNotation' | 'showTablature' | 'showSlash' | 'showNumbered'>>): void {
    this.applyTrackEdit(true, (draft, t, s) => setStaffViews(draft, t, s, views));
  }

  setPlayback(changes: Partial<PlaybackInfoDoc>): void {
    this.applyTrackEdit(false, (draft, t) => setPlayback(draft, t, changes));
  }

  renameTrack(name: string, shortName: string): void {
    this.applyTrackEdit(true, (draft, t) => renameTrack(draft, t, name, shortName));
  }

  /**
   * A bar edit over the selected bars. Score-wide, like `insertBar`: never refused on a
   * generated track, and it stamps every generated track diverged in the same commit.
   */
  private applyBarEdit(edit: (draft: ScoreDoc, bars: { first: number; last: number }) => void): void {
    const state = this.stateSubject.getValue();
    const bars = selectedBars(state.anchor, state.cursor);
    this.commit(draft => {
      edit(draft, bars);
      this.markDiverged(draft);
    });
  }

  /**
   * A track edit on the caret's staff, run on a clone so an edit that refuses part-way
   * leaves nothing behind. `gated` edits are refused on a generated track.
   */
  private applyTrackEdit(
    gated: boolean,
    edit: (draft: ScoreDoc, trackIndex: number, staffIndex: number) => string | null | void
  ): void {
    const state = this.stateSubject.getValue();
    const { trackIndex, staffIndex } = state.cursor;
    if (gated) {
      const refusal = editRefusal(state.doc, [], { family: 'track', trackIndex }, null);
      if (refusal) return this.refuse(refusal);
    }
    const draft = structuredClone(state.doc);
    const reason = edit(draft, trackIndex, staffIndex);
    if (typeof reason === 'string') return this.refuse(reason);
    this.commitDocument(draft);
  }

  /**
   * Fix bar: carries the overflow of every over bar in the selection, on the caret's staff,
   * into the bars after it.
   *
   * Runs on a clone and commits only if every bar fixed, because `fixBarOverflow` can refuse
   * part-way - a tuplet across a line - and a half-carried score is exactly the corruption
   * the refusal exists to prevent. Refused on a generated track like any content edit.
   * Appending a bar is score-wide, so it stamps generated tracks diverged; carrying within
   * existing bars touches only this staff and does not. Each selected bar is read with
   * `barFillAt`, against its own meter and free time, rather than measuring the whole score
   * once per bar.
   */
  fixBar(): void {
    const state = this.stateSubject.getValue();
    const { trackIndex, staffIndex } = state.cursor;
    const refusal = editRefusal(state.doc, [], { family: 'track', trackIndex }, null);
    if (refusal) return this.refuse(refusal);

    const bars = selectedBars(state.anchor, state.cursor);
    const draft = structuredClone(state.doc);
    let fixed = false;
    let appended = 0;

    for (let index = bars.first; index <= bars.last; index++) {
      if (barFillAt(draft, trackIndex, staffIndex, index)?.kind !== 'over') continue;
      const result = fixBarOverflow(draft, trackIndex, staffIndex, index);
      if (result.kind === 'refused') return this.refuse(result.reason);
      fixed = true;
      appended += result.appendedBars;
    }

    if (!fixed) return this.refuse('No selected bar is over its time signature.');
    if (appended > 0) this.markDiverged(draft);
    this.commitDocument(draft);
  }


  // -------------------------------------------------------------------------
  // Structure: bars and tracks
  // -------------------------------------------------------------------------

  /** Inserts a bar at `index` across every track. See `insertBarInto`. */
  insertBar(index: number): void {
    this.commit(draft => {
      insertBarInto(draft, index);
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

  /**
   * Changes the score's descriptive fields. Only those: structure has its own commands,
   * because `masterBars` and `tracks` share an invariant a blind assign could break.
   */
  updateScoreInfo(changes: Partial<Pick<ScoreDoc, 'title' | 'subTitle' | 'artist' | 'album'>>): void {
    this.commit(draft => {
      draft.title = changes.title ?? draft.title;
      draft.subTitle = changes.subTitle ?? draft.subTitle;
      draft.artist = changes.artist ?? draft.artist;
      draft.album = changes.album ?? draft.album;
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
   *
   * `generated.truncated` arrives in the argument and is dropped here by
   * decision rather than by oversight. A truncated projection is a well-formed
   * track, and sending one puts less music in the score than the progression
   * holds - which is on screen, and one Send away from fixed. Export is where
   * truncation refuses, because a file that silently drops bars is the failure
   * a user finds in another program a week later.
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
   * Like the revision counter, it over-reports in the safe direction, and
   * `appendBar` is the plainest case: a bar added past the end of the music
   * moves no note in the generated track, but the track is stamped anyway and
   * the badge stays stale until an Update rebuilds it byte-identically. One
   * needless click, and the check that would avoid it - did this bar edit
   * actually touch this track's notes? - is a diff of the projection wearing a
   * cheaper name.
   *
   * Called inside the same `commit()` as the bar edit, so undoing the insertion
   * takes the divergence back with it; `composer.service.generated.spec.ts`
   * pins that rather than trusting it.
   */
  private markDiverged(draft: ScoreDoc): void {
    for (const track of draft.tracks) {
      if (track.generated) track.generated = { ...track.generated, source: { kind: 'diverged' } };
    }
  }

  /**
   * Refuses a projection whose *first* bar is in some other meter than this
   * score's first bar.
   *
   * Bar 1 against bar 1, and no further - which is narrower than it sounds and
   * exactly as wide as M4's projection is. `progressionTrack` bars the whole
   * track in the single meter it is handed, so one comparison decides whether
   * that meter was the right one. What the comparison cannot decide is whether
   * the *score* keeps that meter: a score that moves to 3/4 at bar 9 passes
   * this check and still gets a generated staff whose bar lines disagree from
   * bar 9 on. That is the design's recorded limitation and not a hole here -
   * "A score that changes meter mid-way", under "Not in M4" in the progression
   * composer design doc, says why the fix waits and what it costs.
   *
   * So: the precondition `mergeGeneratedTrack` cannot check for itself, checked
   * at the one place that knows both halves. A generated track shares the
   * score's `masterBars`, so a projection barred in 3/4 merged into a 4/4 score
   * writes music that disagrees with the bar lines drawn over it - and the
   * caller has no freedom worth preserving here, since exactly one meter is
   * ever right.
   *
   * It throws rather than returning quietly. This is a caller's bug and not a
   * user's input, and both silent answers are worse: merging corrupts a
   * document the user has been working in, and returning does nothing where
   * the user pressed a button. `progressionTrack` takes the meter as an
   * argument, so the fix at every call site is one word - `scoreMeter`, the
   * getter above, which is what the message names rather than an expression a
   * call site has no variable in scope to write.
   *
   * An empty projection is let through: it has no bars to be in the wrong
   * meter, and `effectiveTimeSignature` would answer for it with a 4/4 default
   * that means "nothing said" rather than "this meter".
   */
  private requireScoreMeter(generated: GeneratedTrack): void {
    if (generated.masterBars.length === 0) return;

    const score = this.scoreMeter;
    const projected = effectiveTimeSignature(generated.masterBars, 0);
    if (projected.numerator === score.numerator && projected.denominator === score.denominator) {
      return;
    }

    throw new Error(
      `Generated track is barred in ${projected.numerator}/${projected.denominator}, but the ` +
        `score's meter is ${score.numerator}/${score.denominator}. Build it with ` +
        'ComposerService.scoreMeter.'
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
      anchor: null,
      refusal: null,
      inputDuration: 4,
      inputDots: 0,
      isDirty: false,
      canUndo: false,
      canRedo: false
    });
  }
}
