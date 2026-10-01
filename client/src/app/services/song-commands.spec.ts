import { Node } from 'prosemirror-model';
import { history, undo, undoDepth } from 'prosemirror-history';
import {
  AllSelection,
  EditorState,
  NodeSelection,
  Selection,
  TextSelection,
  Transaction
} from 'prosemirror-state';
import { createExtensions } from '../models/progression-normalize';
import { ChordDegree, ProgressionKey } from '../models/progression.model';
import { ChordAtomAttrs, SongMeta } from '../models/song.model';
import { MusicTheoryService } from './music-theory.service';
import { ProgressionKeyContext } from './progression-key-context';
import {
  SongEdit,
  SongEditOutcome,
  addSection,
  changeChord,
  chordWithId,
  commandOf,
  copyLabelOf,
  deleteChord,
  deleteSection,
  duplicateSection,
  insertChord,
  isSongCommand,
  moveChordBy,
  moveChordTo,
  moveSection,
  renameSection,
  replaceChord,
  selectedChordOf,
  setArtist,
  setChordLength,
  setSongKey,
  setTempo,
  setTimeSignature,
  setTitle,
  transposeSong
} from './song-commands';
import { chordSlotOf, chordsOf, createSongIdsPlugin, sectionsOf, songMetaOf, songNodeOf } from './song-document';
import { songSchema } from './song-schema';

/**
 * The song sheet's commands, on a headless `EditorState`.
 *
 * Each edit is run twice over in spirit: as a `SongEdit`, whose outcome says
 * what it would do or why it will not, and - in the `commandOf` specs - as the
 * ProseMirror `Command` the page and the keymap call. Every state carries the
 * history and id plugins the editor runs with, so "one undo step" is asked of
 * the real history.
 */
const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const FOUR_FOUR = { numerator: 4, denominator: 4, isCommon: true };
const META: SongMeta = { title: 'Last Dance', artist: 'The Band', key: C_MAJOR, tempo: 100, timeSignature: FOUR_FOUR };

const keys = new ProgressionKeyContext(new MusicTheoryService());

function degreeAt(degree: number): ChordDegree {
  return {
    degree,
    alter: 0,
    extent: 3,
    quality: null,
    inversion: 0,
    suspension: 'none',
    extensions: createExtensions(),
    octave: 0
  };
}

/** A voiced C major chord atom's attributes on `degree`, one bar long. */
function chordAttrs(degree: number): ChordAtomAttrs {
  return chordSlotOf(degreeAt(degree), C_MAJOR, IONIAN, FOUR_FOUR);
}

function chord(degree: number): Node {
  return songSchema.node('chord', chordAttrs(degree));
}

function line(...content: (string | Node)[]): Node {
  return songSchema.node(
    'lyricLine',
    null,
    content.map(part => (typeof part === 'string' ? songSchema.text(part) : part))
  );
}

function section(id: string, label: string, ...lines: Node[]): Node {
  return songSchema.node('section', { id, label, kind: label === 'Chorus' ? 'chorus' : 'verse' }, lines);
}

function song(...sections: Node[]): Node {
  return songSchema.node('doc', META, sections);
}

function stateOf(doc: Node, selection?: (doc: Node) => Selection): EditorState {
  return EditorState.create({
    doc,
    selection: selection?.(doc),
    plugins: [history(), createSongIdsPlugin()]
  });
}

/** The position just before the first `text` in the document. */
function before(doc: Node, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    const at = node.isText ? (node.text ?? '').indexOf(text) : -1;
    if (at >= 0) found = pos + at;
    return true;
  });
  if (found < 0) throw new Error(`no "${text}" in the document`);
  return found;
}

function caret(pos: number): (doc: Node) => Selection {
  return doc => TextSelection.create(doc, pos);
}

/** Each line as its words with each chord written `[degree]` where it sits. */
function sheetOf(doc: Node): string[] {
  const lines: string[] = [];
  doc.descendants(node => {
    if (node.type.name !== 'lyricLine') return true;
    let text = '';
    node.forEach(child => {
      if (child.isText) text += child.text;
      else if (child.type.name === 'chord') {
        const harmony = child.attrs['harmony'];
        text += `[${harmony.kind === 'degree' ? harmony.degree.degree : '?'}]`;
      }
    });
    lines.push(text);
    return false;
  });
  return lines;
}

function labelsOf(doc: Node): string[] {
  return sectionsOf(doc).map(entry => entry.label);
}

function edited(outcome: SongEditOutcome): Transaction {
  if (outcome.kind !== 'edit') throw new Error(`expected an edit, got ${JSON.stringify(outcome)}`);
  return outcome.tr;
}

/** `edit` applied, through the plugins, as the editor would apply it. */
function run(state: EditorState, edit: SongEdit): EditorState {
  return state.apply(edited(edit(state)));
}

function reasonOf(state: EditorState, edit: SongEdit): string {
  const outcome = edit(state);
  if (outcome.kind !== 'refused') throw new Error(`expected a refusal, got ${outcome.kind}`);
  return outcome.reason;
}

/** The state after one undo. */
function undone(state: EditorState): EditorState {
  let after = state;
  expect(undo(state, tr => (after = state.apply(tr)))).toBeTrue();
  return after;
}

/** That `edit` is one undo step: one more on the stack, and one undo puts the document back. */
function expectOneUndoStep(state: EditorState, edit: SongEdit): void {
  const after = run(state, edit);
  expect(undoDepth(after)).toBe(undoDepth(state) + 1);
  expect(undone(after).doc.eq(state.doc)).toBeTrue();
}

function pitchClassesOf(attrs: ChordAtomAttrs): number[] {
  return [...new Set(attrs.notes.map(note => note.midi % 12))].sort((a, b) => a - b);
}

function onlyChord(doc: Node): ChordAtomAttrs {
  const all = sectionsOf(doc).flatMap(entry => chordsOf(entry.node, entry.pos));
  expect(all.length).toBe(1);
  return all[0].attrs;
}

// ---------------------------------------------------------------------------

describe('commandOf', () => {
  const doc = song(section('s1', 'Verse 1', line('Wondering')));

  it('dispatches the edit and answers true', () => {
    const state = stateOf(doc, caret(2));
    let dispatched: Transaction | null = null;

    expect(commandOf(insertChord(chordAttrs(5)))(state, tr => (dispatched = tr))).toBeTrue();
    expect(dispatched).not.toBeNull();
  });

  it('answers false, dispatches nothing and says why when the edit is refused', () => {
    const state = stateOf(doc, () => new AllSelection(doc));
    const reasons: string[] = [];
    const dispatch = jasmine.createSpy('dispatch');

    expect(commandOf(insertChord(chordAttrs(5)), reason => reasons.push(reason))(state, dispatch)).toBeFalse();
    expect(dispatch).not.toHaveBeenCalled();
    expect(reasons).toEqual([reasonOf(state, insertChord(chordAttrs(5)))]);
  });

  it('only answers when asked without a dispatch, and reports no refusal', () => {
    const refuse = jasmine.createSpy('refuse');
    const command = commandOf(insertChord(chordAttrs(5)), refuse);

    expect(command(stateOf(doc, caret(2)))).toBeTrue();
    expect(command(stateOf(doc, () => new AllSelection(doc)))).toBeFalse();
    expect(refuse).not.toHaveBeenCalled();
  });

  it('answers false and reports nothing when there is nothing to change', () => {
    const refuse = jasmine.createSpy('refuse');
    const dispatch = jasmine.createSpy('dispatch');

    expect(commandOf(setTitle('Last Dance'), refuse)(stateOf(doc), dispatch)).toBeFalse();
    expect(refuse).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('marks each edit as a command, so the editor can close its undo step', () => {
    const state = stateOf(doc, caret(2));

    expect(isSongCommand(edited(insertChord(chordAttrs(5))(state)))).toBeTrue();
    expect(isSongCommand(state.tr.insertText('x'))).toBeFalse();
  });
});

describe('chord commands', () => {
  describe('insertChord', () => {
    const doc = song(section('s1', 'Verse 1', line('Wondering where')));

    it('puts the chord before the character at the caret', () => {
      const state = stateOf(doc, caret(before(doc, 'where')));

      const after = run(state, insertChord(chordAttrs(5)));

      expect(sheetOf(after.doc)).toEqual(['Wondering [5]where']);
    });

    it('puts it at the start of a selection, and leaves the selected words alone', () => {
      const from = before(doc, 'where');
      const state = stateOf(doc, d => TextSelection.create(d, from, from + 5));

      const after = run(state, insertChord(chordAttrs(3)));

      expect(sheetOf(after.doc)).toEqual(['Wondering [3]where']);
    });

    it('keeps the chord it was given: its id, degree, length and notes', () => {
      const attrs = chordAttrs(5);

      const after = run(stateOf(doc, caret(2)), insertChord(attrs));

      expect(onlyChord(after.doc)).toEqual(attrs);
    });

    it('refuses outside a line of lyrics', () => {
      expect(reasonOf(stateOf(doc, d => new AllSelection(d)), insertChord(chordAttrs(5)))).toMatch(/line of lyrics/);
    });

    it('puts the chord at a position it is given instead of the caret, with the caret after it', () => {
      const at = before(doc, 'where');
      const after = run(stateOf(doc, caret(2)), insertChord(chordAttrs(5), at));

      expect(sheetOf(after.doc)).toEqual(['Wondering [5]where']);
      expect(after.selection.empty).toBeTrue();
      expect(after.selection.from).toBe(at + 1);
    });

    it('refuses a position it is given outside a line of lyrics, or outside the song', () => {
      const state = stateOf(doc, caret(2));
      expect(reasonOf(state, insertChord(chordAttrs(5), 0))).toMatch(/line of lyrics/);
      expect(reasonOf(state, insertChord(chordAttrs(5), doc.content.size + 3))).toMatch(/line of lyrics/);
      expect(reasonOf(state, insertChord(chordAttrs(5), 2.5))).toMatch(/line of lyrics/);
    });

    it('refuses a chord the schema refuses, saying why', () => {
      const broken = { ...chordAttrs(5), lengthBeats: Number.NaN };

      expect(reasonOf(stateOf(doc, caret(2)), insertChord(broken))).toMatch(/lengthBeats/);
    });

    it('refuses a chord whose id is already in the song', () => {
      const am = chord(5);
      const withChord = song(section('s1', 'Verse 1', line(am, 'Wondering')));
      const copy: ChordAtomAttrs = { ...chordAttrs(3), id: am.attrs['id'] };

      expect(reasonOf(stateOf(withChord, caret(4)), insertChord(copy))).toMatch(/already/);
    });

    it('is one undo step', () => {
      expectOneUndoStep(stateOf(doc, caret(2)), insertChord(chordAttrs(5)));
    });
  });

  describe('replaceChord', () => {
    const am = chord(5);
    const doc = song(section('s1', 'Verse 1', line('Wondering ', am, 'where')));
    const id: string = am.attrs['id'];

    it('writes the new chord over the old, keeping its id and its place', () => {
      const after = run(stateOf(doc), replaceChord(id, chordAttrs(3)));

      expect(sheetOf(after.doc)).toEqual(['Wondering [3]where']);
      expect(onlyChord(after.doc)).toEqual({ ...chordAttrs(3), id, notes: jasmine.any(Array) });
      expect(chordWithId(after.doc, id)?.pos).toBe(chordWithId(doc, id)?.pos);
    });

    it('keeps a selected chord selected', () => {
      const pos = chordWithId(doc, id)?.pos ?? -1;
      const after = run(stateOf(doc, d => NodeSelection.create(d, pos)), replaceChord(id, chordAttrs(3)));

      expect(selectedChordOf(after)?.attrs.id).toBe(id);
    });

    it('refuses a chord that is not in the song', () => {
      expect(reasonOf(stateOf(doc), replaceChord('gone', chordAttrs(3)))).toMatch(/no longer in the song/);
    });

    it('changes nothing when the chord is the same', () => {
      expect(replaceChord(id, am.attrs as ChordAtomAttrs)(stateOf(doc)).kind).toBe('unchanged');
    });

    it('is one undo step', () => {
      expectOneUndoStep(stateOf(doc), replaceChord(id, chordAttrs(3)));
    });
  });

  describe('changeChord', () => {
    /** Am, two beats long, holding pitches the user wrote and a rhythm the user wrote. */
    const owned: ChordAtomAttrs = {
      ...chordAttrs(5),
      lengthBeats: 2,
      notes: [{ midi: 61, startBeat: 0.5, lengthBeats: 1, velocity: 100 }],
      owned: { pitches: true, timing: true, velocity: false }
    };
    const am = songSchema.node('chord', owned);
    const id = owned.id;
    const doc = song(section('s1', 'Verse 1', line('Wondering ', am, 'where')));
    const plain = chord(5);
    const plainDoc = song(section('s1', 'Verse 1', line(plain, 'Wondering')));

    it('writes the new degree over the chord, keeping its id, its place and its length', () => {
      const after = run(stateOf(doc), changeChord(keys, id, degreeAt(3)));

      expect(sheetOf(after.doc)).toEqual(['Wondering [3]where']);
      const changed = onlyChord(after.doc);
      expect(changed.id).toBe(id);
      expect(changed.lengthBeats).toBe(2);
      expect(changed.harmony).toEqual({ kind: 'degree', degree: degreeAt(3) });
    });

    it('voices the new chord, handing back pitches the slot owned and keeping the rhythm it owned', () => {
      const changed = onlyChord(run(stateOf(doc), changeChord(keys, id, degreeAt(3))).doc);

      // F major: F, A, C - the user's C# went with the chord they replaced.
      expect(pitchClassesOf(changed)).toEqual([0, 5, 9]);
      expect(changed.owned).toEqual({ pitches: false, timing: true, velocity: false });
      expect(changed.notes.every(note => note.startBeat === 0.5 && note.lengthBeats === 1)).toBeTrue();
    });

    it('changes nothing when the degree is the one the chord has, owned pitches and all', () => {
      expect(changeChord(keys, id, degreeAt(5))(stateOf(doc)).kind).toBe('unchanged');
      expect(changeChord(keys, plain.attrs['id'], degreeAt(5))(stateOf(plainDoc)).kind).toBe('unchanged');
    });

    it('refuses a chord that is not in the song, and a key that cannot build chords', () => {
      expect(reasonOf(stateOf(doc), changeChord(keys, 'gone', degreeAt(3)))).toMatch(/no longer in the song/);
      const pentatonic = songSchema.node('doc', { ...META, key: { ...C_MAJOR, scaleId: 'majorPentatonic' } }, [
        section('s1', 'Verse 1', line(plain, 'Wondering'))
      ]);
      expect(reasonOf(stateOf(pentatonic), changeChord(keys, plain.attrs['id'], degreeAt(3)))).toMatch(
        /can't build chords/
      );
    });

    it('is one undo step', () => {
      expectOneUndoStep(stateOf(plainDoc), changeChord(keys, plain.attrs['id'], degreeAt(0)));
    });
  });

  describe('setChordLength', () => {
    const am = chord(5);
    const doc = song(section('s1', 'Verse 1', line(am, 'Wondering')));
    const id: string = am.attrs['id'];

    it('sets the length in beats, and the voicing follows it', () => {
      const after = onlyChord(run(stateOf(doc), setChordLength(id, 2)).doc);

      expect(after.lengthBeats).toBe(2);
      expect(after.notes.every(note => note.lengthBeats === 2)).toBeTrue();
    });

    it('holds a chord to the model\'s shortest, one beat', () => {
      expect(onlyChord(run(stateOf(doc), setChordLength(id, 0.25)).doc).lengthBeats).toBe(1);
    });

    it('refuses a length that is not a number', () => {
      expect(reasonOf(stateOf(doc), setChordLength(id, Number.NaN))).toMatch(/beats/);
      expect(reasonOf(stateOf(doc), setChordLength(id, Number.POSITIVE_INFINITY))).toMatch(/beats/);
    });

    it('refuses a chord that is not in the song, and changes nothing at the length it has', () => {
      expect(reasonOf(stateOf(doc), setChordLength('gone', 2))).toMatch(/no longer in the song/);
      expect(setChordLength(id, 4)(stateOf(doc)).kind).toBe('unchanged');
    });

    it('is one undo step', () => {
      expectOneUndoStep(stateOf(doc), setChordLength(id, 8));
    });
  });

  describe('deleteChord', () => {
    const am = chord(5);
    const doc = song(section('s1', 'Verse 1', line(am, 'Wondering')));
    const id: string = am.attrs['id'];

    it('takes the chord out and leaves the words', () => {
      expect(sheetOf(run(stateOf(doc), deleteChord(id)).doc)).toEqual(['Wondering']);
    });

    it('refuses a chord that is not in the song', () => {
      expect(reasonOf(stateOf(doc), deleteChord('gone'))).toMatch(/no longer in the song/);
    });

    it('is one undo step', () => {
      expectOneUndoStep(stateOf(doc), deleteChord(id));
    });
  });

  describe('moveChordBy', () => {
    const a = chord(5);
    const b = chord(3);
    const idA: string = a.attrs['id'];
    const doc = song(section('s1', 'Verse 1', line('W', a, 'or', b, 'ld'), line('next')));

    it('moves a chord one character right, and one left', () => {
      expect(sheetOf(run(stateOf(doc), moveChordBy(idA, 1)).doc)).toEqual(['Wo[5]r[3]ld', 'next']);
      expect(sheetOf(run(stateOf(doc), moveChordBy(idA, -1)).doc)).toEqual(['[5]Wor[3]ld', 'next']);
    });

    it('passes over chords in its way, which take no width in the words', () => {
      const stacked = song(section('s1', 'Verse 1', line(a, b, 'Wo')));

      expect(sheetOf(run(stateOf(stacked), moveChordBy(idA, 1)).doc)).toEqual(['[3]W[5]o']);
    });

    it('can move to the end of its line, after the last word', () => {
      const late = song(section('s1', 'Verse 1', line('Wo', a, 'd')));

      expect(sheetOf(run(stateOf(late), moveChordBy(idA, 1)).doc)).toEqual(['Wod[5]']);
    });

    it('never lands between the two halves of a character written as a surrogate pair', () => {
      const guitar = '\u{1F3B8}';
      const emoji = song(section('s1', 'Verse 1', line(a, `${guitar}x`)));

      const after = run(stateOf(emoji), moveChordBy(idA, 1)).doc;

      expect(after.child(0).child(0).child(0).text).toBe(guitar);
      // The line's content starts at 2; the guitar takes two positions.
      expect(chordWithId(after, idA)?.pos).toBe(4);
    });

    it('refuses to pass either end of its line, rather than cross to the next', () => {
      const atEnds = song(section('s1', 'Verse 1', line(a, 'Wo', b), line('next')));

      expect(reasonOf(stateOf(atEnds), moveChordBy(idA, -1))).toMatch(/start of its line/);
      expect(reasonOf(stateOf(atEnds), moveChordBy(b.attrs['id'], 1))).toMatch(/end of its line/);
    });

    it('keeps its id and its length, and stays selected when it was', () => {
      const pos = chordWithId(doc, idA)?.pos ?? -1;
      const after = run(stateOf(doc, d => NodeSelection.create(d, pos)), moveChordBy(idA, 1));

      expect(selectedChordOf(after)?.attrs).toEqual(a.attrs as ChordAtomAttrs);
    });

    it('refuses a chord that is not in the song', () => {
      expect(reasonOf(stateOf(doc), moveChordBy('gone', 1))).toMatch(/no longer in the song/);
    });

    it('is one undo step', () => {
      expectOneUndoStep(stateOf(doc), moveChordBy(idA, 1));
    });
  });

  describe('moveChordTo', () => {
    const am = chord(5);
    const id: string = am.attrs['id'];
    const doc = song(
      section('s1', 'Verse 1', line(am, 'Wondering')),
      section('s2', 'Chorus', line('Got me thinking'))
    );

    it('moves the chord to a letter in another section, keeping its id and length, and selects it', () => {
      const after = run(stateOf(doc), moveChordTo(id, before(doc, 'thinking')));

      expect(sheetOf(after.doc)).toEqual(['Wondering', 'Got me [5]thinking']);
      expect(selectedChordOf(after)?.attrs).toEqual(am.attrs as ChordAtomAttrs);
    });

    it('moves it later in its own line', () => {
      const after = run(stateOf(doc), moveChordTo(id, before(doc, 'ring')));

      expect(sheetOf(after.doc)[0]).toBe('Wonde[5]ring');
    });

    it('refuses a place that is not inside a line of lyrics', () => {
      const between = sectionsOf(doc)[1].pos;

      expect(reasonOf(stateOf(doc), moveChordTo(id, between))).toMatch(/line of lyrics/);
      expect(reasonOf(stateOf(doc), moveChordTo(id, doc.content.size + 5))).toMatch(/line of lyrics/);
    });

    it('changes nothing when dropped where it already is', () => {
      const pos = chordWithId(doc, id)?.pos ?? -1;

      expect(moveChordTo(id, pos)(stateOf(doc)).kind).toBe('unchanged');
      expect(moveChordTo(id, pos + 1)(stateOf(doc)).kind).toBe('unchanged');
    });

    it('refuses a chord that is not in the song', () => {
      expect(reasonOf(stateOf(doc), moveChordTo('gone', 3))).toMatch(/no longer in the song/);
    });

    it('is one undo step', () => {
      expectOneUndoStep(stateOf(doc), moveChordTo(id, before(doc, 'thinking')));
    });
  });
});

describe('section commands', () => {
  const doc = song(
    section('s1', 'Verse 1', line('one'), line('two')),
    section('s2', 'Chorus', line('three'))
  );

  describe('addSection', () => {
    it('puts the new section after the one holding the caret, and the caret in its first line', () => {
      const after = run(stateOf(doc, caret(before(doc, 'two'))), addSection('pre', 'Pre-Chorus'));

      expect(labelsOf(after.doc)).toEqual(['Verse 1', 'Pre-Chorus', 'Chorus']);
      expect(sectionsOf(after.doc)[1].kind).toBe('pre');
      expect(after.selection.empty).toBeTrue();
      expect(after.selection.$head.parent.type.name).toBe('lyricLine');
      expect(after.selection.$head.index(0)).toBe(1);
    });

    it('adds after the last section when the caret is there, with a fresh id', () => {
      const after = run(stateOf(doc, caret(before(doc, 'three'))), addSection('bridge', 'Bridge'));

      expect(labelsOf(after.doc)).toEqual(['Verse 1', 'Chorus', 'Bridge']);
      expect(sectionsOf(after.doc)[2].id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('refuses a blank name or a kind it does not know', () => {
      expect(reasonOf(stateOf(doc), addSection('verse', '  '))).toMatch(/needs a name/);
      expect(reasonOf(stateOf(doc), addSection('coda' as never, 'Coda'))).toMatch(/kind/);
    });

    it('is one undo step', () => {
      expectOneUndoStep(stateOf(doc), addSection('outro', 'Outro'));
    });
  });

  describe('renameSection', () => {
    it('renames a section, and changes its kind when asked', () => {
      const renamed = run(stateOf(doc), renameSection('s2', 'Last Chorus'));
      const rekinded = run(stateOf(doc), renameSection('s1', 'Intro', 'intro'));

      expect(sectionsOf(renamed.doc)[1]).toEqual(jasmine.objectContaining({ id: 's2', label: 'Last Chorus', kind: 'chorus' }));
      expect(sectionsOf(rekinded.doc)[0]).toEqual(jasmine.objectContaining({ id: 's1', label: 'Intro', kind: 'intro' }));
    });

    it('refuses a blank name, an unknown kind, or a section that is not in the song', () => {
      expect(reasonOf(stateOf(doc), renameSection('s1', ''))).toMatch(/needs a name/);
      expect(reasonOf(stateOf(doc), renameSection('s1', 'Coda', 'coda' as never))).toMatch(/kind/);
      expect(reasonOf(stateOf(doc), renameSection('gone', 'Coda'))).toMatch(/no longer in the song/);
    });

    it('changes nothing when the name and kind are the ones it has', () => {
      expect(renameSection('s2', 'Chorus', 'chorus')(stateOf(doc)).kind).toBe('unchanged');
    });

    it('is one undo step', () => {
      expectOneUndoStep(stateOf(doc), renameSection('s1', 'Verse One'));
    });
  });

  describe('moveSection', () => {
    it('moves a section down and up past its neighbour', () => {
      expect(labelsOf(run(stateOf(doc), moveSection('s1', 1)).doc)).toEqual(['Chorus', 'Verse 1']);
      expect(labelsOf(run(stateOf(doc), moveSection('s2', -1)).doc)).toEqual(['Chorus', 'Verse 1']);
    });

    it('refuses to move the first section up or the last one down', () => {
      expect(reasonOf(stateOf(doc), moveSection('s1', -1))).toMatch(/already the first/);
      expect(reasonOf(stateOf(doc), moveSection('s2', 1))).toMatch(/already the last/);
      expect(reasonOf(stateOf(doc), moveSection('gone', 1))).toMatch(/no longer in the song/);
    });

    it('takes the caret with the section it was in', () => {
      const after = run(stateOf(doc, caret(before(doc, 'two') + 1)), moveSection('s1', 1));

      expect(after.selection.$head.parent.textContent).toBe('two');
      expect(after.selection.$head.parentOffset).toBe(1);
    });

    it('is one undo step', () => {
      expectOneUndoStep(stateOf(doc), moveSection('s1', 1));
    });
  });

  describe('duplicateSection', () => {
    const am = chord(5);
    const withChords = song(
      section('s1', 'Verse 1', line(am, 'one'), line('two')),
      section('s2', 'Chorus', line('three'))
    );

    it('puts a copy right after the original, with fresh ids for the section and every chord', () => {
      const after = run(stateOf(withChords), duplicateSection('s1')).doc;
      const [original, copy] = sectionsOf(after);
      const [copied] = chordsOf(copy.node, copy.pos);

      expect(sheetOf(after)).toEqual(['[5]one', 'two', '[5]one', 'two', 'three']);
      expect(original.id).toBe('s1');
      expect(copy.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(copied.attrs.id).not.toBe(am.attrs['id']);
      expect({ ...copied.attrs, id: '' }).toEqual({ ...(am.attrs as ChordAtomAttrs), id: '' });
      expect(songNodeOf(after.toJSON()).kind).toBe('song');
    });

    it('numbers the copy of a numbered section on, and keeps an unnumbered name', () => {
      expect(labelsOf(run(stateOf(withChords), duplicateSection('s1')).doc)).toEqual(['Verse 1', 'Verse 2', 'Chorus']);
      expect(labelsOf(run(stateOf(withChords), duplicateSection('s2')).doc)).toEqual(['Verse 1', 'Chorus', 'Chorus']);
    });

    it('leaves a voice memo out of the copy, since its recording belongs to the original', () => {
      const memo = songSchema.node('memo', { id: 'memo-1', name: 'Take 1', durationSec: 12 });
      const withMemo = song(songSchema.node('section', { id: 's1', label: 'Verse 1', kind: 'verse' }, [memo]));

      const after = run(stateOf(withMemo), duplicateSection('s1')).doc;

      expect(after.child(1).childCount).toBe(1);
      expect(after.child(1).child(0).type.name).toBe('lyricLine');
      expect(songNodeOf(after.toJSON()).kind).toBe('song');
    });

    it('refuses a section that is not in the song', () => {
      expect(reasonOf(stateOf(withChords), duplicateSection('gone'))).toMatch(/no longer in the song/);
    });

    it('is one undo step', () => {
      expectOneUndoStep(stateOf(withChords), duplicateSection('s1'));
    });
  });

  describe('copyLabelOf', () => {
    it('numbers past the highest number its name already has in the song', () => {
      expect(copyLabelOf('Verse 1', ['Verse 1', 'Chorus'])).toBe('Verse 2');
      expect(copyLabelOf('Verse 1', ['Verse 1', 'Verse 2', 'verse 3'])).toBe('Verse 4');
      expect(copyLabelOf('Chorus', ['Chorus'])).toBe('Chorus');
      expect(copyLabelOf('Take 5', ['Take 5'])).toBe('Take 6');
    });
  });

  describe('deleteSection', () => {
    it('takes the section and everything in it out', () => {
      expect(labelsOf(run(stateOf(doc), deleteSection('s1')).doc)).toEqual(['Chorus']);
    });

    it('refuses to delete the last section, or one that is not in the song', () => {
      const one = song(section('s1', 'Verse 1', line('one')));

      expect(reasonOf(stateOf(one), deleteSection('s1'))).toMatch(/at least one section/);
      expect(reasonOf(stateOf(doc), deleteSection('gone'))).toMatch(/no longer in the song/);
    });

    it('leaves the caret in a line', () => {
      const after = run(stateOf(doc, caret(before(doc, 'two'))), deleteSection('s1'));

      expect(after.selection.$head.parent.type.name).toBe('lyricLine');
    });

    it('is one undo step', () => {
      expectOneUndoStep(stateOf(doc), deleteSection('s1'));
    });
  });
});

describe('song commands', () => {
  describe('setSongKey', () => {
    const one = chord(0);
    const five = chord(4);
    const doc = song(section('s1', 'Verse 1', line(one, 'Wondering ', five, 'where')));

    /** The song with its I chord's pitches owned, as an edit in the roll leaves it. */
    function withOwnedTonic(): Node {
      const attrs = one.attrs as ChordAtomAttrs;
      const owned = songSchema.node('chord', { ...attrs, owned: { ...attrs.owned, pitches: true } });
      return song(section('s1', 'Verse 1', line(owned, 'Wondering')));
    }

    function chordsIn(after: Node): ChordAtomAttrs[] {
      return sectionsOf(after).flatMap(entry => chordsOf(entry.node, entry.pos)).map(entry => entry.attrs);
    }

    it('keeps every chord on its degree and voices it in the new key', () => {
      const after = run(stateOf(doc), setSongKey(keys, 7, 'ionian')).doc;
      const [tonic, dominant] = chordsIn(after);

      expect(songMetaOf(after).key).toEqual({ tonic: 7, scaleId: 'ionian', preferSharps: true });
      expect(tonic.harmony).toEqual(one.attrs['harmony']);
      expect(dominant.harmony).toEqual(five.attrs['harmony']);
      // I and V in G: G B D and D F# A.
      expect(pitchClassesOf(tonic)).toEqual([2, 7, 11]);
      expect(pitchClassesOf(dominant)).toEqual([2, 6, 9]);
    });

    it('carries a chord whose pitches are owned with the tonic', () => {
      const [tonic] = chordsIn(run(stateOf(withOwnedTonic()), setSongKey(keys, 2, 'ionian')).doc);

      expect(pitchClassesOf(tonic)).toEqual([2, 6, 9]);
      expect(tonic.owned.pitches).toBeTrue();
    });

    it('keeps an owned chord\'s pitches across a change of mode, and numbers them again', () => {
      const before = chordsIn(withOwnedTonic())[0];

      const [tonic] = chordsIn(run(stateOf(withOwnedTonic()), setSongKey(keys, 0, 'aeolian')).doc);

      expect(tonic.notes).toEqual(before.notes);
      expect(tonic.harmony).toEqual({ kind: 'degree', degree: jasmine.objectContaining({ degree: 0, quality: 'major' }) });
    });

    it('leaves a literal chord\'s notes as they are', () => {
      const attrs = five.attrs as ChordAtomAttrs;
      const literal = songSchema.node('chord', {
        ...attrs,
        harmony: { kind: 'literal', reason: 'user-detached', from: null }
      });
      const literalSong = song(section('s1', 'Verse 1', line(literal, 'Wondering')));

      const [after] = chordsIn(run(stateOf(literalSong), setSongKey(keys, 7, 'ionian')).doc);

      expect(after.notes).toEqual(attrs.notes);
    });

    it('spells the key from its signature, unless told which spelling', () => {
      const keyAfter = (tonic: number, preferSharps?: boolean): ProgressionKey =>
        songMetaOf(run(stateOf(doc), setSongKey(keys, tonic, 'ionian', preferSharps)).doc).key;

      expect(keyAfter(5).preferSharps).toBeFalse();
      expect(keyAfter(2).preferSharps).toBeTrue();
      expect(keyAfter(6).preferSharps).toBeTrue();
      expect(keyAfter(6, false).preferSharps).toBeFalse();
    });

    it('is one undo step that puts back the key and every chord', () => {
      expectOneUndoStep(stateOf(doc), setSongKey(keys, 9, 'aeolian'));
    });

    it('refuses a scale that cannot build chords, naming it', () => {
      expect(reasonOf(stateOf(doc), setSongKey(keys, 0, 'majorPentatonic'))).toMatch(/Major Pentatonic/);
    });

    it('refuses a scale it does not know, and a tonic that is not a pitch class', () => {
      expect(reasonOf(stateOf(doc), setSongKey(keys, 0, 'nonsense'))).toMatch(/nonsense/);
      expect(reasonOf(stateOf(doc), setSongKey(keys, 1.5, 'ionian'))).toMatch(/tonic/i);
    });

    it('wraps a tonic past B round to a pitch class', () => {
      expect(songMetaOf(run(stateOf(doc), setSongKey(keys, 14, 'ionian')).doc).key.tonic).toBe(2);
    });

    it('changes nothing when the key is the one the song is in', () => {
      expect(setSongKey(keys, 0, 'ionian')(stateOf(doc)).kind).toBe('unchanged');
    });
  });

  describe('transposeSong', () => {
    const one = chord(0);
    const doc = song(section('s1', 'Verse 1', line(one, 'Wondering')));

    it('moves the tonic a semitone, chords and all, spelling the new key from its signature', () => {
      const up = run(stateOf(doc), transposeSong(keys, 1)).doc;
      const down = run(stateOf(doc), transposeSong(keys, -1)).doc;

      expect(songMetaOf(up).key).toEqual({ tonic: 1, scaleId: 'ionian', preferSharps: false });
      expect(songMetaOf(down).key).toEqual({ tonic: 11, scaleId: 'ionian', preferSharps: true });
      expect(pitchClassesOf(onlyChord(up))).toEqual([1, 5, 8]);
      expect(onlyChord(up).harmony).toEqual(one.attrs['harmony']);
    });

    it('refuses in a key whose scale cannot build chords', () => {
      const pentatonic = songSchema.node('doc', { ...META, key: { ...C_MAJOR, scaleId: 'majorPentatonic' } }, [
        section('s1', 'Verse 1', line('Wondering'))
      ]);

      expect(reasonOf(stateOf(pentatonic), transposeSong(keys, 1))).toMatch(/Major Pentatonic/);
    });

    it('is one undo step', () => {
      expectOneUndoStep(stateOf(doc), transposeSong(keys, 1));
    });
  });

  describe('setTempo', () => {
    const doc = song(section('s1', 'Verse 1', line('one')));

    it('sets the BPM', () => {
      expect(songMetaOf(run(stateOf(doc), setTempo(72)).doc).tempo).toBe(72);
    });

    it('refuses a tempo outside what the player can play, or no number at all', () => {
      expect(reasonOf(stateOf(doc), setTempo(10))).toMatch(/20 to 300/);
      expect(reasonOf(stateOf(doc), setTempo(301))).toMatch(/20 to 300/);
      expect(reasonOf(stateOf(doc), setTempo(Number.NaN))).toMatch(/20 to 300/);
      expect(setTempo(100)(stateOf(doc)).kind).toBe('unchanged');
    });

    it('is one undo step', () => {
      expectOneUndoStep(stateOf(doc), setTempo(72));
    });
  });

  describe('setTimeSignature', () => {
    const am = chord(5);
    const doc = song(section('s1', 'Verse 1', line(am, 'one')));
    const threeFour = { numerator: 3, denominator: 4, isCommon: false };

    it('sets the meter and leaves every chord the length it was, in beats', () => {
      const after = run(stateOf(doc), setTimeSignature(threeFour)).doc;

      expect(songMetaOf(after).timeSignature).toEqual(threeFour);
      expect(onlyChord(after)).toEqual(am.attrs as ChordAtomAttrs);
    });

    it('refuses a meter a bar cannot have', () => {
      expect(reasonOf(stateOf(doc), setTimeSignature({ ...threeFour, numerator: 0 }))).toMatch(/time signature/);
      expect(reasonOf(stateOf(doc), setTimeSignature({ ...threeFour, numerator: 2.5 }))).toMatch(/time signature/);
      expect(reasonOf(stateOf(doc), setTimeSignature({ ...threeFour, denominator: 3 }))).toMatch(/time signature/);
      expect(setTimeSignature({ ...FOUR_FOUR })(stateOf(doc)).kind).toBe('unchanged');
    });

    it('is one undo step', () => {
      expectOneUndoStep(stateOf(doc), setTimeSignature(threeFour));
    });
  });

  describe('setTitle and setArtist', () => {
    const doc = song(section('s1', 'Verse 1', line('one')));

    it('set the song\'s title and artist as typed', () => {
      const after = run(run(stateOf(doc), setTitle('First Dance ')), setArtist('Another Band')).doc;

      expect(songMetaOf(after).title).toBe('First Dance ');
      expect(songMetaOf(after).artist).toBe('Another Band');
    });

    it('change nothing when the text is the same', () => {
      expect(setTitle('Last Dance')(stateOf(doc)).kind).toBe('unchanged');
      expect(setArtist('The Band')(stateOf(doc)).kind).toBe('unchanged');
    });

    it('are one undo step each', () => {
      expectOneUndoStep(stateOf(doc), setTitle('First Dance'));
      expectOneUndoStep(stateOf(doc), setArtist('Another Band'));
    });
  });
});
