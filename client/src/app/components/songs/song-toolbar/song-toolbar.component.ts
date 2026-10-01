import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  inject
} from '@angular/core';
import { Node } from 'prosemirror-model';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import type { Scale } from '../../../models/music-theory.model';
import { TEMPO_MAX, TEMPO_MIN } from '../../../models/progression-normalize';
import { SECTION_KINDS, SectionKind, SongMeta } from '../../../models/song.model';
import { MusicTheoryService } from '../../../services/music-theory.service';
import type { ProgressionKeyContext } from '../../../services/progression-key-context';
import {
  SongEdit,
  addSection,
  copyLabelOf,
  setSongKey,
  setTempo,
  setTimeSignature,
  transposeSong
} from '../../../services/song-commands';
import { sectionsOf, songMetaOf } from '../../../services/song-document';
import {
  LYRIC_SIZES,
  LyricSize,
  SongSheetPreferences,
  SongSheetPreferencesService
} from '../../../services/song-sheet-preferences.service';
import { SECTION_KIND_NAMES } from '../song-sheet/section-view';

/** One entry in the tonic menu: a pitch class, and - for the five black keys - which of its two names. */
export interface TonicOption {
  /** `'0'` for C; `'1#'` / `'1b'` for C# / Db. */
  value: string;
  label: string;
  tonic: number;
  /** The spelling this entry picks, or null for a white key, whose spelling the key's signature decides. */
  preferSharps: boolean | null;
}

/** A category of scales a song can be in, for the scale menu's `<optgroup>`. */
export interface ScaleGroup {
  name: string;
  scales: readonly Scale[];
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * The tonic menu: the seven white keys once and the five black keys under both names, C, C#, Db, D, ... B.
 *
 * Both names because a pitch class cannot say how a key is spelled, and the user can: F# major and Gb major are the
 * same notes written in six sharps or six flats, and which one a song is in is theirs to say. A white key is listed
 * once, its spelling left to its signature (`spellingFor`): F major is in flats and nobody means it any other way.
 * ASCII `#` and `b`, as chord names and the library's key names write them.
 */
export const TONIC_OPTIONS: readonly TonicOption[] = Object.freeze(
  SHARP_NAMES.flatMap((sharp, tonic): TonicOption[] => {
    const flat = FLAT_NAMES[tonic];
    if (sharp === flat) return [{ value: `${tonic}`, label: sharp, tonic, preferSharps: null }];
    return [
      { value: `${tonic}#`, label: sharp, tonic, preferSharps: true },
      { value: `${tonic}b`, label: flat, tonic, preferSharps: false }
    ];
  })
);

/** The tonic menu's entry for a key: its pitch class, and for a black key the spelling the key is in. */
export function tonicValueOf(tonic: number, preferSharps: boolean): string {
  const white = TONIC_OPTIONS.some(option => option.tonic === tonic && option.preferSharps === null);
  return white ? `${tonic}` : `${tonic}${preferSharps ? '#' : 'b'}`;
}

/** The meter menus' numbers: up to sixteen beats, over the four note values a song's beat is written in. */
const NUMERATORS: readonly number[] = Array.from({ length: 16 }, (_, index) => index + 1);
const DENOMINATORS: readonly number[] = [2, 4, 8, 16];

/**
 * The scale categories the key menu leaves out: `fretboardNotes` holds note filters for the fretboard - all notes,
 * the naturals, the sharps - not keys, though "Natural Notes" has seven notes a chord could be stacked through.
 */
const NOT_KEYS: ReadonlySet<string> = new Set(['fretboardNotes']);

/**
 * A new section's name: its kind's name, and for a verse a number one past the highest verse already in the song.
 *
 * Verses are numbered because each has its own words; a chorus, an intro or a bridge is not, because a repeated
 * chorus is the same chorus - the rule `copyLabelOf` follows for a duplicate, whose numbering this reuses: a "Verse 0"
 * counted on past every "Verse N" the song has is the next verse.
 */
export function newSectionLabelOf(kind: SectionKind, labels: readonly string[]): string {
  const name = SECTION_KIND_NAMES[kind];
  return kind === 'verse' ? copyLabelOf(`${name} 0`, labels) : name;
}

/** The size after `size` in `Aa`'s round: small, medium, large, and small again. */
function nextLyricSizeOf(size: LyricSize): LyricSize {
  return LYRIC_SIZES[(LYRIC_SIZES.indexOf(size) + 1) % LYRIC_SIZES.length];
}

/**
 * The song's toolbar (design Part 2): Undo and Redo, the key and Transpose, BPM, the time signature, the
 * names/numerals toggle, the lyric size, and "+ Section".
 *
 * **It never changes the song itself.** Each control builds a `SongEdit` and emits it, and the page runs it on the
 * sheet, so every change lands in the sheet's one history and every refusal in the page's one live region. The two
 * display choices are the exception - they are not the song's - and go to `SongSheetPreferencesService`.
 *
 * **Its controls show the song, not what was last picked.** A refused or unchanged edit leaves the song as it was, and
 * a select whose bound value did not change would go on showing the refused pick: Angular writes a binding only when
 * it changes. So each handler puts its control back to the song's value as it emits, and the song's new value, if it
 * took, arrives with the next document through the bindings.
 */
@Component({
  selector: 'app-song-toolbar',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './song-toolbar.component.html',
  styleUrls: ['./song-toolbar.component.scss']
})
export class SongToolbarComponent implements OnInit, OnChanges, OnDestroy {
  /** The song now: what every control shows. */
  @Input() doc: Node | null = null;
  @Input() keys: ProgressionKeyContext | null = null;
  @Input() canUndo = false;
  @Input() canRedo = false;

  @Output() readonly edit = new EventEmitter<SongEdit>();
  @Output() readonly undo = new EventEmitter<void>();
  @Output() readonly redo = new EventEmitter<void>();
  /** Something the toolbar did that the page's live region should say: a tempo held to its range. */
  @Output() readonly notice = new EventEmitter<string>();
  /** The lyrics should have the focus: a section was just added, with the caret in its first line. */
  @Output() readonly sheetFocus = new EventEmitter<void>();

  private readonly preferencesService = inject(SongSheetPreferencesService);
  private readonly musicTheory = inject(MusicTheoryService);
  private readonly changes = inject(ChangeDetectorRef);
  private readonly destroy$ = new Subject<void>();

  readonly tonicOptions = TONIC_OPTIONS;
  readonly numerators = NUMERATORS;
  readonly sectionKinds = SECTION_KINDS;
  readonly kindNames = SECTION_KIND_NAMES;
  readonly tempoMin = TEMPO_MIN;
  readonly tempoMax = TEMPO_MAX;

  meta: SongMeta | null = null;
  tonicValue = '0';
  scaleGroups: readonly ScaleGroup[] = [];
  /** The song's scale when the menu does not offer it - one saved by something other than this page - else null. */
  unlistedScale: string | null = null;
  denominators: readonly number[] = DENOMINATORS;
  preferences: SongSheetPreferences = this.preferencesService.preferences;
  /** The size `Aa` goes to next, for its tooltip. */
  nextLyricSize: LyricSize = nextLyricSizeOf(this.preferences.lyricSize);
  sectionMenuOpen = false;
  private labels: readonly string[] = [];

  ngOnInit(): void {
    this.scaleGroups = this.musicTheory
      .getScaleCategories()
      .filter(category => !NOT_KEYS.has(category.id))
      .map(category => ({
        name: category.name,
        scales: category.scales.filter(scale => this.keys !== null && this.keys.chordScale(scale) !== null)
      }))
      .filter(group => group.scales.length > 0);
    this.describeScale();

    this.preferencesService.preferences$.pipe(takeUntil(this.destroy$)).subscribe(preferences => {
      this.preferences = preferences;
      this.nextLyricSize = nextLyricSizeOf(preferences.lyricSize);
      this.changes.markForCheck();
    });
  }

  ngOnChanges(): void {
    if (this.doc === null) return;
    const meta = songMetaOf(this.doc);
    this.meta = meta;
    this.labels = sectionsOf(this.doc).map(section => section.label);
    this.tonicValue = tonicValueOf(meta.key.tonic, meta.key.preferSharps);
    const denominator = meta.timeSignature.denominator;
    this.denominators = DENOMINATORS.includes(denominator) ? DENOMINATORS : [...DENOMINATORS, denominator].sort((a, b) => a - b);
    this.describeScale();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * A tonic picked: a black key's entry says how the key is spelled, a white key's leaves it to the signature. The
   * scale stays.
   */
  chooseTonic(select: HTMLSelectElement): void {
    const option = TONIC_OPTIONS.find(entry => entry.value === select.value);
    select.value = this.tonicValue;
    if (option === undefined || this.meta === null || this.keys === null) return;
    this.edit.emit(setSongKey(this.keys, option.tonic, this.meta.key.scaleId, option.preferSharps ?? undefined));
  }

  /**
   * A scale picked: the tonic stays, and the spelling is worked out afresh for the new key - C ionian to C aeolian goes
   * to flats - as Transpose does, rather than carried from a key whose signature it was.
   */
  chooseScale(select: HTMLSelectElement): void {
    const scaleId = select.value;
    select.value = this.meta?.key.scaleId ?? scaleId;
    if (this.meta === null || this.keys === null) return;
    this.edit.emit(setSongKey(this.keys, this.meta.key.tonic, scaleId));
  }

  transpose(delta: -1 | 1): void {
    if (this.keys !== null) this.edit.emit(transposeSong(this.keys, delta));
  }

  /**
   * The BPM field committed (Enter, or leaving it): a whole number held to the range the progression page plays, with
   * the live region saying so when it was held; anything that is not a number puts the song's tempo back.
   */
  commitTempo(input: HTMLInputElement): void {
    const current = this.meta?.tempo;
    if (current === undefined) return;
    const typed = input.value.trim() === '' ? NaN : Math.round(Number(input.value));
    input.value = String(current);
    if (!Number.isFinite(typed)) {
      this.notice.emit(`BPM is a number from ${TEMPO_MIN} to ${TEMPO_MAX}.`);
      return;
    }

    const bpm = Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, typed));
    if (bpm !== typed) {
      this.notice.emit(`BPM runs from ${TEMPO_MIN} to ${TEMPO_MAX}, so it is set to ${bpm}.`);
      // The song may already be at the bound, and then no new document comes to write the field.
      input.value = String(bpm);
    }
    this.edit.emit(setTempo(bpm));
  }

  /**
   * A meter number picked. **Common time is 4/4 and only 4/4**: a song brought back to 4/4 is then the same as one that
   * never left it, and whether the score draws it as `C` is notation, the composer's to decide, not a control here.
   */
  chooseMeter(part: 'numerator' | 'denominator', select: HTMLSelectElement): void {
    const value = Number(select.value);
    const meter = this.meta?.timeSignature;
    if (meter === undefined) return;
    select.value = String(meter[part]);
    const next = { ...meter, [part]: value };
    this.edit.emit(
      setTimeSignature({
        numerator: next.numerator,
        denominator: next.denominator,
        isCommon: next.numerator === 4 && next.denominator === 4
      })
    );
  }

  toggleNumerals(): void {
    this.preferencesService.setNumerals(!this.preferences.numerals);
  }

  /** `Aa`: the next lyric size, small after large. */
  stepLyricSize(): void {
    this.preferencesService.setLyricSize(this.nextLyricSize);
  }

  toggleSectionMenu(): void {
    this.sectionMenuOpen = !this.sectionMenuOpen;
  }

  /**
   * "+ Section": a section of `kind` after the one holding the caret, named by `newSectionLabelOf`, and the focus in
   * its first line - where the command puts the caret - so the next thing typed is its first words.
   */
  addSection(kind: SectionKind): void {
    this.sectionMenuOpen = false;
    this.edit.emit(addSection(kind, newSectionLabelOf(kind, this.labels)));
    this.sheetFocus.emit();
  }

  /** Escape closes the section menu and gives the focus back to its button. */
  closeSectionMenu(toggle: HTMLElement, event: Event): void {
    if (!this.sectionMenuOpen) return;
    event.preventDefault();
    event.stopPropagation();
    this.sectionMenuOpen = false;
    toggle.focus();
  }

  /** A click outside "+ Section" closes its menu, as a menu is expected to. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.sectionMenuOpen) return;
    const target = event.target;
    if (target instanceof Element && target.closest('.add-section') !== null) return;
    this.sectionMenuOpen = false;
    this.changes.markForCheck();
  }

  trackByValue(_index: number, option: TonicOption): string {
    return option.value;
  }

  trackByName(_index: number, group: ScaleGroup): string {
    return group.name;
  }

  private describeScale(): void {
    const scaleId = this.meta?.key.scaleId;
    if (scaleId === undefined) return;
    const listed = this.scaleGroups.some(group => group.scales.some(scale => scale.id === scaleId));
    this.unlistedScale = listed ? null : (this.keys?.findScale(scaleId)?.name ?? scaleId);
  }
}
