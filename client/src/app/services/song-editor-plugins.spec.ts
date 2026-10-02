import { Node } from 'prosemirror-model';
import { redoDepth, undoDepth } from 'prosemirror-history';
import { AllSelection, EditorState, NodeSelection, Selection, TextSelection, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { createExtensions } from '../models/progression-normalize';
import { ProgressionKey } from '../models/progression.model';
import { SongMeta } from '../models/song.model';
import { chordWithId, commandOf, insertChord, setTitle } from './song-commands';
import { MusicTheoryService } from './music-theory.service';
import { ProgressionKeyContext } from './progression-key-context';
import { chordSlotOf, chordsOf, sectionsOf } from './song-document';
import {
  ChordFieldRequest,
  SongEditorOptions,
  requestChordField,
  sectionHeadingOf,
  songEditorPlugins
} from './song-editor-plugins';
import { songSchema } from './song-schema';

/**
 * The sheet's plugin list: history, ids, keys, the `[Chorus]` rule and the
 * chord field's hook.
 *
 * Keys and typed text go through a real `EditorView` on a detached element,
 * because that is where ProseMirror routes them (`handleKeyDown`,
 * `handleTextInput`); nothing is attached to the page but the caret motions'
 * views, which go through ProseMirror's whole key handling (see there), and
 * every view is destroyed after its spec. History grouping is asked of a bare
 * state, as the view would apply the same transactions.
 */
const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const FOUR_FOUR = { numerator: 4, denominator: 4, isCommon: true };
const META: SongMeta = { title: 'Last Dance', artist: '', key: C_MAJOR, tempo: 100, timeSignature: FOUR_FOUR };
const MAC = /Mac|iP(hone|[oa]d)/.test(navigator.platform);

function chord(degree: number): Node {
  return songSchema.node(
    'chord',
    chordSlotOf(
      {
        degree,
        alter: 0,
        extent: 3,
        quality: null,
        inversion: 0,
        suspension: 'none',
        extensions: createExtensions(),
        octave: 0
      },
      C_MAJOR,
      [0, 2, 4, 5, 7, 9, 11],
      FOUR_FOUR
    )
  );
}

function line(...content: (string | Node)[]): Node {
  return songSchema.node(
    'lyricLine',
    null,
    content.map(part => (typeof part === 'string' ? songSchema.text(part) : part))
  );
}

function section(id: string, label: string, ...lines: Node[]): Node {
  return songSchema.node('section', { id, label, kind: 'verse' }, lines);
}

function song(...sections: Node[]): Node {
  return songSchema.node('doc', META, sections);
}

/** The position just before the first `text` in the document. */
function before(doc: Node, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    const at = node.isText && found < 0 ? (node.text ?? '').indexOf(text) : -1;
    if (at >= 0) found = pos + at;
  });
  if (found < 0) throw new Error(`no "${text}" in the document`);
  return found;
}

/** Each section as its label, kind and lines, chords written `*`. */
function outlineOf(doc: Node): string[] {
  return sectionsOf(doc).map(entry => {
    const lines: string[] = [];
    entry.node.forEach(child => {
      let text = '';
      child.forEach(inline => (text += inline.isText ? inline.text : '*'));
      lines.push(text);
    });
    return `${entry.label} (${entry.kind}): ${lines.join(' / ')}`;
  });
}

describe('songEditorPlugins', () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
  });

  function viewOf(doc: Node, selection?: (doc: Node) => Selection, options: SongEditorOptions = {}): EditorView {
    const state = EditorState.create({ doc, selection: selection?.(doc), plugins: songEditorPlugins(options) });
    view = new EditorView(document.createElement('div'), { state });
    return view;
  }

  function caret(pos: number): (doc: Node) => Selection {
    return doc => TextSelection.create(doc, pos);
  }

  /** Presses a key as the browser would report it; answers whether the editor took it. */
  function press(target: EditorView, key: string, modifiers: { mod?: boolean; shift?: boolean; alt?: boolean } = {}): boolean {
    const event = new KeyboardEvent('keydown', {
      key,
      // The keymap falls back to the key code for a shifted letter.
      keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
      shiftKey: modifiers.shift ?? false,
      altKey: modifiers.alt ?? false,
      ctrlKey: (modifiers.mod ?? false) && !MAC,
      metaKey: (modifiers.mod ?? false) && MAC
    });
    return target.someProp('handleKeyDown', handle => handle(target, event)) ?? false;
  }

  /** Types `text` one character at a time, as input events would: plugins first, else inserted. */
  function type(target: EditorView, text: string): void {
    for (const character of text) {
      const { from, to } = target.state.selection;
      const typed = (): Transaction => target.state.tr.insertText(character, from, to);
      const handled = target.someProp('handleTextInput', handle => handle(target, from, to, character, typed));
      if (!handled) target.dispatch(typed());
    }
  }

  describe('history', () => {
    const doc = song(section('s1', 'Verse 1', line('one')));

    function stateOf(): EditorState {
      return EditorState.create({ doc, selection: TextSelection.create(doc, 5), plugins: songEditorPlugins() });
    }

    it('groups typing as ProseMirror does: a run of adjacent letters is one step', () => {
      let state = stateOf();
      state = state.apply(state.tr.insertText('a'));
      state = state.apply(state.tr.insertText('b'));

      expect(undoDepth(state)).toBe(1);
    });

    it('keeps a command its own step, apart from the typing before it and after it', () => {
      let state = stateOf();
      state = state.apply(state.tr.insertText('a'));
      const command = insertChord(chordSlotOf(
        { degree: 0, alter: 0, extent: 3, quality: null, inversion: 0, suspension: 'none', extensions: createExtensions(), octave: 0 },
        C_MAJOR, [0, 2, 4, 5, 7, 9, 11], FOUR_FOUR
      ))(state);
      if (command.kind !== 'edit') throw new Error('expected the chord to go in');
      state = state.apply(command.tr);
      state = state.apply(state.tr.insertText('b'));

      expect(undoDepth(state)).toBe(3);
    });

    it('keeps two commands in a row two steps', () => {
      let state = stateOf();
      for (const title of ['First', 'Second']) {
        commandOf(setTitle(title))(state, tr => (state = state.apply(tr)));
      }

      expect(undoDepth(state)).toBe(2);
    });

    it('gives a section the editor splits an id in the same step', () => {
      let state = stateOf();
      state = state.apply(state.tr.split(5, 2));

      expect(sectionsOf(state.doc).map(entry => entry.id)).toEqual(['s1', jasmine.stringMatching(/^[0-9a-f-]{36}$/)]);
      expect(undoDepth(state)).toBe(1);
    });
  });

  describe('undo and redo keys', () => {
    it('undo with Mod-z, redo with Mod-y and Mod-Shift-z', () => {
      const editor = viewOf(song(section('s1', 'Verse 1', line('one'))), caret(5));
      type(editor, 'x');

      expect(press(editor, 'z', { mod: true })).toBeTrue();
      expect(editor.state.doc.textContent).toBe('one');
      expect(press(editor, 'y', { mod: true })).toBeTrue();
      expect(editor.state.doc.textContent).toBe('onex');
      press(editor, 'z', { mod: true });
      expect(press(editor, 'Z', { mod: true, shift: true })).toBeTrue();
      expect(editor.state.doc.textContent).toBe('onex');
      expect(redoDepth(editor.state)).toBe(0);
    });
  });

  describe('Enter', () => {
    it('splits a lyric line at the caret, inside its section', () => {
      const doc = song(section('s1', 'Verse 1', line('one two')));
      const editor = viewOf(doc, caret(before(doc, ' two')));

      expect(press(editor, 'Enter')).toBeTrue();
      expect(outlineOf(editor.state.doc)).toEqual(['Verse 1 (verse): one /  two']);
    });

    it('adds a line on an empty line in the middle of a section, rather than splitting the section', () => {
      const doc = song(section('s1', 'Verse 1', line('one'), line(), line('three')));
      const editor = viewOf(doc, caret(before(doc, 'three') - 2));

      press(editor, 'Enter');

      expect(outlineOf(editor.state.doc)).toEqual(['Verse 1 (verse): one /  /  / three']);
    });

    it('splits after a selected chord, keeping it', () => {
      const am = chord(5);
      const doc = song(section('s1', 'Verse 1', line('one ', am, 'two')));
      const pos = chordWithId(doc, am.attrs['id'])?.pos ?? -1;
      const editor = viewOf(doc, d => NodeSelection.create(d, pos));

      press(editor, 'Enter');

      expect(outlineOf(editor.state.doc)).toEqual(['Verse 1 (verse): one * / two']);
    });

    it('opens a selected chord instead, when the sheet listens for it, and changes nothing', () => {
      const am = chord(5);
      const doc = song(section('s1', 'Verse 1', line('one ', am, 'two')));
      const pos = chordWithId(doc, am.attrs['id'])?.pos ?? -1;
      const opened: string[] = [];
      const editor = viewOf(doc, d => NodeSelection.create(d, pos), {
        onChordOpen: chordAt => opened.push(`${chordAt.attrs.id}@${chordAt.pos}`)
      });

      expect(press(editor, 'Enter')).toBeTrue();

      expect(opened).toEqual([`${am.attrs['id']}@${pos}`]);
      expect(editor.state.doc.eq(doc)).toBeTrue();
      expect(editor.state.selection).toEqual(jasmine.any(NodeSelection));
    });

    it('still splits after a selected chord on Shift-Enter, and splits a caret as before, when the sheet listens', () => {
      const am = chord(5);
      const doc = song(section('s1', 'Verse 1', line('one ', am, 'two')));
      const pos = chordWithId(doc, am.attrs['id'])?.pos ?? -1;
      const open = jasmine.createSpy('open');
      const selected = viewOf(doc, d => NodeSelection.create(d, pos), { onChordOpen: open });

      press(selected, 'Enter', { shift: true });
      expect(outlineOf(selected.state.doc)).toEqual(['Verse 1 (verse): one * / two']);
      selected.destroy();

      const atCaret = viewOf(doc, caret(3), { onChordOpen: open });
      press(atCaret, 'Enter');
      expect(outlineOf(atCaret.state.doc)).toEqual(['Verse 1 (verse): o / ne *two']);
      expect(open).not.toHaveBeenCalled();
    });

    it('is what Shift-Enter does too: a line break is a new lyric line', () => {
      const doc = song(section('s1', 'Verse 1', line('one two')));
      const editor = viewOf(doc, caret(before(doc, ' two')));

      expect(press(editor, 'Enter', { shift: true })).toBeTrue();
      expect(outlineOf(editor.state.doc)).toEqual(['Verse 1 (verse): one /  two']);
    });
  });

  describe('Backspace and Delete', () => {
    const doc = song(section('s1', 'Verse 1', line('one'), line('two')), section('s2', 'Chorus', line('three')));

    it('join two lines of a section', () => {
      const back = viewOf(doc, caret(before(doc, 'two')));
      press(back, 'Backspace');
      expect(outlineOf(back.state.doc)[0]).toBe('Verse 1 (verse): onetwo');
      back.destroy();

      const forward = viewOf(doc, caret(before(doc, 'one') + 3));
      press(forward, 'Delete');
      expect(outlineOf(forward.state.doc)[0]).toBe('Verse 1 (verse): onetwo');
    });

    it('stop at a section boundary, and take the key so the browser cannot join across it', () => {
      const back = viewOf(doc, caret(before(doc, 'three')));
      expect(press(back, 'Backspace')).toBeTrue();
      expect(back.state.doc.eq(doc)).toBeTrue();
      back.destroy();

      const forward = viewOf(doc, caret(before(doc, 'two') + 3));
      expect(press(forward, 'Delete')).toBeTrue();
      expect(forward.state.doc.eq(doc)).toBeTrue();
    });
  });

  describe('arrow keys over a chord', () => {
    const a = chord(5);
    const b = chord(3);
    const doc = song(section('s1', 'Verse 1', line('one'), line(a, 'W', b, 'or')));

    it('step past the chord and the letter under it in one press, as if the chord took no width', () => {
      const right = viewOf(doc, caret(before(doc, 'W') - 1));
      expect(press(right, 'ArrowRight')).toBeTrue();
      expect(right.state.selection.head).toBe(before(doc, 'W') + 1);
      right.destroy();

      const left = viewOf(doc, caret(before(doc, 'or')));
      expect(press(left, 'ArrowLeft')).toBeTrue();
      expect(left.state.selection.head).toBe(before(doc, 'W'));
      expect(left.state.selection).toEqual(jasmine.any(TextSelection));
    });

    it('go on to the line before when only chords are left, rather than sticking', () => {
      const editor = viewOf(doc, caret(before(doc, 'W')));

      press(editor, 'ArrowLeft');

      expect(editor.state.selection.head).toBe(before(doc, 'one') + 3);
    });

    it('leave a caret with no chord beside it to the browser', () => {
      const editor = viewOf(doc, caret(before(doc, 'one') + 1));

      expect(press(editor, 'ArrowRight')).toBeFalse();
    });
  });

  describe('Alt-arrows', () => {
    const a = chord(5);
    const id: string = a.attrs['id'];
    const doc = song(section('s1', 'Verse 1', line(a, 'Wo')));
    const selected = (d: Node): Selection => NodeSelection.create(d, chordWithId(d, id)?.pos ?? -1);

    it('move a selected chord a letter, and keep it selected', () => {
      const editor = viewOf(doc, selected);

      expect(press(editor, 'ArrowRight', { alt: true })).toBeTrue();
      expect(press(editor, 'ArrowRight', { alt: true })).toBeTrue();

      expect(outlineOf(editor.state.doc)).toEqual(['Verse 1 (verse): Wo*']);
      expect(editor.state.selection).toEqual(jasmine.any(NodeSelection));
    });

    it('take the key at an edge and say why the chord did not move', () => {
      const refusals: string[] = [];
      const editor = viewOf(doc, selected, { onRefuse: reason => refusals.push(reason) });

      expect(press(editor, 'ArrowLeft', { alt: true })).toBeTrue();
      expect(editor.state.doc.eq(doc)).toBeTrue();
      expect(refusals).toEqual([jasmine.stringMatching(/start of its line/)]);
    });

    it('leave the keys alone when no chord is selected', () => {
      const editor = viewOf(doc, caret(3));

      expect(press(editor, 'ArrowRight', { alt: true })).toBeFalse();
    });
  });

  /**
   * Every other way a caret moves, beside chords: word jumps, Shift, Home and End, up and down.
   *
   * These go through ProseMirror's *whole* key handling, not just the plugins' `handleKeyDown`: a keydown event is
   * dispatched on the editor, so the view's own arrow handling runs after the plugins, as it does in the browser - and
   * that is where a chord was being selected. The view is attached to the page, as the sheet's is. A synthetic event
   * makes no native motion, so a key that is not taken (`preventDefault`) leaves the editor's selection where the
   * plugins put it, and the browser's own motion is what would happen next.
   */
  describe('caret motions beside a chord', () => {
    const KEY_CODES: Record<string, number> = {
      ArrowLeft: 37,
      ArrowUp: 38,
      ArrowRight: 39,
      ArrowDown: 40,
      Home: 36,
      End: 35,
      Delete: 46
    };

    interface Held {
      ctrl?: boolean;
      alt?: boolean;
      shift?: boolean;
      /** Ctrl, or Cmd on a Mac. */
      mod?: boolean;
    }

    const c = chord(0);
    const f = chord(3);
    const g = chord(4);
    // A chord at the start of the line, one mid-line, one after its last word.
    const doc = song(section('s1', 'Verse 1', line('one'), line(c, 'Wondering ', f, 'where', g)));
    const lineStart = before(doc, 'Wondering') - 1;
    const where = before(doc, 'where');
    const lineEnd = where + 'where'.length + 1;

    function attachedViewOf(start: Node, selection: (d: Node) => Selection): EditorView {
      const mount = document.body.appendChild(document.createElement('div'));
      view = new EditorView(mount, { state: EditorState.create({ doc: start, selection: selection(start), plugins: songEditorPlugins() }) });
      return view;
    }

    afterEach(() => view?.dom.parentElement?.remove());

    /** Sends a keydown through ProseMirror's whole key handling (see above); answers whether the key was taken. */
    function keydown(target: EditorView, key: string, held: Held = {}): boolean {
      const event = new KeyboardEvent('keydown', {
        key,
        keyCode: KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0),
        ctrlKey: (held.ctrl ?? false) || ((held.mod ?? false) && !MAC),
        metaKey: (held.mod ?? false) && MAC,
        altKey: held.alt ?? false,
        shiftKey: held.shift ?? false,
        bubbles: true,
        cancelable: true
      });
      target.dom.dispatchEvent(event);
      return event.defaultPrevented;
    }

    function textSelection(target: EditorView): { anchor: number; head: number } | string {
      const selection = target.state.selection;
      return selection instanceof TextSelection ? { anchor: selection.anchor, head: selection.head } : selection.toJSON()['type'];
    }

    // Ctrl is the word jump on Windows and Linux, Alt (Option) on a Mac.
    const WORD_JUMPS: readonly Held[] = [{ ctrl: true }, { alt: true }];

    it('take a word jump past the chords beside the caret, and leave the jump itself to the browser', () => {
      const jumps: [string, number, number][] = [
        ['ArrowRight', lineStart, lineStart + 1],
        ['ArrowRight', where - 1, where],
        ['ArrowLeft', where, where - 1]
      ];
      for (const held of WORD_JUMPS) {
        for (const [key, from, to] of jumps) {
          const editor = attachedViewOf(doc, caret(from));
          const context = `${JSON.stringify(held)} ${key} from ${from}`;

          expect(keydown(editor, key, held)).withContext(context).toBeFalse();
          expect(textSelection(editor)).withContext(context).toEqual({ anchor: to, head: to });
          editor.dom.parentElement?.remove();
          editor.destroy();
        }
      }
    });

    it('never select the chord on the way, so a second Alt+arrow cannot move it', () => {
      const editor = attachedViewOf(doc, caret(lineStart));

      keydown(editor, 'ArrowRight', { alt: true });
      keydown(editor, 'ArrowRight', { alt: true });

      expect(editor.state.doc.eq(doc)).toBeTrue();
    });

    it('pass every chord piled on one letter in one press', () => {
      const piled = song(section('s1', 'Verse 1', line(c, f, 'Wo')));
      const editor = attachedViewOf(piled, caret(2));

      expect(keydown(editor, 'ArrowRight', { ctrl: true })).toBeFalse();
      expect(textSelection(editor)).toEqual({ anchor: 4, head: 4 });
    });

    it('pass the chords after a line\'s last word, leaving the browser to go on to the next line', () => {
      const editor = attachedViewOf(doc, caret(lineEnd - 1));

      expect(keydown(editor, 'ArrowRight', { ctrl: true })).toBeFalse();
      expect(textSelection(editor)).toEqual({ anchor: lineEnd, head: lineEnd });
    });

    it('extend a Shift selection over the chords beside its head, keeping its anchor, for the browser to extend on', () => {
      const extensions: [Held, string, { anchor: number; head: number }, number][] = [
        [{ shift: true }, 'ArrowRight', { anchor: lineStart, head: lineStart }, lineStart + 1],
        [{ shift: true }, 'ArrowLeft', { anchor: where + 3, head: where }, where - 1],
        [{ shift: true, ctrl: true }, 'ArrowRight', { anchor: where - 3, head: where - 1 }, where],
        [{ shift: true, alt: true }, 'ArrowLeft', { anchor: where + 3, head: where }, where - 1]
      ];
      for (const [held, key, { anchor, head }, to] of extensions) {
        const editor = attachedViewOf(doc, d => TextSelection.create(d, anchor, head));
        const context = `${JSON.stringify(held)} ${key} from ${anchor}-${head}`;

        expect(keydown(editor, key, held)).withContext(context).toBeFalse();
        expect(textSelection(editor)).withContext(context).toEqual({ anchor, head: to });
        editor.dom.parentElement?.remove();
        editor.destroy();
      }
    });

    it('leave a selected chord\'s Alt+arrows to the chord, and a word jump with no chord beside it untouched', () => {
      const selected = attachedViewOf(doc, d => NodeSelection.create(d, where - 1));
      expect(keydown(selected, 'ArrowRight', { alt: true })).toBeTrue();
      expect(outlineOf(selected.state.doc)).toEqual(['Verse 1 (verse): one / *Wondering w*here*']);
      selected.dom.parentElement?.remove();
      selected.destroy();

      const midWord = attachedViewOf(doc, caret(lineStart + 4));
      expect(keydown(midWord, 'ArrowRight', { ctrl: true })).toBeFalse();
      expect(textSelection(midWord)).toEqual({ anchor: lineStart + 4, head: lineStart + 4 });
    });

    it('leave Home, End, up and down to the browser, beside a chord or not', () => {
      for (const key of ['Home', 'End', 'ArrowUp', 'ArrowDown']) {
        for (const held of [{}, { shift: true }]) {
          for (const at of [lineStart, where - 1, where, lineEnd - 1]) {
            const editor = attachedViewOf(doc, caret(at));
            const context = `${JSON.stringify(held)} ${key} from ${at}`;

            expect(keydown(editor, key, held)).withContext(context).toBeFalse();
            expect(textSelection(editor)).withContext(context).toEqual({ anchor: at, head: at });
            editor.dom.parentElement?.remove();
            editor.destroy();
          }
        }
      }
    });

    it('delete a chord with a selection across it, as the letter under it goes too', () => {
      const editor = attachedViewOf(doc, d => TextSelection.create(d, where - 2, where + 1));

      expect(keydown(editor, 'Delete')).toBeTrue();

      expect(outlineOf(editor.state.doc)).toEqual(['Verse 1 (verse): one / *Wonderinghere*']);
    });

    it('make select all and a typed letter one fresh section holding the letter', () => {
      const twoSections = song(
        section('s1', 'Verse 1', line(c, 'one')),
        section('s2', 'Chorus', line('two ', f, 'three'))
      );
      const editor = attachedViewOf(twoSections, caret(3));

      expect(keydown(editor, 'a', { mod: true })).toBeTrue();
      expect(editor.state.selection).toEqual(jasmine.any(AllSelection));
      // A letter typed over a selection that is not text in one line is ProseMirror's to insert, on keypress.
      const typed = new KeyboardEvent('keypress', { key: 'x', charCode: 'x'.charCodeAt(0), bubbles: true, cancelable: true });
      editor.dom.dispatchEvent(typed);

      const result = editor.state.doc;
      expect(() => result.check()).not.toThrow();
      expect(sectionsOf(result).map(entry => entry.id)).toEqual([jasmine.stringMatching(/^[0-9a-f-]{36}$/)]);
      expect(outlineOf(result)).toEqual(['Verse 1 (verse): x']);
      expect(textSelection(editor)).toEqual({ anchor: 3, head: 3 });
    });
  });

  describe('the [Section] input rule', () => {
    const doc = song(section('s1', 'Verse 1', line('one'), line()));
    const atEnd = (d: Node): Selection => Selection.atEnd(d);

    it('turns an empty line into a new section from that line on, with the caret in it', () => {
      const editor = viewOf(doc, atEnd);

      type(editor, '[Chorus]');

      expect(outlineOf(editor.state.doc)).toEqual(['Verse 1 (verse): one', 'Chorus (chorus): ']);
      expect(sectionsOf(editor.state.doc)[1].id).toMatch(/^[0-9a-f-]{36}$/);
      expect(editor.state.selection.$head.index(0)).toBe(1);
    });

    it('takes the lines after the typed one into the new section', () => {
      const middle = song(section('s1', 'Verse 1', line('one'), line(), line('two')));
      const editor = viewOf(middle, caret(before(middle, 'two') - 2));

      type(editor, '[Bridge]');

      expect(outlineOf(editor.state.doc)).toEqual(['Verse 1 (verse): one', 'Bridge (bridge):  / two']);
    });

    it('renames the section in place when typed on its first line, keeping its id', () => {
      const fresh = song(section('s1', 'Verse 1', line(), line('one')));
      const editor = viewOf(fresh, caret(2));

      type(editor, '[Intro]');

      expect(outlineOf(editor.state.doc)).toEqual(['Intro (intro):  / one']);
      expect(sectionsOf(editor.state.doc)[0].id).toBe('s1');
    });

    it('leaves the brackets as words on a line that has anything else on it', () => {
      const editor = viewOf(doc, caret(5));

      type(editor, ' [Chorus]');

      expect(outlineOf(editor.state.doc)).toEqual(['Verse 1 (verse): one [Chorus] / ']);
    });

    it('is one undo step, which leaves the heading as it was typed but for its bracket', () => {
      const editor = viewOf(doc, atEnd);
      type(editor, '[Chorus]');
      expect(sectionsOf(editor.state.doc).length).toBe(2);

      press(editor, 'z', { mod: true });

      expect(outlineOf(editor.state.doc)).toEqual(['Verse 1 (verse): one / [Chorus']);
    });

    it('gives the heading back as typed on a Backspace straight after', () => {
      const editor = viewOf(doc, atEnd);
      type(editor, '[Chorus]');
      expect(sectionsOf(editor.state.doc).length).toBe(2);

      press(editor, 'Backspace');

      expect(outlineOf(editor.state.doc)).toEqual(['Verse 1 (verse): one / [Chorus]']);
    });
  });

  describe('the [Chord] input rule', () => {
    const keys = new ProgressionKeyContext(new MusicTheoryService());
    const doc = song(section('s1', 'Verse 1', line('one'), line()));
    const atEnd = (d: Node): Selection => Selection.atEnd(d);
    const withKeys: SongEditorOptions = { keys };

    /** The chords in the document, in order, each as its degree (0-6) and length. */
    function chordsIn(d: Node): { degree: number | null; lengthBeats: number }[] {
      const found: { degree: number | null; lengthBeats: number }[] = [];
      d.descendants(node => {
        if (node.type.name !== 'chord') return true;
        const harmony = node.attrs['harmony'];
        found.push({ degree: harmony.kind === 'degree' ? harmony.degree.degree : null, lengthBeats: node.attrs['lengthBeats'] });
        return false;
      });
      return found;
    }

    it('places a chord at the start of an empty line, ChordPro style, with the caret after it', () => {
      const editor = viewOf(doc, atEnd, withKeys);

      type(editor, '[Am]');

      expect(outlineOf(editor.state.doc)).toEqual(['Verse 1 (verse): one / *']);
      expect(chordsIn(editor.state.doc)).toEqual([{ degree: 5, lengthBeats: 4 }]);
      const [verse] = sectionsOf(editor.state.doc);
      const [placed] = chordsOf(verse.node, verse.pos);
      expect(editor.state.selection.empty).toBeTrue();
      expect(editor.state.selection.from).toBe(placed.pos + 1);
    });

    it('reads numerals and names outside the key, in the song\'s key, a bar of its meter long', () => {
      const aMinor = { tonic: 9, scaleId: 'aeolian', preferSharps: true };
      const threeFour = { numerator: 3, denominator: 4, isCommon: false };
      const waltz = songSchema.node('doc', { ...META, key: aMinor, timeSignature: threeFour }, [
        section('s1', 'Verse 1', line())
      ]);
      const editor = viewOf(waltz, atEnd, withKeys);

      type(editor, '[VII]words');
      press(editor, 'Enter');
      type(editor, '[Bb]');

      // In A aeolian, VII is G (degree 6) and Bb is the flat second (degree 1).
      expect(chordsIn(editor.state.doc)).toEqual([
        { degree: 6, lengthBeats: 3 },
        { degree: 1, lengthBeats: 3 }
      ]);
    });

    it('still makes a section of a word that is not a chord: [Chorus], and [Amen], which only starts like one', () => {
      const chorus = viewOf(doc, atEnd, withKeys);
      type(chorus, '[Chorus]');
      expect(outlineOf(chorus.state.doc)).toEqual(['Verse 1 (verse): one', 'Chorus (chorus): ']);
      chorus.destroy();

      const amen = viewOf(doc, atEnd, withKeys);
      type(amen, '[Amen]');
      expect(outlineOf(amen.state.doc)).toEqual(['Verse 1 (verse): one', 'Amen (other): ']);
      expect(chordsIn(amen.state.doc)).toEqual([]);
    });

    it('reads every section word as a section, never a chord', () => {
      for (const word of ['Intro', 'Verse', 'Verse 2', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro']) {
        const editor = viewOf(doc, atEnd, withKeys);
        type(editor, `[${word}]`);
        expect(sectionsOf(editor.state.doc).map(entry => entry.label)).withContext(word).toEqual(['Verse 1', word]);
        editor.destroy();
        view = null;
      }
    });

    it('makes a section of [Am] when the sheet gives no key rules to read chords by', () => {
      const editor = viewOf(doc, atEnd);
      type(editor, '[Am]');
      expect(outlineOf(editor.state.doc)).toEqual(['Verse 1 (verse): one', 'Am (other): ']);
    });

    it('is one undo step, which leaves the text as it was typed but for its bracket', () => {
      const editor = viewOf(doc, atEnd, withKeys);
      type(editor, '[Am]');

      press(editor, 'z', { mod: true });

      expect(outlineOf(editor.state.doc)).toEqual(['Verse 1 (verse): one / [Am']);
      expect(chordsIn(editor.state.doc)).toEqual([]);
    });

    it('gives the text back as typed on a Backspace straight after', () => {
      const editor = viewOf(doc, atEnd, withKeys);
      type(editor, '[Am]');

      press(editor, 'Backspace');

      expect(outlineOf(editor.state.doc)).toEqual(['Verse 1 (verse): one / [Am]']);
    });

    it('lets the typing go on into the line: [Am]Wondering is a chord over the W', () => {
      const editor = viewOf(doc, atEnd, withKeys);
      type(editor, '[Am]Wondering');
      expect(outlineOf(editor.state.doc)).toEqual(['Verse 1 (verse): one / *Wondering']);
    });
  });

  describe('sectionHeadingOf', () => {
    it('reads the six section words, in any case, with an optional number, as their kinds', () => {
      expect(sectionHeadingOf('Intro')).toEqual({ kind: 'intro', label: 'Intro' });
      expect(sectionHeadingOf('Verse 2')).toEqual({ kind: 'verse', label: 'Verse 2' });
      expect(sectionHeadingOf('pre-chorus')).toEqual({ kind: 'pre', label: 'pre-chorus' });
      expect(sectionHeadingOf('Pre Chorus')).toEqual({ kind: 'pre', label: 'Pre Chorus' });
      expect(sectionHeadingOf(' CHORUS ')).toEqual({ kind: 'chorus', label: 'CHORUS' });
      expect(sectionHeadingOf('Bridge')).toEqual({ kind: 'bridge', label: 'Bridge' });
      expect(sectionHeadingOf('Outro3')).toEqual({ kind: 'outro', label: 'Outro3' });
    });

    it('reads any other name as a section of kind other, and nothing as no heading', () => {
      expect(sectionHeadingOf('Middle eight')).toEqual({ kind: 'other', label: 'Middle eight' });
      expect(sectionHeadingOf('Verses')).toEqual({ kind: 'other', label: 'Verses' });
      expect(sectionHeadingOf('   ')).toBeNull();
    });
  });

  describe('the chord field', () => {
    const doc = song(section('s1', 'Verse 1', line('Wondering'), line()));
    const coords = { left: 10, right: 10, top: 20, bottom: 36 };
    const fakeView = { coordsAtPos: () => coords };

    function stateAt(pos: number): EditorState {
      return EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
    }

    it('is asked for on a line with words, at the caret, with where the caret is on screen', () => {
      const requests: ChordFieldRequest[] = [];

      expect(requestChordField(stateAt(5), fakeView, request => requests.push(request))).toBeTrue();
      expect(requests).toEqual([{ pos: 5, coords: { left: 10, top: 20, bottom: 36 } }]);
    });

    it('is asked for without coordinates when there is no view to measure', () => {
      const requests: ChordFieldRequest[] = [];
      requestChordField(stateAt(5), undefined, request => requests.push(request));

      expect(requests).toEqual([{ pos: 5, coords: null }]);
    });

    it('is not asked for on an empty line, where [ starts a section heading instead', () => {
      const request = jasmine.createSpy('request');

      expect(requestChordField(stateAt(doc.content.size - 2), fakeView, request)).toBeFalse();
      expect(request).not.toHaveBeenCalled();
    });

    it('opens on [ typed into a line with words, and the [ is not typed', () => {
      const requests: ChordFieldRequest[] = [];
      const editor = viewOf(doc, caret(5), { onChordFieldRequest: request => requests.push(request) });

      type(editor, '[');

      expect(requests.map(request => request.pos)).toEqual([5]);
      expect(editor.state.doc.eq(doc)).toBeTrue();
    });

    it('lets [ be typed on an empty line, so [Chorus] still makes a section', () => {
      const requests: ChordFieldRequest[] = [];
      const editor = viewOf(doc, d => Selection.atEnd(d), { onChordFieldRequest: request => requests.push(request) });

      type(editor, '[Chorus]');

      expect(requests).toEqual([]);
      expect(outlineOf(editor.state.doc)).toEqual(['Verse 1 (verse): Wondering', 'Chorus (chorus): ']);
    });
  });
});
