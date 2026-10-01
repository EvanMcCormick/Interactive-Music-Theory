import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Node } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { createExtensions } from '../../../models/progression-normalize';
import type { ChordDegree, ProgressionKey } from '../../../models/progression.model';
import type { ChordAtomAttrs } from '../../../models/song.model';
import { MusicTheoryService } from '../../../services/music-theory.service';
import { ProgressionKeyContext } from '../../../services/progression-key-context';
import { SongEdit } from '../../../services/song-commands';
import { chordSlotOf, createSongContent, songMetaOf } from '../../../services/song-document';
import { SongChordPanelComponent } from './song-chord-panel.component';

const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const FOUR_FOUR = { numerator: 4, denominator: 4, isCommon: true };

function degreeAt(degree: number, extent: 3 | 7 = 3): ChordDegree {
  return {
    degree,
    alter: 0,
    extent,
    quality: null,
    inversion: 0,
    suspension: 'none',
    extensions: createExtensions(),
    octave: 0
  };
}

/**
 * The Chords tab's contents: the song's key between its transpose arrows, and the key's chords in four groups, each
 * cell naming and numbering its chord as the sheet will and handing its degree to the page when clicked.
 */
describe('SongChordPanelComponent', () => {
  let fixture: ComponentFixture<SongChordPanelComponent>;
  let host: HTMLElement;
  let chosen: ChordDegree[];
  let edits: SongEdit[];
  const keys = new ProgressionKeyContext(new MusicTheoryService());

  function show(doc: Node, inputs: { numerals?: boolean; selected?: ChordDegree | null } = {}): void {
    fixture = TestBed.createComponent(SongChordPanelComponent);
    host = fixture.nativeElement;
    chosen = [];
    edits = [];
    fixture.componentInstance.chosen.subscribe(degree => chosen.push(degree));
    fixture.componentInstance.edit.subscribe(edit => edits.push(edit));
    fixture.componentRef.setInput('doc', doc);
    fixture.componentRef.setInput('keys', keys);
    if (inputs.numerals !== undefined) fixture.componentRef.setInput('numerals', inputs.numerals);
    if (inputs.selected !== undefined) fixture.componentRef.setInput('selected', selectedAtom(inputs.selected));
    fixture.detectChanges();
  }

  /** A chord atom's attributes for `degree`, as the sheet hands over the selected one. */
  function selectedAtom(degree: ChordDegree | null): ChordAtomAttrs | null {
    return degree === null ? null : chordSlotOf(degree, C_MAJOR, IONIAN, FOUR_FOUR);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SongChordPanelComponent] }).compileComponents();
  });

  afterEach(() => fixture?.destroy());

  const text = (element: Element | null): string => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const group = (id: string): HTMLElement => {
    const found = host.querySelector<HTMLElement>(`[data-group="${id}"]`);
    if (!found) throw new Error(`No ${id} group`);
    return found;
  };
  const cells = (id: string): HTMLButtonElement[] => Array.from(group(id).querySelectorAll<HTMLButtonElement>('.cell'));
  const lines = (id: string, part: 'primary' | 'secondary' | 'role'): string[] =>
    cells(id).map(cell => text(cell.querySelector(`.cell-${part}`)));

  it('shows the song’s key between its transpose arrows', () => {
    show(createSongContent({ key: C_MAJOR }));
    expect(text(host.querySelector('.panel-key-name'))).toBe('C Ionian (Major)');
    expect(host.querySelector('.panel-transpose-up')?.getAttribute('aria-label')).toBe('Transpose the song up a semitone');
    expect(host.querySelector('.panel-transpose-down')?.getAttribute('aria-label')).toBe(
      'Transpose the song down a semitone'
    );
  });

  it('lays the key’s chords out in four labelled groups, each cell its name over its numeral', () => {
    show(createSongContent({ key: C_MAJOR }));

    for (const [id, title] of [
      ['triads', 'Triads'],
      ['sevenths', 'Sevenths'],
      ['borrowed', 'Borrowed'],
      ['secondary', 'Secondary dominants']
    ]) {
      const labelledBy = group(id).getAttribute('aria-labelledby') ?? '';
      expect(group(id).getAttribute('role')).toBe('group');
      expect(text(host.querySelector(`#${labelledBy}`))).toBe(title);
    }
    expect(lines('triads', 'primary')).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'B°']);
    expect(lines('triads', 'secondary')).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
    expect(lines('sevenths', 'primary')).toEqual(['Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bø7']);
    expect(lines('borrowed', 'primary')).toEqual(['Db', 'Eb', 'Fm', 'Ab', 'Bb']);
    expect(lines('secondary', 'primary')).toEqual(['A7', 'B7', 'C7', 'D7', 'E7']);
    expect(lines('secondary', 'role')).toEqual(['V/ii', 'V/iii', 'V/IV', 'V/V', 'V/vi']);
    expect(cells('triads')[5].getAttribute('aria-label')).toBe('A minor');
  });

  it('puts numerals first when the sheet shows numerals', () => {
    show(createSongContent({ key: C_MAJOR }), { numerals: true });
    expect(lines('triads', 'primary')).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
    expect(lines('triads', 'secondary')).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'B°']);
  });

  it('hands a clicked cell’s chord to the page', () => {
    show(createSongContent({ key: C_MAJOR }));
    cells('triads')[3].click();
    cells('sevenths')[4].click();
    expect(chosen).toEqual([degreeAt(3), degreeAt(4, 7)]);
  });

  it('transposes the song from its arrows', () => {
    const doc = createSongContent({ key: C_MAJOR });
    show(doc);
    host.querySelector<HTMLButtonElement>('.panel-transpose-up')?.click();
    host.querySelector<HTMLButtonElement>('.panel-transpose-down')?.click();

    const state = EditorState.create({ doc });
    const tonicAfter = (edit: SongEdit): number | null => {
      const outcome = edit(state);
      return outcome.kind === 'edit' ? songMetaOf(outcome.tr.doc).key.tonic : null;
    };
    expect(edits.map(tonicAfter)).toEqual([1, 11]);
  });

  it('follows the song into a new key', () => {
    show(createSongContent({ key: C_MAJOR }));
    fixture.componentRef.setInput('doc', createSongContent({ key: { tonic: 9, scaleId: 'aeolian', preferSharps: true } }));
    fixture.detectChanges();

    expect(text(host.querySelector('.panel-key-name'))).toBe('A Aeolian (Natural Minor)');
    expect(lines('triads', 'primary')).toEqual(['Am', 'B°', 'C', 'Dm', 'Em', 'F', 'G']);
  });

  it('marks the cell of the chord selected on the sheet, and says a click will replace it', () => {
    show(createSongContent({ key: C_MAJOR }));
    expect(text(host.querySelector('.panel-hint'))).toBe('Click a chord to place it at the caret.');
    expect(host.querySelectorAll('.cell.on').length).toBe(0);

    fixture.componentRef.setInput('selected', selectedAtom(degreeAt(5)));
    fixture.detectChanges();

    const marked = Array.from(host.querySelectorAll('.cell.on'));
    expect(marked).toEqual([cells('triads')[5]]);
    expect(cells('triads')[5].getAttribute('aria-current')).toBe('true');
    expect(cells('triads')[4].hasAttribute('aria-current')).toBeFalse();
    expect(text(host.querySelector('.panel-hint'))).toBe('Click a chord to replace the one selected on the sheet.');
  });

  describe('the sound toggle', () => {
    const toggle = (): HTMLButtonElement => {
      const found = host.querySelector<HTMLButtonElement>('.panel-sound');
      if (!found) throw new Error('No sound toggle');
      return found;
    };

    it('is a pressed toggle, named for what it does, while chords sound as they are placed', () => {
      show(createSongContent({ key: C_MAJOR }));
      fixture.componentRef.setInput('playOnPlace', true);
      fixture.detectChanges();

      expect(toggle().getAttribute('aria-label')).toBe('Play chords as I place them');
      expect(toggle().getAttribute('aria-pressed')).toBe('true');
      expect(toggle().classList).toContain('on');
    });

    it('asks for the other setting when pressed, leaving the setting itself to the page', () => {
      const asked: boolean[] = [];
      show(createSongContent({ key: C_MAJOR }));
      fixture.componentInstance.playOnPlaceChange.subscribe(on => asked.push(on));
      fixture.componentRef.setInput('playOnPlace', true);
      fixture.detectChanges();

      toggle().click();
      fixture.detectChanges();
      expect(asked).toEqual([false]);
      expect(toggle().getAttribute('aria-pressed')).toBe('true');

      fixture.componentRef.setInput('playOnPlace', false);
      fixture.detectChanges();
      expect(toggle().getAttribute('aria-pressed')).toBe('false');
      expect(toggle().classList).not.toContain('on');
      toggle().click();
      expect(asked).toEqual([false, true]);
    });

    it('stays beside the key when the key has no chords to offer', () => {
      show(createSongContent({ key: { tonic: 0, scaleId: 'majorPentatonic', preferSharps: true } }));
      expect(host.querySelector('.panel-sound')).not.toBeNull();
    });
  });

  it('says why a key that cannot build chords has none, in place of the grid', () => {
    show(createSongContent({ key: { tonic: 0, scaleId: 'majorPentatonic', preferSharps: true } }));
    expect(text(host.querySelector('.panel-refusal'))).toBe(
      "This key's scale can't build chords; choose a seven-note scale for the song."
    );
    expect(host.querySelectorAll('.cell').length).toBe(0);
  });
});
