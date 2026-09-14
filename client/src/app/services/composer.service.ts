import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  AccidentalMode,
  BarDoc,
  BeatDoc,
  BeatEffectsDoc,
  ClefKind,
  ComposerState,
  DocumentReplacement,
  DurationValue,
  DynamicValue,
  EditCursor,
  EntryMode,
  KeySignature,
  MasterBarDoc,
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
  createDefaultPlaybackInfo,
  STANDARD_GUITAR_TUNING
} from '../models/composer.model';
import {
  beatsAt,
  setBeatDurations,
  setDynamics,
  setGrace,
  setTuplet,
  toggleBeatEffect,
  toggleFermata,
  toggledValue
} from './beat-edits';
import { CursorMove, clampedCursor, movedCursor } from './composer-cursor';
import { defaultFermata } from './composer-tool-defaults';
import { BeatRef, followedEnd, selectionTargets } from './composer-selection';
import { ComposerEntryCommands, ComposerEntryHost } from './composer-entry-commands';
import { ComposerStructureCommands, EditOutcome, SelectionPlacement, noticeOfOutcome } from './composer-service-structure';
import {
  EditScope,
  beatEffectRefusal,
  durationRefusal,
  editRefusal,
  fermataRefusal,
  graceRefusal,
  noteEffectRefusal,
  tieRefusal,
  trillRefusal,
  tupletRefusal
} from './edit-refusals';
import { fermataSnapshotOf, settleFermatas } from './fermata-settling';
import { setAccidental, toggleNoteEffect, toggleTie, toggleTrill } from './note-edits';
import { moveNotesToString, shiftSemitone } from './note-moves';
import { respellNotes, respellRefusal } from './note-respell';
import { GeneratedTrack, flattenGeneratedTrack, mergeGeneratedTrack } from './progression-track';
import { deleteBars } from './bar-edits';
import { LAST_TRACK_REFUSAL } from './composer-text';
import { insertBarInto } from './score-structure';

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
 *
 * The bar and track commands, and Fix bar, live in `ComposerStructureCommands`
 * (composer-service-structure.ts), which this file had to shed to stay under the
 * 1000-line cap. Their public methods stay here and delegate, so callers see one
 * service; the helper reaches back only through `state`, `commitFollowing`,
 * `refuse` and `markDiverged`.
 */
@Injectable({ providedIn: 'root' })
export class ComposerService {
  private static readonly MAX_HISTORY = 100;

  private readonly stateSubject: BehaviorSubject<ComposerState>;
  private undoStack: ScoreDoc[] = [];
  private redoStack: ScoreDoc[] = [];

  /** What the command modules reach back through. */
  private readonly host: ComposerEntryHost = {
    state: () => this.stateSubject.getValue(),
    commit: (edit, amend) => this.commit(edit, amend),
    commitFollowing: (edit, place, notice) => this.commitFollowing(edit, place, notice),
    refuse: reason => this.refuse(reason),
    markDiverged: draft => this.markDiverged(draft),
    setInputDuration: (duration, dots) => this.setInputDuration(duration, dots)
  };
  private readonly structure = new ComposerStructureCommands(this.host);
  private readonly entry = new ComposerEntryCommands(this.host);

  constructor() {
    this.stateSubject = new BehaviorSubject<ComposerState>({
      doc: ComposerService.createEmptyScore(),
      cursor: createDefaultCursor(),
      anchor: null,
      refusal: null,
      notice: null,
      messageId: 0,
      documentId: 0,
      entryMode: 'select',
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

  /** The current state, for a command that decides what to do from it - a toggle, a caret step. */
  get state(): ComposerState {
    return this.stateSubject.getValue();
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

  /**
   * Runs `edit` on a cloned document and commits the result - or, when `edit` returns a reason,
   * publishes that and commits nothing. With `amend` the result replaces the last commit instead of
   * adding an undo step: the second digit of a two-digit fret (`retypeNote`).
   */
  private commit(edit: (draft: ScoreDoc) => EditOutcome, amend = false): void {
    const state = this.stateSubject.getValue();
    const draft = structuredClone(state.doc);
    const reason = edit(draft);
    if (typeof reason === 'string') return this.refuse(reason);
    // An amend replaces the commit before it, whose notice - a fermata the first digit's note removed - still holds.
    const notice = noticeOfOutcome(null, reason);
    this.commitDocument(draft, undefined, amend, amend ? notice ?? state.notice : notice);
  }

  /**
   * Runs `edit` on a clone of the document and commits it with the selection still on its
   * beats - or, when `edit` returns a reason, publishes that and commits nothing, so an edit
   * that refuses part-way leaves nothing behind.
   *
   * The selection's ends name beats by position, and an edit can move the beats they name: a
   * duration change puts rests right after each beat it shortens, a new grace gets its gap's
   * rests in front of it, Fix bar splits and carries beats. Left by position, a range of four
   * notes made eighths would end on a rest halfway through them, and the next press would miss
   * half the notes. So the beat each end names is found before the edit and looked for again
   * after it (`followedEnd`). An end whose beat is gone stays where it was, clamped. `place`, when
   * given, decides the selection from those followed ends instead, in the same publish, and `notice`
   * what the command says it did (`ComposerState.notice`).
   */
  private commitFollowing(
    edit: (draft: ScoreDoc) => EditOutcome,
    place?: (draft: ScoreDoc, followed: SelectionPlacement) => SelectionPlacement,
    notice?: () => string | null
  ): void {
    const state = this.stateSubject.getValue();
    const draft = structuredClone(state.doc);
    const cursorBeat = this.beatAt(draft, state.cursor);
    const anchorBeat = state.anchor ? this.beatAt(draft, state.anchor) : null;

    const reason = edit(draft);
    if (typeof reason === 'string') return this.refuse(reason);

    const followed: SelectionPlacement = {
      cursor: followedEnd(draft, state.cursor, cursorBeat),
      anchor: state.anchor ? followedEnd(draft, state.anchor, anchorBeat) : null
    };
    this.commitDocument(draft, place ? place(draft, followed) : followed, false, noticeOfOutcome(notice?.() ?? null, reason));
  }

  /**
   * Publishes a prepared document and pushes the old one onto undo, with `selection` in place
   * of the current one when given. Either way the selection is clamped into the new document.
   */
  private commitDocument(
    next: ScoreDoc,
    selection?: { cursor: EditCursor; anchor: EditCursor | null },
    amend = false,
    notice: string | null = null
  ): void {
    const state = this.stateSubject.getValue();
    const cursor = selection ? selection.cursor : state.cursor;
    const anchor = selection ? selection.anchor : state.anchor;
    if (!amend) {
      this.undoStack.push(structuredClone(state.doc));
      if (this.undoStack.length > ComposerService.MAX_HISTORY) this.undoStack.shift();
    }
    this.redoStack = [];

    this.stateSubject.next({
      ...state,
      doc: next,
      cursor: clampedCursor(cursor, next),
      anchor: anchor ? clampedCursor(anchor, next) : null,
      refusal: null,
      notice,
      // A new message, unless an amend kept the one already showing (`commit`).
      messageId: notice !== null && !(amend && notice === state.notice) ? state.messageId + 1 : state.messageId,
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
      cursor: clampedCursor(state.cursor, previous),
      anchor: state.anchor ? clampedCursor(state.anchor, previous) : null,
      refusal: null,
      notice: null,
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
      cursor: clampedCursor(state.cursor, next),
      anchor: state.anchor ? clampedCursor(state.anchor, next) : null,
      refusal: null,
      notice: null,
      isDirty: true,
      canUndo: true,
      canRedo: this.redoStack.length > 0
    });
  }

  /**
   * Replaces the whole document: by default an edit of this composition, as an applied alphaTex draft is, on the undo
   * stack. A new composition - a load, an opened transcription - moves `documentId` on and starts a fresh history.
   */
  replaceDocument(doc: ScoreDoc, { markClean = false, newComposition = false }: DocumentReplacement = {}): void {
    const state = this.stateSubject.getValue();
    if (newComposition) this.undoStack = [];
    else this.undoStack.push(structuredClone(state.doc));
    this.redoStack = [];

    this.stateSubject.next({
      ...state,
      doc,
      cursor: clampedCursor(state.cursor, doc),
      anchor: null,
      refusal: null,
      notice: null,
      documentId: newComposition ? state.documentId + 1 : state.documentId,
      isDirty: !markClean,
      canUndo: this.undoStack.length > 0,
      canRedo: false
    });
  }

  /**
   * Marks the document clean, if `saved` - the document that was written - is still it. A save is written
   * asynchronously, and an edit made while it was being written is not in it, so it stays unsaved.
   */
  markSaved(saved: ScoreDoc): void {
    const state = this.stateSubject.getValue();
    if (state.doc !== saved) return;
    this.stateSubject.next({ ...state, isDirty: false });
  }

  // -------------------------------------------------------------------------
  // Cursor
  // -------------------------------------------------------------------------

  /** Moves the caret, and drops any range: a plain click or arrow key. */
  setCursor(cursor: Partial<EditCursor>): void {
    const state = this.stateSubject.getValue();
    this.publishSelection(clampedCursor({ ...state.cursor, ...cursor }, state.doc), null);
  }

  /**
   * Moves the selection's moving end, fixing the other end where the caret was if no range
   * existed yet: shift-click and shift-arrow.
   */
  extendSelectionTo(cursor: Partial<EditCursor>): void {
    const state = this.stateSubject.getValue();
    this.publishSelection(clampedCursor({ ...state.cursor, ...cursor }, state.doc), state.anchor ?? state.cursor);
  }

  /** Selects every beat of the caret's staff, first bar to last. */
  selectAllInTrack(): void {
    const { doc, cursor } = this.stateSubject.getValue();
    this.publishSelection(
      movedCursor(doc, cursor, { kind: 'scoreEdge', edge: 'last' }),
      movedCursor(doc, cursor, { kind: 'scoreEdge', edge: 'first' })
    );
  }

  /**
   * Moves the caret by `move` (see `movedCursor`) - or, with `extend`, the selection's moving end.
   * A plain move drops the range, except a change of string, which moves the focus within it.
   */
  moveCursor(move: CursorMove, extend = false): void {
    const state = this.stateSubject.getValue();
    const anchor = extend ? state.anchor ?? state.cursor : move.kind === 'string' ? state.anchor : null;
    this.publishSelection(movedCursor(state.doc, state.cursor, move), anchor);
  }

  moveCursorByBeat(delta: number): void {
    this.moveCursor({ kind: 'beat', delta });
  }

  moveCursorByString(delta: number): void {
    this.moveCursor({ kind: 'string', delta });
  }

  /** Chooses what a notation click does. Not an edit, so no undo step. See `EntryMode`. */
  setEntryMode(entryMode: EntryMode): void {
    this.stateSubject.next({ ...this.stateSubject.getValue(), entryMode });
  }

  /**
   * Publishes a selection, and clears any refusal: it answered a press on the selection that was,
   * and left standing it would read as the reason a press on this one failed.
   */
  private publishSelection(cursor: EditCursor, anchor: EditCursor | null): void {
    this.stateSubject.next({ ...this.stateSubject.getValue(), cursor, anchor, refusal: null, notice: null });
  }

  // -------------------------------------------------------------------------
  // Note entry
  // -------------------------------------------------------------------------

  /** Writes a note at the caret, replacing any note already on that string, and by default advances. */
  setNoteAtCursor(pitch: NotePitch, advance = true): void {
    this.entry.setNoteAtCursor(pitch, advance);
  }

  /** Rewrites the note just written at `target`, as one undo step with it. See `retypeNote` in composer-entry-commands.ts. */
  retypeNote(target: EditCursor, pitch: NotePitch): void {
    this.entry.retypeNote(target, pitch);
  }

  /** Turns the beat at the caret into a rest, and by default advances. */
  setRestAtCursor(advance = true): void {
    this.entry.setRestAtCursor(advance);
  }

  /** Clears the beat at the caret back to a rest, keeping its slot. */
  deleteAtCursor(): void {
    this.entry.deleteAtCursor();
  }

  /** Clears every beat in the selection to a rest, keeping their values. */
  clearSelectionToRests(): void {
    this.entry.clearSelectionToRests();
  }

  /** Inserts a rest at the input duration in front of the caret, leaving the caret on it. */
  insertBeat(): void {
    this.entry.insertBeat();
  }

  /** Removes the selected beats; the beats after them move earlier. */
  deleteBeats(): void {
    this.entry.deleteBeats();
  }

  /** Copies the selection's beats to the composer's clipboard. */
  copy(): void {
    this.entry.copy();
  }

  /** Copies the selection's beats and clears them to rests. */
  cut(): void {
    this.entry.cut();
  }

  /** Pastes the clipboard from the start of the selection, as one run. See `pasteBeats`. */
  paste(): void {
    this.entry.paste();
  }

  setInputDuration(duration: DurationValue, dots = 0): void {
    const state = this.stateSubject.getValue();
    this.stateSubject.next({ ...state, inputDuration: duration, inputDots: dots });
  }

  /**
   * Applies a duration to the selection, and remembers it as the choice for the next note.
   *
   * The refusal covers the write and stops there, because these are two effects and only one of
   * them is the score's business. The input duration is the palette's, and the palette belongs to
   * whichever track the caret moves to next: refusing both would freeze it while the caret rests on a
   * generated track, and take away choosing a duration there to carry back to your own. So a refused
   * press still remembers the choice - and says why the beat did not change (`durationRefusal`),
   * since a palette that moves while the score does not needs a reason beside it.
   *
   * It keeps each bar honest through `setBeatDurations`: a gap fills with rests where it opened, and
   * a beat that grows takes only rests. The selection follows its beats past the rests that inserts.
   */
  applyDurationAtCursor(duration: DurationValue, dots: number): void {
    const state = this.stateSubject.getValue();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);
    const refusal = durationRefusal(state.doc, refs, duration, dots);

    if (refusal) this.refuse(refusal);
    else this.commitFollowing(draft => setBeatDurations(draft, refs, duration, dots));

    this.setInputDuration(duration, dots);
  }

  /** Dots the selection's beats at their own values, and remembers the dots. See `applyDotsAtCursor` in composer-entry-commands.ts. */
  applyDotsAtCursor(dots: number): void {
    this.entry.applyDotsAtCursor(dots);
  }

  // -------------------------------------------------------------------------
  // Edits on the selection
  // -------------------------------------------------------------------------

  /** Presses a note effect tool on the selection. See `toggleNoteEffect` in note-edits.ts, and `noteEffectRefusal`. */
  toggleNoteEffect<K extends keyof NoteEffectsDoc>(key: K, on: NoteEffectsDoc[K], off: NoteEffectsDoc[K]): void {
    this.applyEdit(
      (doc, refs, focus) => noteEffectRefusal(doc, refs, focus, key, on, off),
      (draft, refs, focus) => toggleNoteEffect(draft, refs, focus, key, on, off)
    );
  }

  setAccidental(accidental: AccidentalMode): void {
    this.applyEdit({ family: 'note', key: 'accidental', accidental }, (draft, refs, focus) => setAccidental(draft, refs, focus, accidental));
  }

  /** Presses Tie on the notes with a note to tie from. See `toggleTie` and `tieRefusal`. */
  toggleTie(): void {
    this.applyEdit(tieRefusal, (draft, refs, focus) => toggleTie(draft, refs, focus));
  }

  /** Presses a beat effect tool on the selection. Not grace: see `toggleGrace`. */
  toggleBeatEffect<K extends Exclude<keyof BeatEffectsDoc, 'grace'>>(
    key: K,
    on: BeatEffectsDoc[K],
    off: BeatEffectsDoc[K]
  ): void {
    this.applyEdit(
      (doc, refs) => beatEffectRefusal(doc, refs, key, on, off),
      (draft, refs) => toggleBeatEffect(draft, refs, key, on, off)
    );
  }

  /**
   * Presses Grace before or Grace on beat, by the toggle rule: when every target is already
   * that grace, they become ordinary beats again. A grace takes no room, so this is a length
   * change, and `setGrace` settles each bar as a duration change does.
   *
   * The rests that fill a new grace's gap go where its value stood, in front of it, so the
   * grace's index moves forward by however many rests that took. The selection follows it
   * (`commitFollowing`), so the next press - an effect on the grace - acts on the grace and not
   * on a rest. A second press of this tool is no way back from a mistaken one: the ordinary beat
   * it makes takes only the rests after it, so the rests in front stay. Undo takes it back.
   */
  toggleGrace(grace: Exclude<BeatEffectsDoc['grace'], 'none'>): void {
    this.applyEdit((doc, refs) => graceRefusal(doc, refs, grace), (draft, refs) =>
      setGrace(draft, refs, toggledValue(beatsAt(draft, refs).map(beat => beat.effects.grace), grace, 'none'))
    );
  }

  setDynamics(dynamics: DynamicValue | null): void {
    this.applyEdit({ family: 'beat', key: 'dynamics' }, (draft, refs) => setDynamics(draft, refs, dynamics));
  }

  setTuplet(tuplet: Tuplet | null): void {
    this.applyEdit((doc, refs) => tupletRefusal(doc, refs, tuplet), (draft, refs) => setTuplet(draft, refs, tuplet));
  }

  /** Presses Trill: each note a whole step above itself at the default speed, or none. See `toggleTrill`. */
  toggleTrill(): void {
    this.applyEdit(trillRefusal, (draft, refs, focus) => toggleTrill(draft, refs, focus));
  }

  /** Presses Fermata: at the selection's positions, on every track. See `toggleFermata`. */
  toggleFermata(): void {
    this.applyEdit(fermataRefusal, (draft, refs) => toggleFermata(draft, refs, defaultFermata()));
  }

  /** Respell: each note to its next spelling. See note-respell.ts. */
  respell(): void {
    this.applyEdit(respellRefusal, (draft, refs, focus) => respellNotes(draft, refs, focus));
  }

  /** Moves the selection's notes a semitone up (+1) or down (-1). See `shiftSemitone`. */
  shiftSemitone(delta: 1 | -1): void {
    this.applyEdit({ family: 'note', key: 'notes' }, (draft, refs, focus) => shiftSemitone(draft, refs, focus, delta));
  }

  /**
   * Moves the selection's notes to the string above (-1) or below (+1), keeping their pitch. See
   * `moveNotesToString`. On the caret alone, the caret's string follows the note.
   */
  moveNotesToString(delta: 1 | -1): void {
    const before = this.doc;
    this.applyEdit({ family: 'note', key: 'notes' }, (draft, refs, focus) => moveNotesToString(draft, refs, focus, delta));
    if (this.doc !== before && !this.stateSubject.getValue().anchor) this.moveCursor({ kind: 'string', delta });
  }

  /**
   * The one way a note or beat edit reaches the document.
   *
   * A refusal is published and nothing is committed, so a refused press costs no undo step
   * and changes nothing at all - not half a range. The focused string applies only when the
   * selection is the caret alone: a range means every note in it. The selection follows its
   * beats through whatever the edit inserts or removes (`commitFollowing`).
   */
  private applyEdit(
    scope: EditScope | ((doc: ScoreDoc, refs: BeatRef[], focus: number | null) => string | null),
    edit: (draft: ScoreDoc, refs: BeatRef[], focus: number | null) => EditOutcome
  ): void {
    const state = this.stateSubject.getValue();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);
    const focus = state.anchor ? null : state.cursor.stringIndex;
    const refusal = typeof scope === 'function' ? scope(state.doc, refs, focus) : editRefusal(state.doc, refs, scope, focus);
    if (refusal) {
      this.refuse(refusal);
      return;
    }
    this.commitFollowing(draft => edit(draft, refs, focus));
  }

  /** Publishes why a command did nothing. Commits nothing, so it costs no undo step. */
  private refuse(reason: string): void {
    const state = this.stateSubject.getValue();
    this.stateSubject.next({ ...state, refusal: reason, notice: null, messageId: state.messageId + 1 });
  }

  // -------------------------------------------------------------------------
  // Bar and track edits, and Fix bar: see composer-service-structure.ts
  // -------------------------------------------------------------------------

  /** Declares a time signature from the selection's first bar, fitting the bars under it. */
  setTimeSignature(timeSignature: TimeSignature): void {
    this.structure.setTimeSignature(timeSignature);
  }

  /** Sets the key on every staff from the selection's first bar. */
  setKeySignature(keySignature: KeySignature): void {
    this.structure.setKeySignature(keySignature);
  }

  /** Sets clef and ottava on the caret's staff from the selection's first bar. */
  setClef(clef: ClefKind, ottava: OttaviaKind): void {
    this.structure.setClef(clef, ottava);
  }

  /** A bar flag over the selected bars, by the toggle rule. */
  toggleMasterBarFlag(key: 'isRepeatStart' | 'isDoubleBar' | 'isFreeTime'): void {
    this.structure.toggleMasterBarFlag(key);
  }

  setMasterBarValue<K extends 'repeatCount' | 'alternateEndings' | 'tripletFeel' | 'section'>(
    key: K,
    value: MasterBarDoc[K]
  ): void {
    this.structure.setMasterBarValue(key, value);
  }

  setStaffTuning(tuning: number[], label: string): void {
    this.structure.setStaffTuning(tuning, label);
  }

  setStaffNumber(key: 'capo' | 'transpose' | 'displayTranspose', value: number): void {
    this.structure.setStaffNumber(key, value);
  }

  setStaffViews(views: Partial<Pick<StaffDoc, 'showStandardNotation' | 'showTablature' | 'showSlash' | 'showNumbered'>>): void {
    this.structure.setStaffViews(views);
  }

  setPlayback(changes: Partial<PlaybackInfoDoc>): void {
    this.structure.setPlayback(changes);
  }

  renameTrack(name: string, shortName: string): void {
    this.structure.renameTrack(name, shortName);
  }

  /** Carries the overflow of every over bar in the selection into the bars after it, all or nothing. */
  fixBar(): void {
    this.structure.fixBar();
  }

  /** Repeat close over the selected bars, by the toggle rule. */
  toggleRepeatClose(): void {
    this.structure.toggleRepeatClose();
  }

  /** Inserts as many bars as are selected, in front of the first. */
  insertBarsBeforeSelection(): void {
    this.structure.insertBarsBeforeSelection();
  }

  /** Removes the selected bars from every track, keeping the meter after them. */
  deleteSelectedBars(): void {
    this.structure.deleteSelectedBars();
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

  /** Removes bar `index` from every track, keeping the meter after it. See `deleteBars`. */
  removeBar(index: number): void {
    if (this.doc.masterBars.length <= 1) return;
    this.commit(draft => {
      const at = Math.max(0, Math.min(index, draft.masterBars.length - 1));
      deleteBars(draft, { first: at, last: at });
      this.markDiverged(draft);
    });
  }

  /** Adds a track of rests, holding every bar position's fermata as the other tracks do (`settleFermatas`). */
  addTrack(name: string, program: number, fretted: boolean): void {
    this.commit(draft => {
      const fermatas = fermataSnapshotOf(draft, draft.masterBars.keys());
      draft.tracks.push(
        ComposerService.createTrack(
          name,
          name.slice(0, 3).toLowerCase(),
          program,
          fretted,
          draft.masterBars
        )
      );
      settleFermatas(draft, fermatas);
    });
  }

  removeTrack(index: number): void {
    if (this.doc.tracks.length <= 1) return this.refuse(LAST_TRACK_REFUSAL);
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
    this.commit(draft => void Object.assign(draft, mergeGeneratedTrack(draft, generated)));
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
    this.commit(draft => void Object.assign(draft, flattenGeneratedTrack(draft, index)));
  }

  /**
   * True when the track at `trackIndex` is a progression's rather than the
   * user's.
   *
   * `flattenTrack`'s guard. Every command that writes a note or a beat asks
   * `editRefusal`, which reads the same marker. Neither reaches `insertBar`, `removeBar` or
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
      notice: null,
      messageId: 0,
      documentId: this.stateSubject.getValue().documentId + 1,
      entryMode: 'select',
      inputDuration: 4,
      inputDots: 0,
      isDirty: false,
      canUndo: false,
      canRedo: false
    });
  }
}
