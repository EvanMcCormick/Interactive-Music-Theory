import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import type { ChordDegree, ProgressionKey } from '../../../models/progression.model';
import { chordFromText } from '../../../services/song-chord-parse';
import { leadSheetNameOf, numeralOf } from '../../../services/song-chord-names';

/** What the field says under itself about the text in it. */
export interface ChordHint {
  /** `empty`: nothing typed yet, a prompt. `chord`: what Enter would place. `refused`: why Enter would not. */
  kind: 'empty' | 'chord' | 'refused';
  text: string;
}

/**
 * What the field says about `text` in `key`: the chord it reads, by both of the sheet's names for it - `Am · vi` -
 * or the parser's reason for reading none, or the parser's prompt when there is nothing to read.
 *
 * Both names, because the field takes either and a songwriter thinks in one or the other: typing `vi` and seeing
 * `Am` confirms the key is the one they think it is, and typing `Bb` in C and seeing `♭VII` says how the sheet will
 * file it - and transpose it.
 */
export function chordHintOf(text: string, key: ProgressionKey, scaleIntervals: readonly number[] | null): ChordHint {
  const reading = chordFromText(text, key, scaleIntervals);
  if (reading.kind === 'refused') return { kind: text.trim() === '' ? 'empty' : 'refused', text: reading.reason };
  // `chordFromText` reads a chord only in a key whose scale can build them, so this is a broken promise, not a case.
  if (scaleIntervals === null) throw new Error('A chord was read in a key with no chord scale');
  return {
    kind: 'chord',
    text: `${leadSheetNameOf(reading.degree, key, scaleIntervals)} · ${numeralOf(reading.degree, scaleIntervals)}`
  };
}

/** Gives each field's hint a distinct id for `aria-describedby`. */
let fieldCount = 0;

/**
 * The chord field: a text box that takes a chord by name or numeral - `Am`, `vi`, `Bb7`, `F/A` - in the song's key
 * (design Part 2), says under itself what it would place, and hands the chord on as a degree.
 *
 * It is used in two places, and owns neither's placement: the field `[` opens over the lyrics (the song page anchors
 * it at the caret, and places what it hands on), and the Chord row of a chord's popover (which changes the chord to
 * it). Both want the same reading, the same hint and the same keys, so they share this.
 *
 * **The keys.** Enter hands the chord on - or, for text it cannot read, keeps the text, marks the field invalid and
 * says the reason aloud. A `]` typed at the end does what Enter does, so `[Am]` typed in one go, the ChordPro way,
 * places Am wherever `[` opened the field (see `song-editor-plugins.ts`). Escape cancels, and goes no further: the
 * page's own Escape (the nav drawer's) must not fire as well.
 *
 * **Accessibility.** A plain labelled text input - not a combobox: it offers no list to pick from - described by its
 * hint, so the hint is read when the field takes the focus. The hint changes on every keystroke and is not itself
 * live, which would chatter; a refusal at Enter is said once through an alert, in two halves that swap so the same
 * reason said twice is still a change (`SongEditorComponent.messages`'s pattern).
 */
@Component({
  selector: 'app-song-chord-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './song-chord-field.component.html',
  styleUrls: ['./song-chord-field.component.scss']
})
export class SongChordFieldComponent implements OnChanges, AfterViewInit {
  /** The song's key, which the text is read in. */
  @Input() key: ProgressionKey | null = null;
  /** The key's scale when it can build chords, else null - and then every chord is refused, with the reason. */
  @Input() scaleIntervals: readonly number[] | null = null;
  /** The text the field starts from - the chord's own name in a popover - and starts again from when it changes. */
  @Input() initial = '';
  @Input() label = 'Chord name or numeral';
  /** Take the focus on opening, with the starting text selected so typing replaces it. */
  @Input() autofocus = false;

  /** A chord read from the text, at Enter or a closing `]`. */
  @Output() readonly chosen = new EventEmitter<ChordDegree>();
  /** Escape. */
  @Output() readonly cancelled = new EventEmitter<void>();

  @ViewChild('input', { static: true }) private input?: ElementRef<HTMLInputElement>;

  readonly hintId = `song-chord-hint-${++fieldCount}`;
  text = '';
  hint: ChordHint = { kind: 'empty', text: '' };
  /** Set by a refused Enter, cleared by the next edit: `aria-invalid` says the text is the problem, not the key. */
  invalid = false;
  /** The alert's two halves (see the class comment). */
  alerts: readonly [string, string] = ['', ''];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initial']) {
      this.text = this.initial;
      this.invalid = false;
    }
    this.hint = this.hintFor(this.text);
  }

  ngAfterViewInit(): void {
    const input = this.input?.nativeElement;
    if (!this.autofocus || input === undefined) return;
    input.focus();
    input.select();
  }

  /** Every edit: the hint follows the text, and a `]` at the end commits it. */
  onInput(input: HTMLInputElement): void {
    this.invalid = false;
    if (input.value.endsWith(']')) {
      input.value = input.value.slice(0, -1);
      this.read(input.value);
      this.commit();
      return;
    }
    this.read(input.value);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelled.emit();
    }
  }

  private read(text: string): void {
    this.text = text;
    this.hint = this.hintFor(text);
  }

  /** Hands the chord on, or keeps the field open and says why not. */
  private commit(): void {
    const key = this.key;
    const reading = key === null ? null : chordFromText(this.text, key, this.scaleIntervals);
    if (reading?.kind === 'chord') {
      this.invalid = false;
      this.chosen.emit(reading.degree);
      return;
    }
    this.invalid = true;
    const reason = reading?.reason ?? this.hint.text;
    this.alerts = this.alerts[0] === '' ? [reason, ''] : ['', reason];
  }

  private hintFor(text: string): ChordHint {
    return this.key === null ? { kind: 'empty', text: '' } : chordHintOf(text, this.key, this.scaleIntervals);
  }
}
