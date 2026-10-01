import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges
} from '@angular/core';
import { Node } from 'prosemirror-model';
import type { ChordDegree, ProgressionKey } from '../../../models/progression.model';
import type { ChordAtomAttrs } from '../../../models/song.model';
import { keyNameOf } from '../../../services/song-chord-names';
import { SongEdit, SongKeyRules, transposeSong } from '../../../services/song-commands';
import { songMetaOf } from '../../../services/song-document';
import { SongPalette, SongPaletteOption, isSameChord, songPaletteOf } from '../../../services/song-palette';

/** The four groups, by the row of the palette each draws. */
export type ChordGroupId = 'triads' | 'sevenths' | 'borrowed' | 'secondary';

/** One cell: the chord it places, its two lines in the order the sheet's toggle asks, and whether it is selected. */
export interface ChordCell {
  readonly option: SongPaletteOption;
  /** What the sheet shows now - the name, or with numerals on, the numeral. */
  readonly primary: string;
  /** The other of the two, smaller, underneath. */
  readonly secondary: string;
  /** The chord selected on the sheet builds this cell's chord. */
  readonly current: boolean;
}

export interface ChordGroup {
  readonly id: ChordGroupId;
  readonly title: string;
  /** The id of its heading, which labels the group. */
  readonly headingId: string;
  readonly cells: readonly ChordCell[];
}

const GROUP_TITLES: Readonly<Record<ChordGroupId, string>> = {
  triads: 'Triads',
  sevenths: 'Sevenths',
  borrowed: 'Borrowed',
  secondary: 'Secondary dominants'
};

const PLACE_HINT = 'Click a chord to place it at the caret.';
const REPLACE_HINT = 'Click a chord to replace the one selected on the sheet.';

/**
 * The Chords tab (design Part 2): the song's key between Transpose ↑↓, and the key's chords in four groups - triads
 * and sevenths side by side, borrowed chords and secondary dominants below - each cell its chord's name and numeral.
 *
 * **It never changes the song itself**, as the toolbar does not: Transpose emits a `SongEdit` (`edit`) the page runs
 * on the sheet, and a cell emits the degree it stands for (`chosen`) and nothing more. Whether that chord is placed
 * at the caret or replaces the selected chord is the page's to decide, since it needs the sheet's caret and selection
 * and this panel is outside the sheet; the panel only says which will happen (`hint`), from the selected chord it is
 * handed.
 *
 * **What the cells say is the sheet's.** The rows are `songPaletteOf`'s, named and numbered by the functions the sheet
 * prints a chord with, so a cell and the chord it places read the same.
 *
 * - **Names or numerals first, per the sheet's I-IV toggle**, with the other underneath, smaller. The first and larger
 *   line is the one the eye scans for, and it should be the token the user is reading over the words: someone in
 *   numerals finds `vi`, not `Am`, and the name is still there under it. The order moves only when the user flips the
 *   toggle, which is a deliberate act, not under the pointer.
 * - **A secondary dominant also shows its role**, `V/ii`, under the two: the sheet numbers it by its place in the key
 *   (`VI7`), because an atom does not store the chord it leads to, and the role is the reason it is in this row.
 *
 * **Colour only on the selection** (the flat tool style): the cell whose chord is selected on the sheet is the one
 * coloured, and carries `aria-current`; nothing else has chrome until hovered.
 *
 * **Plain buttons, one tab stop each, not a roving tabindex.** Every cell is a command of its own, as the progression
 * palette's buttons are, and a native button needs no script to be pressed, found by a screen reader's button list,
 * or reached by voice control. A roving tabindex would save Tab presses, but its arrow keys would have to mean a
 * direction in a grid that reflows - two columns of seven beside the sheet, rows of cells under it on a narrow
 * screen - and an arrow that goes somewhere different at each width is worse than a longer Tab. The panel is the last
 * thing on the page, so its stops come after everything else.
 */
@Component({
  selector: 'app-song-chord-panel',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './song-chord-panel.component.html',
  styleUrls: ['./song-chord-panel.component.scss']
})
export class SongChordPanelComponent implements OnChanges {
  /** The song now: its key decides the chords. */
  @Input() doc: Node | null = null;
  @Input() keys: SongKeyRules | null = null;
  /** Whether the sheet shows numerals, so the cells put them first. */
  @Input() numerals = false;
  /** The chord selected on the sheet, which a click replaces, or null. */
  @Input() selected: ChordAtomAttrs | null = null;

  /** Transpose ↑↓, for the page to run on the sheet. */
  @Output() readonly edit = new EventEmitter<SongEdit>();
  /** A cell was clicked: the chord it places. */
  @Output() readonly chosen = new EventEmitter<ChordDegree>();

  /** `C Ionian (Major)`, as the library's cards and the progression page write a key. */
  keyName = '';
  /** Why the key has no chords to offer, in place of the groups; null when it has. */
  refusal: string | null = null;
  /** Triads and sevenths, side by side when there is room. */
  diatonic: readonly ChordGroup[] = [];
  /** Borrowed chords and secondary dominants, below; a group with nothing to offer is left out. */
  chromatic: readonly ChordGroup[] = [];
  hint = PLACE_HINT;

  private key: ProgressionKey | null = null;
  private scaleIntervals: readonly number[] | null = null;
  private palette: SongPalette | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    const doc = this.doc;
    const keys = this.keys;
    if (doc === null || keys === null) return;

    // The song's document is new on every keystroke; its key is the same object until the key changes.
    const key = songMetaOf(doc).key;
    const rekeyed = key !== this.key || changes['keys'] !== undefined;
    if (rekeyed) {
      this.key = key;
      this.scaleIntervals = keys.chordScaleFor(key);
      this.palette = songPaletteOf(key, this.scaleIntervals);
      this.keyName = keyNameOf(key, keys.findScale(key.scaleId));
    }
    if (rekeyed || changes['numerals'] !== undefined || changes['selected'] !== undefined) this.layOut();
  }

  /** A cell clicked: its chord, for the page to place or put in place of the selected one. */
  choose(cell: ChordCell): void {
    this.chosen.emit(cell.option.degree);
  }

  /** ↑ or ↓: the song a semitone up or down, as the toolbar's Transpose. */
  transpose(delta: -1 | 1): void {
    if (this.keys !== null) this.edit.emit(transposeSong(this.keys, delta));
  }

  trackByGroup(_index: number, group: ChordGroup): ChordGroupId {
    return group.id;
  }

  /** A cell by its chord's name, which no two cells in one group share. */
  trackByCell(_index: number, cell: ChordCell): string {
    return cell.option.name;
  }

  private layOut(): void {
    const palette = this.palette;
    const scaleIntervals = this.scaleIntervals;
    this.hint = this.selected === null ? PLACE_HINT : REPLACE_HINT;
    if (palette === null || palette.kind === 'refused' || scaleIntervals === null) {
      this.refusal = palette?.kind === 'refused' ? palette.reason : null;
      this.diatonic = [];
      this.chromatic = [];
      return;
    }

    const harmony = this.selected?.harmony;
    const selected = harmony?.kind === 'degree' ? harmony.degree : null;
    const group = (id: ChordGroupId, options: readonly SongPaletteOption[]): ChordGroup => ({
      id,
      title: GROUP_TITLES[id],
      headingId: `song-chord-panel-${id}`,
      cells: options.map(option => ({
        option,
        primary: this.numerals ? option.numeral : option.name,
        secondary: this.numerals ? option.name : option.numeral,
        current: selected !== null && isSameChord(option.degree, selected, scaleIntervals)
      }))
    });

    const { triads, sevenths, borrowed, secondary } = palette.rows;
    this.refusal = null;
    this.diatonic = [group('triads', triads), group('sevenths', sevenths)];
    this.chromatic = [group('borrowed', borrowed), group('secondary', secondary)].filter(entry => entry.cells.length > 0);
  }
}
