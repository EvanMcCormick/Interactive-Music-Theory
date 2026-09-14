import {
  ClefKind,
  ComposerState,
  EditCursor,
  KeySignature,
  MasterBarDoc,
  OttaviaKind,
  PlaybackInfoDoc,
  ScoreDoc,
  StaffDoc,
  TimeSignature
} from '../models/composer.model';
import {
  deleteBars,
  insertBarsBefore,
  keySignatureFault,
  toggleRepeatClose,
  setClef,
  setKeySignature,
  setMasterBarValue,
  setTimeSignature,
  timeSignatureFault,
  toggleMasterBarFlag
} from './bar-edits';
import { barFillAt, fixBarOverflow } from './bar-fill';
import { selectedBars } from './composer-selection';
import { editRefusal } from './edit-refusals';
import { renameTrack, setPlayback, setStaffNumber, setStaffTuning, setStaffViews } from './track-edits';

/**
 * The composer's bar and track commands, and Fix bar.
 *
 * Lifted out of `ComposerService` to keep that file under the 1000-line cap, as the M1 plan's
 * Task D6 asked. The service still owns the state, the history and the selection, and still
 * exposes every one of these commands: each of its public methods delegates here unchanged, and
 * this class reaches the service only through `ComposerCommandHost`.
 */

/** A selection: the caret, and the fixed end of a range or null. */
export interface SelectionPlacement {
  cursor: EditCursor;
  anchor: EditCursor | null;
}

/** What the bar and track commands need from `ComposerService`. */
export interface ComposerCommandHost {
  /** The current state. */
  state(): ComposerState;
  /**
   * Runs `edit` on a clone and commits it with the selection still on its beats - or, when
   * `edit` returns a reason, publishes that and commits nothing.
   *
   * `place`, when given, decides the selection instead, from the edited draft and the ends as they
   * followed their beats - so a command that moves the caret or drops the range does it in the same
   * commit, and the state is published once.
   */
  commitFollowing(
    edit: (draft: ScoreDoc) => string | null | void,
    place?: (draft: ScoreDoc, followed: SelectionPlacement) => SelectionPlacement
  ): void;
  /** Publishes why a command did nothing. Commits nothing. */
  refuse(reason: string): void;
  /** Stamps every generated track in `draft` as diverged from its progression. */
  markDiverged(draft: ScoreDoc): void;
}

/** Bar, track and Fix bar commands on the selection, run through a `ComposerCommandHost`. */
export class ComposerStructureCommands {
  constructor(private readonly host: ComposerCommandHost) {}

  setTimeSignature(timeSignature: TimeSignature): void {
    const fault = timeSignatureFault(timeSignature);
    if (fault) return this.host.refuse(fault);
    this.applyBarEdit((draft, bars) => setTimeSignature(draft, bars.first, timeSignature));
  }

  setKeySignature(keySignature: KeySignature): void {
    const fault = keySignatureFault(keySignature);
    if (fault) return this.host.refuse(fault);
    this.applyBarEdit((draft, bars) => setKeySignature(draft, bars.first, keySignature));
  }

  setClef(clef: ClefKind, ottava: OttaviaKind): void {
    const { trackIndex, staffIndex } = this.host.state().cursor;
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
      return this.host.refuse('A section needs a name.');
    }
    if ((key === 'repeatCount' || key === 'alternateEndings') && (value as number) < 0) {
      return this.host.refuse('That cannot be negative.');
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
   * Fix bar: carries the overflow of every over bar in the selection, on the caret's staff,
   * into the bars after it.
   *
   * Runs on a clone and commits only if every bar fixed, because `fixBarOverflow` can refuse
   * part-way - a tuplet across a line - and a half-carried score is exactly the corruption
   * the refusal exists to prevent. Refused on a generated track like any content edit.
   * Appending a bar is score-wide, so it stamps generated tracks diverged; carrying within
   * existing bars touches only this staff and does not. Each selected bar is read with
   * `barFillAt`, against its own meter and free time, rather than measuring the whole score
   * once per bar. The selection follows its beats where they survive; the beat split at a line
   * is replaced by its pieces, so an end on it stays where it was.
   */
  fixBar(): void {
    const state = this.host.state();
    const { trackIndex, staffIndex } = state.cursor;
    const refusal = editRefusal(state.doc, [], { family: 'track', trackIndex }, null);
    if (refusal) return this.host.refuse(refusal);

    const bars = selectedBars(state.anchor, state.cursor);
    this.host.commitFollowing(draft => {
      let fixed = false;
      let appended = 0;

      for (let index = bars.first; index <= bars.last; index++) {
        if (barFillAt(draft, trackIndex, staffIndex, index)?.kind !== 'over') continue;
        const result = fixBarOverflow(draft, trackIndex, staffIndex, index);
        if (result.kind === 'refused') return result.reason;
        fixed = true;
        appended += result.appendedBars;
      }

      if (!fixed) return 'No selected bar is over its time signature.';
      if (appended > 0) this.host.markDiverged(draft);
      return null;
    });
  }

  /** Repeat close over the selected bars, by the toggle rule. See `toggleRepeatClose`. */
  toggleRepeatClose(): void {
    this.applyBarEdit((draft, bars) => toggleRepeatClose(draft, bars));
  }

  /** Inserts as many bars as are selected, in front of the first. The selection follows its beats. */
  insertBarsBeforeSelection(): void {
    this.applyBarEdit((draft, bars) => insertBarsBefore(draft, bars.first, bars.last - bars.first + 1));
  }

  /**
   * Removes the selected bars from every track (see `deleteBars`), and drops the range: its beats are
   * gone. The caret goes to the first beat of the bar that took their place, on its own staff.
   */
  deleteSelectedBars(): void {
    const state = this.host.state();
    const bars = selectedBars(state.anchor, state.cursor);
    this.host.commitFollowing(
      draft => {
        const refusal = deleteBars(draft, bars);
        if (refusal) return refusal;
        this.host.markDiverged(draft);
        return null;
      },
      () => ({ cursor: { ...state.cursor, barIndex: bars.first, beatIndex: 0 }, anchor: null })
    );
  }

  /**
   * A bar edit over the selected bars. Score-wide, like `insertBar`: never refused on a
   * generated track, and it stamps every generated track diverged in the same commit.
   */
  private applyBarEdit(edit: (draft: ScoreDoc, bars: { first: number; last: number }) => void): void {
    const state = this.host.state();
    const bars = selectedBars(state.anchor, state.cursor);
    this.host.commitFollowing(draft => {
      edit(draft, bars);
      this.host.markDiverged(draft);
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
    const state = this.host.state();
    const { trackIndex, staffIndex } = state.cursor;
    if (gated) {
      const refusal = editRefusal(state.doc, [], { family: 'track', trackIndex }, null);
      if (refusal) return this.host.refuse(refusal);
    }
    this.host.commitFollowing(draft => edit(draft, trackIndex, staffIndex));
  }
}
