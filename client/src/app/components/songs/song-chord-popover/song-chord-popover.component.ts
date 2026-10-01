import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  ViewChild,
  inject
} from '@angular/core';
import { Node } from 'prosemirror-model';
import type { TimeSignature } from '../../../models/composer.model';
import { MIN_SLOT_BEATS } from '../../../models/progression-normalize';
import type { ChordDegree, ProgressionKey } from '../../../models/progression.model';
import { ModalFocus } from '../../../services/modal-focus';
import { barBeats } from '../../../services/progression-score';
import {
  SongEdit,
  SongKeyRules,
  changeChord,
  chordWithId,
  deleteChord,
  setChordLength
} from '../../../services/song-commands';
import { numeralOf } from '../../../services/song-chord-names';
import { songMetaOf } from '../../../services/song-document';
import { ChordNaming, chordLabelOf } from '../song-sheet/chord-view';
import { SongChordFieldComponent } from '../song-chord-field/song-chord-field.component';

/** One of the length presets: a share of a bar of the song's meter. */
export interface LengthPreset {
  label: string;
  beats: number;
}

/** Everything the popover shows, worked out from the document once per change rather than in the template. */
interface PopoverModel {
  key: ProgressionKey;
  scaleIntervals: readonly number[] | null;
  /** The chord as the sheet names it, for the field to start from: `Am`, or empty for a chord with no name. */
  name: string;
  /** The heading: `Am · vi`, or the name alone when the chord has no numeral. */
  title: string;
  lengthBeats: number;
  lengthText: string;
  presets: readonly LengthPreset[];
}

/**
 * The length presets for a meter: half a bar, a bar and two bars, in beats (quarter notes, `barBeats`) - leaving out
 * any shorter than the shortest a chord can be (`MIN_SLOT_BEATS`), which a press could only round up to something
 * the label does not say. A bar of 4/4 is 4 beats, of 3/4 is 3, of 6/8 is 3.
 */
export function lengthPresetsOf(timeSignature: TimeSignature): LengthPreset[] {
  const bar = barBeats(timeSignature);
  return [
    { label: '½ bar', beats: bar / 2 },
    { label: '1 bar', beats: bar },
    { label: '2 bars', beats: bar * 2 }
  ].filter(preset => preset.beats >= MIN_SLOT_BEATS);
}

/** Gives each popover's heading a distinct id for `aria-labelledby`. */
let popoverCount = 0;

/** A length as the stepper shows it: "1 beat", "4 beats", "1.5 beats". */
function lengthTextOf(beats: number): string {
  const shown = Number(beats.toFixed(2));
  return `${shown} ${shown === 1 ? 'beat' : 'beats'}`;
}

/**
 * The popover a chord on the sheet opens when its name is clicked, or Enter is pressed on it (design Part 2): change
 * the chord, change its length, delete it.
 *
 * **Everything it does is a song command**, handed to the page on `edit` and run on the sheet, so each press is one
 * step in the song's undo history and the popover keeps no copy of the chord: it is given the document after every
 * change and finds its chord again by id. A document without it - the chord undone away - shows nothing, and the page
 * closes the popover.
 *
 * - **Chord**: the chord field, starting from the chord's lead-sheet name. Enter runs `changeChord` - the same chord
 *   id and length, the new degree, re-voiced (see `changeChord` for why owned pitches are handed back, as on the
 *   progression page).
 * - **Length**: a stepper that moves to the next whole beat either way, and presets of half a bar, a bar and two bars
 *   of the song's meter, the one the chord is now marked pressed (`setChordLength`).
 * - **Delete** (`deleteChord`), which closes the popover.
 *
 * Hearing the chord is task 9's: the popover has no button for it until there is a sound behind it.
 *
 * **Focus.** A non-modal dialog: nothing behind it is made inert, and a press outside it closes it, leaving the focus
 * where the press put it. While it is open the focus is in it - on the chord field first - and Tab goes round its
 * controls rather than out into the page, by the composer's `ModalFocus.trapTab`; the rest of `ModalFocus`, which
 * moves the focus to a heading and back on an `open` input, does not fit a popover the page creates and destroys, so
 * the page gives the focus back instead (`closed` says whether it should). Escape anywhere in it closes it and gives
 * the focus back to the sheet, with the chord still selected.
 */
@Component({
  selector: 'app-song-chord-popover',
  standalone: true,
  imports: [CommonModule, SongChordFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './song-chord-popover.component.html',
  styleUrls: ['./song-chord-popover.component.scss']
})
export class SongChordPopoverComponent implements OnChanges {
  /** The song now. */
  @Input() doc: Node | null = null;
  /** The chord this popover is for. */
  @Input() chordId = '';
  @Input() keys: Pick<SongKeyRules, 'chordScaleFor'> | null = null;

  /** A change to the song, for the page to run on the sheet. */
  @Output() readonly edit = new EventEmitter<SongEdit>();
  /**
   * The popover is done: true when the focus should go back to the sheet, false when a press outside has already put
   * it somewhere else.
   */
  @Output() readonly closed = new EventEmitter<boolean>();

  @ViewChild('dialog') private dialog?: ElementRef<HTMLElement>;

  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private readonly focus = new ModalFocus();

  readonly titleId = `song-chord-popover-title-${++popoverCount}`;
  model: PopoverModel | null = null;

  ngOnChanges(): void {
    this.model = this.modelOf();
  }

  /** Escape from anywhere inside closes it. The chord field's own Escape is the same request, and stops there. */
  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closed.emit(true);
      return;
    }
    this.focus.trapTab(event, this.model !== null, this.dialog?.nativeElement);
  }

  /** A press anywhere outside closes it, leaving the focus to the press. */
  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (target instanceof globalThis.Node && this.host.contains(target)) return;
    this.closed.emit(false);
  }

  changeChord(degree: ChordDegree): void {
    if (this.keys !== null) this.edit.emit(changeChord(this.keys, this.chordId, degree));
  }

  /** One step to the next whole beat in `dir`: 4 to 5 or 3, and 1.5 to 2 or 1. */
  step(dir: -1 | 1): void {
    const length = this.model?.lengthBeats;
    if (length === undefined) return;
    const next = dir > 0 ? Math.floor(length) + 1 : Math.ceil(length) - 1;
    this.edit.emit(setChordLength(this.chordId, next));
  }

  setLength(beats: number): void {
    this.edit.emit(setChordLength(this.chordId, beats));
  }

  remove(): void {
    this.edit.emit(deleteChord(this.chordId));
    this.closed.emit(true);
  }

  cancel(): void {
    this.closed.emit(true);
  }

  /** Whether the shorter step is at the shortest a chord can be, where a press changes nothing. */
  atShortest(): boolean {
    return (this.model?.lengthBeats ?? MIN_SLOT_BEATS) <= MIN_SLOT_BEATS;
  }

  trackByLabel(_index: number, preset: LengthPreset): string {
    return preset.label;
  }

  private modelOf(): PopoverModel | null {
    const doc = this.doc;
    const found = doc === null ? null : chordWithId(doc, this.chordId);
    if (doc === null || found === null) return null;

    const { key, timeSignature } = songMetaOf(doc);
    const scaleIntervals = this.keys?.chordScaleFor(key) ?? null;
    const naming: ChordNaming = { key, scaleIntervals, numerals: false };
    const label = chordLabelOf(found.attrs, naming);
    const harmony = found.attrs.harmony;
    const lengthBeats = found.attrs.lengthBeats;
    // A chord with no name - one detached from its degree, or in a key no chord can be named in - is headed `?`, as
    // the sheet prints it, and the field starts empty rather than from a `?` it would refuse.
    const numeral =
      harmony.kind === 'degree' && scaleIntervals !== null ? numeralOf(harmony.degree, scaleIntervals) : null;

    return {
      key,
      scaleIntervals,
      name: numeral === null ? '' : label.text,
      title: numeral === null ? label.text : `${label.text} · ${numeral}`,
      lengthBeats,
      lengthText: lengthTextOf(lengthBeats),
      presets: lengthPresetsOf(timeSignature)
    };
  }
}
