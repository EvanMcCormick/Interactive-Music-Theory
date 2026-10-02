import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Node } from 'prosemirror-model';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { createExtensions } from '../../../models/progression-normalize';
import { ChordDegree, ProgressionKey } from '../../../models/progression.model';
import { MusicTheoryService } from '../../../services/music-theory.service';
import { ProgressionKeyContext } from '../../../services/progression-key-context';
import { deleteSection, setTempo, transposeSong } from '../../../services/song-commands';
import { chordSlotOf, sectionsOf, songMetaOf } from '../../../services/song-document';
import { songSchema } from '../../../services/song-schema';
import { spaceChordNames } from './chord-view';
import { ChordOpening, SongSheetComponent } from './song-sheet.component';

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
  let opened: ChordOpening[];

  const keys = new ProgressionKeyContext(new MusicTheoryService());

  /** Opens `doc` on a sheet `width` CSS pixels wide, or as wide as the test page, before its lines are first measured. */
  function open(doc: Node, width?: number): void {
    fixture = TestBed.createComponent(SongSheetComponent);
    sheet = fixture.componentInstance;
    host = fixture.nativeElement;
    if (width !== undefined) host.style.width = `${width}px`;
    fixture.componentRef.setInput('initialDoc', doc);
    fixture.componentRef.setInput('keys', keys);
    changed = [];
    refusals = [];
    notices = [];
    opened = [];
    sheet.docChanged.subscribe(next => changed.push(next));
    sheet.chordOpened.subscribe(opening => opened.push(opening));
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
  const editor = (): HTMLElement => {
    const found = host.querySelector<HTMLElement>('.ProseMirror');
    if (!found) throw new Error('No editor');
    return found;
  };
  /** Each lyric line as its words, with each chord written `*` where it sits. */
  const linesOf = (doc: Node): string[] => {
    const lines: string[] = [];
    doc.descendants(node => {
      if (node.type.name !== 'lyricLine') return true;
      let text = '';
      node.forEach(child => (text += child.isText ? child.text : '*'));
      lines.push(text);
      return false;
    });
    return lines;
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

  /**
   * A lyric line too long for the sheet wraps onto further rows, and the names have to stay apart and above their own
   * words on every row. These sheets are a fixed width, so the lines wrap where these specs expect; each spec first
   * checks that they do, so a font that changes where they wrap fails it plainly rather than passing for nothing.
   */
  describe('chord names on a line that wraps', () => {
    /** Wraps at 360px, with chords on the first row and on the rows after it. */
    const wrapping = (): Node =>
      line(
        chord(0),
        'Got me thinking bout that ',
        chord(3),
        'last dance and the ',
        chord(4),
        'way you ',
        chord(1, 7),
        'moved ',
        chord(2),
        'across the ',
        chord(5),
        'floor tonight'
      );
    /** Six chords at the end of a line, after its last word: at 300px their names need more room than the row has. */
    const piled = (): Node => line('Piled at the end ', chord(0), chord(1), chord(2), chord(3), chord(4), chord(5));

    const overlap = (a: DOMRect, b: DOMRect): boolean =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

    /** The box of every printed character on the sheet that is not part of a chord's name: words and headers. */
    function letterBoxes(): DOMRect[] {
      const boxes: DOMRect[] = [];
      const walker = document.createTreeWalker(editor(), NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest('.song-chord-name')) continue;
        const text = node.textContent ?? '';
        for (let at = 0; at < text.length; at++) {
          if (/\s/.test(text[at])) continue;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + 1);
          const box = range.getBoundingClientRect();
          if (box.width > 0) boxes.push(box);
        }
      }
      return boxes;
    }

    /** Every name that overlaps another name or a printed character, said as "Dm/Em" or "Am over 'h'". */
    function collisions(): string[] {
      const named = chordEls().map(el => ({ text: nameOf(el).textContent ?? '', box: nameOf(el).getBoundingClientRect() }));
      const letters = letterBoxes();
      const found: string[] = [];
      named.forEach((name, index) => {
        for (const other of named.slice(index + 1)) if (overlap(name.box, other.box)) found.push(`${name.text}/${other.text}`);
        if (letters.some(letter => overlap(name.box, letter))) found.push(`${name.text} over a letter`);
      });
      return found;
    }

    /** How many rows the chords sit on: their own boxes are the row of words they are in, letter or no letter after. */
    const chordRows = (): number => new Set(chordEls().map(el => Math.round(el.getBoundingClientRect().top))).size;

    /** Everything the measuring decides, as the padding it wrote and where each name ended up. */
    const layout = (): string[] =>
      chordEls().map(el => {
        const box = nameOf(el).getBoundingClientRect();
        return `${el.style.paddingLeft || '0'} @ ${box.left.toFixed(1)},${box.top.toFixed(1)}`;
      });

    /**
     * Waits for a resize to be measured: the sheet's `ResizeObserver` hears of it in the next frame, after this wait's
     * first frame callback, and measures in the frame after that, after its second - so it is done by the third.
     */
    const afterResize = (): Promise<void> =>
      new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      );

    it('keeps each name over its own letter on every row of a line that wraps', () => {
      open(song(section('v1', 'Verse 1', wrapping())), 360);
      expect(chordRows()).toBeGreaterThan(1);

      for (const el of chordEls()) {
        const name = nameOf(el).getBoundingClientRect();
        const letter = letterAfter(el);
        expect(Math.abs(name.left - letter.left)).withContext(nameOf(el).textContent ?? '').toBeLessThan(1);
        expect(name.bottom).toBeLessThanOrEqual(letter.top + 1);
      }
    });

    it('keeps every name below the row of words above its own', () => {
      open(song(section('v1', 'Verse 1', wrapping(), piled())), 360);
      expect(chordRows()).toBeGreaterThan(2);
      const letters = letterBoxes();

      for (const el of chordEls()) {
        const row = el.getBoundingClientRect();
        // The bottom of the nearest row of characters above this chord's row: its line's row before, or the line or
        // section header above it.
        const above = Math.max(...letters.filter(letter => letter.bottom <= row.top + 1).map(letter => letter.bottom));
        expect(nameOf(el).getBoundingClientRect().top)
          .withContext(nameOf(el).textContent ?? '')
          .toBeGreaterThanOrEqual(above - 0.5);
      }
      expect(collisions()).toEqual([]);
    });

    it('sets chords piled at the end of a line side by side, onto the next row when they run out of room', () => {
      open(song(section('v1', 'Verse 1', piled())), 300);
      expect(chordRows()).toBe(2);
      expect(collisions()).toEqual([]);
    });

    it('measures the same layout every time it measures', () => {
      open(song(section('v1', 'Verse 1', wrapping(), piled())), 300);
      const first = layout();

      spaceChordNames(editor());
      expect(layout()).toEqual(first);
      spaceChordNames(editor());
      expect(layout()).toEqual(first);
      expect(collisions()).toEqual([]);
    });

    it('keeps the names apart through a resize, and lays them out as before when the width comes back', async () => {
      open(song(section('v1', 'Verse 1', wrapping(), piled())), 900);
      const wide = layout();
      expect(collisions()).toEqual([]);

      host.style.width = '300px';
      await afterResize();
      expect(chordRows()).toBeGreaterThan(3);
      expect(collisions()).toEqual([]);

      host.style.width = '900px';
      await afterResize();
      expect(layout()).toEqual(wide);
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

    it('asks the page to open a section in the Progression page, changing nothing itself', () => {
      open(song(section('v1', 'Verse 1'), section('c1', 'Chorus')));
      const asked: string[] = [];
      sheet.progressionOpened.subscribe(id => asked.push(id));

      choose(1, 'Open in Progression');

      expect(asked).toEqual(['c1']);
      expect(changed).toEqual([]);
      expect(document.activeElement).toBe(toggles()[1]);
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

  describe('opening a chord', () => {
    it('asks for the chord popover when a name is clicked, saying where the name is', () => {
      const am = chord(5);
      open(song(section('v1', 'Verse 1', line('Got me ', am, 'thinking'))));
      const name = nameOf(chordEls()[0]);
      name.click();

      const rect = name.getBoundingClientRect();
      expect(opened).toEqual([{ id: am.attrs['id'], anchor: { left: rect.left, top: rect.top, bottom: rect.bottom } }]);
      expect(sheet.editorState()?.selection).toEqual(jasmine.any(NodeSelection));
    });

    it('asks for it on Enter with a chord selected, and changes nothing', () => {
      const am = chord(5);
      open(song(section('v1', 'Verse 1', line('Got me ', am, 'thinking'))));
      nameOf(chordEls()[0]).click();
      const before = current();

      editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

      expect(opened.map(opening => opening.id)).toEqual([am.attrs['id'], am.attrs['id']]);
      expect(current()).toBe(before);
    });
  });

  describe('placing a chord', () => {
    it('puts it where it is told, as one undo step, with the caret after it and the focus in the lyrics', () => {
      open(song(section('v1', 'Verse 1', line('Wondering where'))));
      // The section opens at 0, its line at 1, and "where" starts ten letters into the line's text at 2.
      expect(sheet.placeChord(12, chordSlotOf(degreeAt(3), C_MAJOR, IONIAN, FOUR_FOUR))).toBeTrue();

      expect(linesOf(current())).toEqual(['Wondering *where']);
      expect(sheet.editorState()?.selection.from).toBe(13);
      expect(document.activeElement).toBe(editor());

      expect(sheet.undo()).toBeTrue();
      expect(linesOf(current())).toEqual(['Wondering where']);
    });

    it('reports a position outside the lyrics as refused', () => {
      open(song(section('v1', 'Verse 1', line('Wondering'))));
      expect(sheet.placeChord(0, chordSlotOf(degreeAt(3), C_MAJOR, IONIAN, FOUR_FOUR))).toBeFalse();
      expect(refusals).toEqual(['Put the caret in a line of lyrics to add a chord there.']);
    });
  });

  describe('the caret and the selected chord, for the Chords panel', () => {
    /** Puts the caret at `pos`, as a click in the lyrics would. */
    function caretAt(pos: number): void {
      sheet.run(state => ({ kind: 'edit', tr: state.tr.setSelection(TextSelection.create(state.doc, pos)) }));
    }

    /** Something outside the sheet to take the focus, as a panel's button does when pressed. */
    function focusElsewhere(): HTMLButtonElement {
      const button = document.createElement('button');
      document.body.appendChild(button);
      button.focus();
      return button;
    }

    it('has no caret to offer until the lyrics have had the focus', () => {
      open(song(section('v1', 'Verse 1', line('Wondering where'))));
      expect(sheet.lastCaret()).toBeNull();

      sheet.focus();
      caretAt(7);
      expect(sheet.lastCaret()).toBe(7);
    });

    it('keeps the caret it had when the focus leaves the lyrics, and follows edits made from outside', () => {
      open(song(section('v1', 'Verse 1', line('Wondering where'))));
      sheet.focus();
      caretAt(12);
      const outside = focusElsewhere();

      expect(document.activeElement).toBe(outside);
      expect(sheet.lastCaret()).toBe(12);
      // Words put in before the caret move it on, as they move the caret itself.
      sheet.run(state => ({ kind: 'edit', tr: state.tr.insertText('Oh ', 2) }));
      expect(sheet.lastCaret()).toBe(15);
      outside.remove();
    });

    it('takes a click’s caret as the click ends, though the focus leaves before ProseMirror would hear of it', () => {
      open(song(section('v1', 'Verse 1', line('Wondering where'))));
      sheet.focus();
      caretAt(3);

      // A click on "where" puts the browser's caret there at once, and tells ProseMirror only on the next
      // `selectionchange` - which, when a panel button takes the focus first, finds the editor no longer focused.
      const text = host.querySelector('.song-lyric-line')?.firstChild;
      if (!text) throw new Error('No text');
      document.getSelection()?.collapse(text, 10);
      text.parentElement?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      const outside = focusElsewhere();

      expect(sheet.lastCaret()).toBe(12);
      outside.remove();
    });

    it('offers the start of a selection, where a chord placed on words goes', () => {
      open(song(section('v1', 'Verse 1', line('Wondering where'))));
      sheet.focus();
      sheet.run(state => ({ kind: 'edit', tr: state.tr.setSelection(TextSelection.create(state.doc, 12, 7)) }));
      expect(sheet.lastCaret()).toBe(7);
    });

    it('says which chord is selected each time that changes, and only then', () => {
      open(song(section('v1', 'Verse 1', line(chord(0), 'Got me ', chord(5), 'thinking'))));
      const seen: (string | null)[] = [];
      sheet.selectedChordChanged.subscribe(attrs => seen.push(attrs === null ? null : attrs.id));
      const am = current().nodeAt(10);
      if (!am) throw new Error('No Am');

      nameOf(chordEls()[1]).click();
      expect(seen).toEqual([am.attrs['id']]);
      expect(sheet.selectedChord()?.attrs.id).toBe(am.attrs['id']);

      // Re-keyed, it is a new chord to show, though the same atom stays selected.
      sheet.run(transposeSong(keys, 1));
      expect(seen.length).toBe(2);
      expect(seen[1]).toBe(am.attrs['id']);

      caretAt(5);
      sheet.run(state => ({ kind: 'edit', tr: state.tr.insertText('x', 5) }));
      expect(seen).toEqual([am.attrs['id'], am.attrs['id'], null]);
      expect(sheet.selectedChord()).toBeNull();
    });
  });

  describe('dragging a chord', () => {
    /** A pointer event as a mouse with its button held makes it. */
    function pointer(type: string, target: Element, x: number, y: number): void {
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true
        })
      );
    }

    /** Presses the name, moves it by (dx, dy) in two steps, and checks the drop caret on the way; then lets go. */
    function drag(name: HTMLElement, dx: number, dy: number, whileDragging: () => void = () => undefined): void {
      const home = name.getBoundingClientRect();
      const x = home.left + 2;
      const y = home.top + 2;
      pointer('pointerdown', name, x, y);
      pointer('pointermove', name, x + dx / 2, y + dy / 2);
      pointer('pointermove', name, x + dx, y + dy);
      whileDragging();
      pointer('pointerup', name, x + dx, y + dy);
    }

    /** The box of the character at `index` in the first text of the sheet containing `text`. */
    function letterIn(text: string, index: number): DOMRect {
      const walker = document.createTreeWalker(editor(), NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = (node.textContent ?? '').indexOf(text);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at + index);
        range.setEnd(node, at + index + 1);
        return range.getBoundingClientRect();
      }
      throw new Error(`No "${text}" on the sheet`);
    }

    it('moves a chord dropped over another letter there, keeping its id and length, and selects it', () => {
      const am = chord(5);
      open(song(section('v1', 'Verse 1', line(am, 'Wondering where the'))));
      const name = nameOf(chordEls()[0]);
      const target = letterIn('where', 0);

      drag(name, target.left - name.getBoundingClientRect().left, 0, () => {
        const caret = host.querySelector<HTMLElement>('.song-drop-caret');
        expect(caret?.hidden).toBeFalse();
        expect(Math.abs((caret?.getBoundingClientRect().left ?? -99) - target.left)).toBeLessThan(2);
      });

      expect(linesOf(current())).toEqual(['Wondering *where the']);
      const selection = sheet.editorState()?.selection;
      expect(selection instanceof NodeSelection && selection.node.attrs['id']).toBe(am.attrs['id']);
      expect(host.querySelector<HTMLElement>('.song-drop-caret')?.hidden).toBeTrue();
      expect(changed.length).toBe(1);
      expect(opened).toEqual([]);
    });

    it('moves a chord to a letter on another line', () => {
      open(song(section('v1', 'Verse 1', line(chord(5), 'Wondering'), line('where the'))));
      const name = nameOf(chordEls()[0]);
      const home = name.getBoundingClientRect();
      const target = letterIn('the', 0);

      drag(name, target.left - home.left, target.top - letterIn('Wondering', 0).top);

      expect(linesOf(current())).toEqual(['Wondering', 'where *the']);
    });

    it('refuses a drop outside the lines of lyrics, saying why, and leaves the chord where it was', () => {
      open(song(section('v1', 'Verse 1', line(chord(5), 'Wondering'))));
      const before = current();

      drag(nameOf(chordEls()[0]), 0, -2000);

      expect(current()).toBe(before);
      expect(refusals).toEqual(['A chord can only be dropped onto a line of lyrics.']);
      expect(host.querySelector<HTMLElement>('.song-drop-caret')?.hidden).toBeTrue();
    });

    it('takes a press that hardly moves for a click, which opens the chord', () => {
      const am = chord(5);
      open(song(section('v1', 'Verse 1', line(am, 'Wondering'))));
      const name = nameOf(chordEls()[0]);
      const before = current();

      drag(name, 2, 1);
      name.click();

      expect(current()).toBe(before);
      expect(opened.map(opening => opening.id)).toEqual([am.attrs['id']]);
    });

    it('does not open the chord on the click that ends a drag', () => {
      open(song(section('v1', 'Verse 1', line(chord(5), 'Wondering where'))));
      const name = nameOf(chordEls()[0]);

      drag(name, letterIn('where', 0).left - name.getBoundingClientRect().left, 0);
      name.click();

      expect(opened).toEqual([]);
    });

    it('keeps a press on the name from ProseMirror, and never lets the browser start its own drag of the chord', () => {
      open(song(section('v1', 'Verse 1', line(chord(5), 'Wondering'))));
      const name = nameOf(chordEls()[0]);
      const box = name.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, button: 0, clientX: box.left + 2, clientY: box.top + 2 };
      const before = current();

      const down = new MouseEvent('mousedown', at);
      name.dispatchEvent(down);
      const start = new DragEvent('dragstart', { ...at, dataTransfer: new DataTransfer() });
      name.dispatchEvent(start);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));

      expect(down.defaultPrevented).toBeTrue();
      expect(start.defaultPrevented).toBeTrue();
      // ProseMirror, had it seen the drag start, would have written the chord into the drag's data to move it.
      expect(start.dataTransfer?.types).toEqual([]);
      expect(current()).toBe(before);
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
