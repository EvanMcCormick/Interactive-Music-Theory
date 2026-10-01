import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Node } from 'prosemirror-model';
import { NodeSelection } from 'prosemirror-state';
import { createExtensions } from '../../../models/progression-normalize';
import { ChordDegree, ProgressionKey } from '../../../models/progression.model';
import { MusicTheoryService } from '../../../services/music-theory.service';
import { ProgressionKeyContext } from '../../../services/progression-key-context';
import { deleteSection, setTempo, transposeSong } from '../../../services/song-commands';
import { chordSlotOf, sectionsOf, songMetaOf } from '../../../services/song-document';
import { songSchema } from '../../../services/song-schema';
import { SongSheetComponent } from './song-sheet.component';

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

/** A C major chord atom on `degree` (0-6): `chord(5)` is Am, `chord(6, 7)` is Bø7. */
function chord(degree: number, extent: 3 | 7 = 3): Node {
  return songSchema.node('chord', chordSlotOf(degreeAt(degree, extent), C_MAJOR, IONIAN, FOUR_FOUR));
}

function line(...content: (string | Node)[]): Node {
  return songSchema.node(
    'lyricLine',
    null,
    content.map(part => (typeof part === 'string' ? songSchema.text(part) : part))
  );
}

function section(id: string, label: string, ...lines: Node[]): Node {
  return songSchema.node('section', { id, label, kind: 'verse' }, lines.length > 0 ? lines : [line()]);
}

function song(...sections: Node[]): Node {
  return songSchema.node(
    'doc',
    { title: 'Last Dance', artist: '', key: C_MAJOR, tempo: 100, timeSignature: FOUR_FOUR },
    sections
  );
}

/**
 * The song sheet: a real `EditorView` in the page's DOM, laid out by the component's own styles, so where a chord's
 * name sits and how far a collision pushes the line are measured, not assumed.
 */
describe('SongSheetComponent', () => {
  let fixture: ComponentFixture<SongSheetComponent>;
  let sheet: SongSheetComponent;
  let host: HTMLElement;
  let changed: Node[];
  let refusals: string[];
  let notices: string[];

  const keys = new ProgressionKeyContext(new MusicTheoryService());

  function open(doc: Node): void {
    fixture = TestBed.createComponent(SongSheetComponent);
    sheet = fixture.componentInstance;
    host = fixture.nativeElement;
    fixture.componentRef.setInput('initialDoc', doc);
    fixture.componentRef.setInput('keys', keys);
    changed = [];
    refusals = [];
    notices = [];
    sheet.docChanged.subscribe(next => changed.push(next));
    sheet.refused.subscribe(reason => refusals.push(reason));
    sheet.notice.subscribe(message => notices.push(message));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SongSheetComponent] }).compileComponents();
  });

  afterEach(() => fixture?.destroy());

  const chordEls = (): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>('.song-chord'));
  const names = (): string[] => chordEls().map(el => el.querySelector('.song-chord-name')?.textContent ?? '');
  const nameOf = (el: HTMLElement): HTMLElement => {
    const name = el.querySelector<HTMLElement>('.song-chord-name');
    if (!name) throw new Error('A chord with no name');
    return name;
  };
  const current = (): Node => {
    const state = sheet.editorState();
    if (!state) throw new Error('No editor');
    return state.doc;
  };

  /** The box of the first character after `el`: the letter its chord is anchored to. */
  function letterAfter(el: HTMLElement): DOMRect {
    let next: ChildNode | null = el.nextSibling;
    while (next && next.nodeType !== globalThis.Node.TEXT_NODE) next = next.nextSibling;
    if (!next) throw new Error('No letter after the chord');
    const range = document.createRange();
    range.setStart(next, 0);
    range.setEnd(next, 1);
    return range.getBoundingClientRect();
  }

  /** Lets ProseMirror's DOM observer read a change the browser made, which it does on a mutation callback. */
  const settled = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 20));

  describe('chord names', () => {
    it('sits each name above the letter its chord is anchored to', () => {
      open(song(section('v1', 'Verse 1', line(chord(5), 'Wondering where ', chord(3), 'the'))));

      expect(names()).toEqual(['Am', 'F']);
      for (const el of chordEls()) {
        const name = nameOf(el).getBoundingClientRect();
        const letter = letterAfter(el);
        expect(Math.abs(name.left - letter.left)).toBeLessThan(1);
        expect(name.bottom).toBeLessThanOrEqual(letter.top + 1);
      }
    });

    it('takes no width in the words', () => {
      open(song(section('v1', 'Verse 1', line('ab', chord(0), 'cd'))));
      const before = document.createRange();
      const text = host.querySelector('.song-lyric-line')?.firstChild;
      if (!text) throw new Error('No text');
      before.setStart(text, 1);
      before.setEnd(text, 2);
      const b = before.getBoundingClientRect();
      const c = letterAfter(chordEls()[0]);
      expect(Math.abs(c.left - b.right)).toBeLessThan(1);
    });

    it('names each chord for assistive technology', () => {
      open(song(section('v1', 'Verse 1', line(chord(5), 'Wondering'))));
      expect(chordEls()[0].getAttribute('aria-label')).toBe('chord A minor');
    });

    it('widens the line rather than letting two names collide', () => {
      open(song(section('v1', 'Verse 1', line(chord(6, 7), 'a', chord(0), 'b'))));

      const [first, second] = chordEls();
      expect(parseFloat(second.style.paddingLeft)).toBeGreaterThan(0);
      expect(nameOf(second).getBoundingClientRect().left).toBeGreaterThan(nameOf(first).getBoundingClientRect().right);
      // The name still sits over its own letter, which has moved right to make room.
      expect(Math.abs(nameOf(second).getBoundingClientRect().left - letterAfter(second).left)).toBeLessThan(1);
    });

    it('leaves names with room between them where they are', () => {
      open(song(section('v1', 'Verse 1', line(chord(0), 'Hello there my ', chord(4), 'friend'))));
      expect(chordEls()[1].style.paddingLeft).toBe('');
    });

    it('takes the padding away again when the collision goes', () => {
      open(song(section('v1', 'Verse 1', line(chord(6, 7), 'a', chord(0), 'b'))));
      expect(parseFloat(chordEls()[1].style.paddingLeft)).toBeGreaterThan(0);

      // Words typed between the two chords part their names. Position 4 is just after the `a`: the section opens at
      // 0, its line at 1, the first chord is 2 and the `a` 3.
      sheet.run(state => ({ kind: 'edit', tr: state.tr.insertText('wide words ', 4) }));
      expect(chordEls()[1].style.paddingLeft).toBe('');
    });

    it('shows numerals in place of names, and back', () => {
      open(song(section('v1', 'Verse 1', line(chord(0), 'Got me ', chord(5), 'thinking'))));
      fixture.componentRef.setInput('numerals', true);
      fixture.detectChanges();
      expect(names()).toEqual(['I', 'vi']);

      fixture.componentRef.setInput('numerals', false);
      fixture.detectChanges();
      expect(names()).toEqual(['C', 'Am']);
    });

    it('re-spells every name when the key changes', () => {
      open(song(section('v1', 'Verse 1', line(chord(0), 'Got me ', chord(5), 'thinking'))));
      expect(sheet.run(transposeSong(keys, 1))).toBeTrue();
      expect(names()).toEqual(['Db', 'Bbm']);
    });

    it('selects the chord when its name is clicked', () => {
      open(song(section('v1', 'Verse 1', line('Got me ', chord(5), 'thinking'))));
      nameOf(chordEls()[0]).click();

      const selection = sheet.editorState()?.selection;
      expect(selection instanceof NodeSelection).toBeTrue();
      expect((selection as NodeSelection).node.type.name).toBe('chord');
      expect(chordEls()[0].classList).toContain('ProseMirror-selectednode');
    });
  });

  describe('section headers', () => {
    const toggles = (): HTMLButtonElement[] =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('.song-section-menu-toggle'));

    function choose(index: number, item: string): void {
      toggles()[index].click();
      const button = Array.from(
        host.querySelectorAll<HTMLButtonElement>('.song-section')[index].querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]'
        )
      ).find(candidate => candidate.textContent?.trim() === item);
      if (!button) throw new Error(`No ${item} in the menu`);
      button.click();
    }

    const labels = (): string[] => sectionsOf(current()).map(entry => entry.label);

    it('shows each section label in brackets, outside the editable text', () => {
      open(song(section('v1', 'Verse 1'), section('c1', 'Chorus')));
      const headers = Array.from(host.querySelectorAll<HTMLElement>('.song-section-header'));
      expect(headers.map(header => header.querySelector('.song-section-label')?.textContent?.replace(/\s+/g, '')))
        .toEqual(['[Verse1]', '[Chorus]']);
      expect(headers[0].getAttribute('contenteditable')).toBe('false');
    });

    it('shows the kind beside a label that does not say it', () => {
      open(song(songSchema.node('section', { id: 'b', label: 'Middle eight', kind: 'bridge' }, [line()])));
      expect(host.querySelector('.song-section-kind')?.textContent?.trim()).toBe('Bridge');
    });

    it('duplicates, moves and deletes a section from its menu', () => {
      open(song(section('v1', 'Verse 1', line('one')), section('c1', 'Chorus', line('two'))));

      choose(0, 'Duplicate');
      expect(labels()).toEqual(['Verse 1', 'Verse 2', 'Chorus']);
      choose(2, 'Move up');
      expect(labels()).toEqual(['Verse 1', 'Chorus', 'Verse 2']);
      choose(0, 'Move down');
      expect(labels()).toEqual(['Chorus', 'Verse 1', 'Verse 2']);
      choose(2, 'Delete');
      expect(labels()).toEqual(['Chorus', 'Verse 1']);
      expect(notices).toContain('Deleted Verse 2. Undo brings it back.');
      expect(changed.length).toBe(4);

      expect(sheet.undo()).toBeTrue();
      expect(labels()).toEqual(['Chorus', 'Verse 1', 'Verse 2']);
    });

    it('reports why a section command was refused', () => {
      open(song(section('v1', 'Verse 1')));
      choose(0, 'Delete');
      expect(refusals).toEqual(['A song keeps at least one section.']);
    });

    it('marks the menu items that cannot run, without hiding them', () => {
      open(song(section('v1', 'Verse 1'), section('c1', 'Chorus')));
      toggles()[0].click();
      const items = Array.from(host.querySelectorAll<HTMLElement>('.song-section')[0].querySelectorAll('[role="menuitem"]'));
      const disabled = items.filter(item => item.getAttribute('aria-disabled') === 'true').map(item => item.textContent?.trim());
      expect(disabled).toEqual(['Move up']);
    });

    it('renames a section in place, taking the kind from a section word', () => {
      open(song(section('v1', 'Verse 1')));
      choose(0, 'Rename');
      const field = host.querySelector<HTMLInputElement>('.song-section-rename');
      if (!field) throw new Error('No rename field');
      expect(document.activeElement).toBe(field);
      expect(field.value).toBe('Verse 1');

      field.value = 'Chorus';
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const [renamed] = sectionsOf(current());
      expect(renamed.label).toBe('Chorus');
      expect(renamed.kind).toBe('chorus');
      expect(document.activeElement).toBe(toggles()[0]);
    });

    it('keeps the kind for a name that is not a section word, and Escape keeps the name', () => {
      open(song(section('v1', 'Verse 1')));
      choose(0, 'Rename');
      const field = host.querySelector<HTMLInputElement>('.song-section-rename');
      if (!field) throw new Error('No rename field');
      field.value = 'Hook';
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(sectionsOf(current())[0].label).toBe('Verse 1');

      choose(0, 'Rename');
      field.value = 'Hook';
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(sectionsOf(current())[0]).toEqual(jasmine.objectContaining({ label: 'Hook', kind: 'verse' }));
    });

    it('is reachable by keyboard: arrows walk the menu and Escape closes it on its button', () => {
      open(song(section('v1', 'Verse 1'), section('c1', 'Chorus')));
      const toggle = toggles()[0];
      toggle.click();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      const menu = host.querySelector<HTMLElement>('.song-section [role="menu"]');
      if (!menu) throw new Error('No menu');
      expect(document.activeElement?.textContent?.trim()).toBe('Rename');

      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(document.activeElement?.textContent?.trim()).toBe('Move up');
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      expect(document.activeElement?.textContent?.trim()).toBe('Delete');

      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(toggle);
    });
  });

  describe('lyrics', () => {
    it('is a labelled, multi-line textbox in a monospace font', () => {
      open(song(section('v1', 'Verse 1')));
      const editor = host.querySelector<HTMLElement>('.ProseMirror');
      expect(editor?.getAttribute('role')).toBe('textbox');
      expect(editor?.getAttribute('aria-multiline')).toBe('true');
      expect(editor?.getAttribute('aria-label')).toBeTruthy();
      const line = host.querySelector<HTMLElement>('.song-lyric-line');
      if (!line) throw new Error('No line');
      expect(getComputedStyle(line).fontFamily).toMatch(/mono/i);
    });

    it('takes typing into the document and says so', async () => {
      open(song(section('v1', 'Verse 1', line('Got me'))));
      sheet.focus();
      document.execCommand('insertText', false, 'Oh ');
      await settled();

      expect(current().textContent).toBe('Oh Got me');
      expect(changed.length).toBeGreaterThan(0);
      expect(changed[changed.length - 1].textContent).toBe('Oh Got me');
    });

    it('shows the placeholder on the empty line holding the caret, and only there', () => {
      open(song(section('v1', 'Verse 1', line(), line('words'), line())));
      const lines = (): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>('.song-lyric-line'));
      expect(lines().map(el => el.classList.contains('is-placeholder'))).toEqual([true, false, false]);
      expect(lines()[0].getAttribute('data-placeholder')).toBe('Lyrics…');
    });
  });

  describe('commands', () => {
    it('runs a song command on its view and reports the history', () => {
      open(song(section('v1', 'Verse 1')));
      const history: { canUndo: boolean; canRedo: boolean }[] = [];
      sheet.historyChanged.subscribe(state => history.push(state));

      expect(sheet.run(setTempo(120))).toBeTrue();
      expect(songMetaOf(current()).tempo).toBe(120);
      expect(history[history.length - 1]).toEqual({ canUndo: true, canRedo: false });

      expect(sheet.undo()).toBeTrue();
      expect(songMetaOf(current()).tempo).toBe(100);
      expect(history[history.length - 1]).toEqual({ canUndo: false, canRedo: true });
      expect(sheet.redo()).toBeTrue();
      expect(songMetaOf(current()).tempo).toBe(120);
    });

    it('hands a refusal to its output and answers false', () => {
      open(song(section('v1', 'Verse 1')));
      expect(sheet.run(deleteSection('v1'))).toBeFalse();
      expect(refusals).toEqual(['A song keeps at least one section.']);
    });
  });
});
