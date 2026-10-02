import { history, undo, undoDepth } from 'prosemirror-history';
import { Node } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { createExtensions } from '../models/progression-normalize';
import { ChordDegree, ChordSlot, ProgressionDoc, ProgressionKey } from '../models/progression.model';
import { ChordAtomAttrs, SongMeta } from '../models/song.model';
import { regenerateSlot } from './progression-edit';
import { SongEdit } from './song-commands';
import {
  chordSlotOf,
  chordsOf,
  createSongIdsPlugin,
  sectionProgressionOf,
  sectionsOf,
  songMetaOf
} from './song-document';
import {
  SongAfterReturn,
  addReturnedSection,
  applyReturn,
  sectionHandoffOf,
  songAfterReturnOf
} from './song-progression-return';
import { songSchema } from './song-schema';

/**
 * Bringing a section's progression back from the Progression page into the song (brief decision 7), on a headless
 * `EditorState` carrying the history and id plugins the sheet runs with, so "one undo step" is asked of the real
 * history.
 */
const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const FOUR_FOUR = { numerator: 4, denominator: 4, isCommon: true };
const META: SongMeta = { title: 'Last Dance', artist: 'The Band', key: C_MAJOR, tempo: 100, timeSignature: FOUR_FOUR };

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

function attrsOn(degree: number, id: string): ChordAtomAttrs {
  return { ...chordSlotOf(degreeAt(degree), C_MAJOR, IONIAN, FOUR_FOUR), id };
}

function chord(degree: number, id: string): Node {
  return songSchema.node('chord', attrsOn(degree, id));
}

function line(...content: (string | Node)[]): Node {
  return songSchema.node(
    'lyricLine',
    null,
    content.map(part => (typeof part === 'string' ? songSchema.text(part) : part))
  );
}

/**
 * "Last Dance": Verse 1 is C over "Got", Am over "thinking", then F over "of you" on a second line; the chorus is G.
 * Chord ids are their names, so a spec can say which chord it means.
 */
function lastDance(): Node {
  return songSchema.node('doc', META, [
    songSchema.node('section', { id: 'v1', label: 'Verse 1', kind: 'verse' }, [
      line(chord(0, 'C'), 'Got me ', chord(5, 'Am'), 'thinking'),
      line(chord(3, 'F'), 'of you')
    ]),
    songSchema.node('section', { id: 'c1', label: 'Chorus', kind: 'chorus' }, [line(chord(4, 'G'), 'Oh')])
  ]);
}

function stateOf(doc: Node): EditorState {
  return EditorState.create({ doc, plugins: [history(), createSongIdsPlugin()] });
}

/** Verse 1's progression as the store would have published it on the way out: revision 5. */
function sentOf(doc: Node): ProgressionDoc {
  const derived = sectionProgressionOf(doc, 'v1');
  if (derived === null) throw new Error('No Verse 1');
  return { ...derived, revision: 5 };
}

/** `sent` as the Progression page hands it back: a later revision, with `edit` applied to its slots. */
function returnedOf(
  sent: ProgressionDoc,
  edit: (slots: ChordSlot[]) => ChordSlot[],
  extra: Partial<ProgressionDoc> = {}
): ProgressionDoc {
  return { ...structuredClone(sent), revision: 9, slots: edit(structuredClone(sent.slots)), ...extra };
}

function slot(slots: readonly ChordSlot[], id: string): ChordSlot {
  const found = slots.find(candidate => candidate.id === id);
  if (!found) throw new Error(`No slot ${id}`);
  return found;
}

/** `slots` with the chord `id` made `beats` long. */
function lengthened(slots: ChordSlot[], id: string, beats: number): ChordSlot[] {
  return slots.map(each => (each.id === id ? { ...each, lengthBeats: beats } : each));
}

/** `slot` made the chord on `degree`, voiced in C major. */
function rechorded(original: ChordSlot, degree: number): ChordSlot {
  return regenerateSlot({ ...original, harmony: { kind: 'degree', degree: degreeAt(degree) } }, C_MAJOR, IONIAN);
}

/** A new slot, as the Progression page's palette would add one. */
function added(degree: number, id: string): ChordSlot {
  return { ...attrsOn(degree, id), startBeat: 0 };
}

/** Each lyric line of the section `id`, its words with each chord written as `[id]` where it sits. */
function linesOf(doc: Node, id: string): string[] {
  const section = sectionsOf(doc).find(entry => entry.id === id);
  if (!section) throw new Error(`No section ${id}`);
  const lines: string[] = [];
  section.node.forEach(child => {
    if (child.type.name !== 'lyricLine') return;
    let text = '';
    child.forEach(part => (text += part.isText ? part.text : `[${part.attrs['id']}]`));
    lines.push(text);
  });
  return lines;
}

function atom(doc: Node, id: string): ChordAtomAttrs {
  for (const section of sectionsOf(doc)) {
    const found = chordsOf(section.node, section.pos).find(entry => entry.attrs.id === id);
    if (found) return found.attrs;
  }
  throw new Error(`No chord ${id}`);
}

/** Runs `edit` on `state`, expecting it to change the song, and returns the new state. */
function ran(state: EditorState, edit: SongEdit): EditorState {
  const outcome = edit(state);
  if (outcome.kind !== 'edit') throw new Error(`The edit did not run: ${JSON.stringify(outcome)}`);
  return state.apply(outcome.tr);
}

/** The outcome's changes applied, as the page applies them: one `applyReturn` on the state they were made from. */
function applied(state: EditorState, outcome: SongAfterReturn): EditorState {
  if (outcome.kind !== 'changes') throw new Error(`Expected changes, got ${outcome.kind}`);
  return ran(state, applyReturn(state.doc, outcome.steps));
}

function noticesOf(outcome: SongAfterReturn): readonly string[] {
  return outcome.kind === 'changes' ? outcome.notices : [];
}

describe('songAfterReturnOf', () => {
  let state: EditorState;
  let sent: ProgressionDoc;

  beforeEach(() => {
    state = stateOf(lastDance());
    sent = sentOf(state.doc);
  });

  it('applies nothing when the revision did not move', () => {
    const returned = returnedOf(sent, slots => slots.map(each => ({ ...each, lengthBeats: 8 })), { revision: 5 });
    expect(songAfterReturnOf(state.doc, 'v1', returned, sent)).toEqual({ kind: 'unchanged' });
  });

  it('applies nothing when the revision moved but every chord came back as it went', () => {
    expect(songAfterReturnOf(state.doc, 'v1', returnedOf(sent, slots => slots), sent)).toEqual({ kind: 'unchanged' });
  });

  it('writes a chord changed there over its atom, by id, and leaves the others and the words alone', () => {
    const returned = returnedOf(sent, slots =>
      slots.map(each => (each.id === 'Am' ? { ...rechorded(each, 1), lengthBeats: 8 } : each))
    );
    const outcome = songAfterReturnOf(state.doc, 'v1', returned, sent);
    const after = applied(state, outcome).doc;

    const am = atom(after, 'Am');
    expect(am.lengthBeats).toBe(8);
    expect(am.harmony).toEqual(slot(returned.slots, 'Am').harmony);
    expect(am.notes).toEqual(slot(returned.slots, 'Am').notes);
    expect(atom(after, 'C')).toEqual(atom(state.doc, 'C'));
    expect(atom(after, 'F')).toEqual(atom(state.doc, 'F'));
    expect(linesOf(after, 'v1')).toEqual(['[C]Got me [Am]thinking', '[F]of you']);
    expect(noticesOf(outcome)).toEqual(['Verse 1: 1 chord changed on the Progression page.']);
  });

  it('keeps an edit made on the sheet since the section was sent, where the chord came back untouched', () => {
    // Am became Dm on the sheet after the section went out; the Progression page changed only F.
    const edited = state.apply(
      state.tr.setNodeAttribute(chordAt(state.doc, 'Am'), 'harmony', { kind: 'degree', degree: degreeAt(1) })
    );
    const returned = returnedOf(sent, slots => lengthened(slots, 'F', 2));
    const after = applied(edited, songAfterReturnOf(edited.doc, 'v1', returned, sent)).doc;

    expect(atom(after, 'Am').harmony).toEqual({ kind: 'degree', degree: degreeAt(1) });
    expect(atom(after, 'F').lengthBeats).toBe(2);
  });

  it('keeps a chord placed on the sheet since the section was sent', () => {
    const late = state.apply(state.tr.insert(chordAt(state.doc, 'F'), chord(4, 'late')));
    const returned = returnedOf(sent, slots => lengthened(slots, 'C', 2));
    const after = applied(late, songAfterReturnOf(late.doc, 'v1', returned, sent)).doc;

    expect(linesOf(after, 'v1')).toEqual(['[C]Got me [Am]thinking', '[late][F]of you']);
  });

  it('deletes the atom of a chord removed there, and keeps its words', () => {
    const returned = returnedOf(sent, slots => slots.filter(each => each.id !== 'Am'));
    const outcome = songAfterReturnOf(state.doc, 'v1', returned, sent);
    const after = applied(state, outcome).doc;

    expect(linesOf(after, 'v1')).toEqual(['[C]Got me thinking', '[F]of you']);
    expect(noticesOf(outcome)).toEqual(['Verse 1: 1 chord removed on the Progression page.']);
  });

  it("appends chords added there at the end of the section's last line, in their order, and says how many", () => {
    const returned = returnedOf(sent, slots => [...slots, added(4, 'G7'), added(0, 'Cend')]);
    const outcome = songAfterReturnOf(state.doc, 'v1', returned, sent);
    const after = applied(state, outcome).doc;

    expect(linesOf(after, 'v1')).toEqual(['[C]Got me [Am]thinking', '[F]of you[G7][Cend]']);
    expect(linesOf(after, 'c1')).toEqual(['[G]Oh']);
    expect(atom(after, 'G7').harmony).toEqual(added(4, 'G7').harmony);
    expect(noticesOf(outcome)).toEqual([
      "2 chords added on the Progression page are at the end of Verse 1's last line; drag each onto its word."
    ]);
  });

  it('gives a section with no line of lyrics one, to hold the chords added there', () => {
    const doc = songSchema.node('doc', META, [
      songSchema.node('section', { id: 'v1', label: 'Verse 1', kind: 'verse' }, [
        songSchema.node('memo', { id: 'm1', name: 'Hum', durationSec: 3 })
      ])
    ]);
    const memoState = stateOf(doc);
    const memoSent = sentOf(doc);
    const returned = returnedOf(memoSent, () => [added(0, 'C')]);
    const after = applied(memoState, songAfterReturnOf(doc, 'v1', returned, memoSent)).doc;

    expect(linesOf(after, 'v1')).toEqual(['[C]']);
    expect(after.child(0).child(0).type.name).toBe('memo');
  });

  it("keeps the lyrics' order when the chords were reordered there, and says so", () => {
    const returned = returnedOf(sent, slots => [slots[2], slots[0], slots[1]]);
    const outcome = songAfterReturnOf(state.doc, 'v1', returned, sent);

    expect(outcome.kind).toBe('changes');
    if (outcome.kind !== 'changes') return;
    expect(outcome.steps).toEqual([]);
    expect(outcome.notices).toEqual([
      'The chords were reordered on the Progression page; on the sheet each keeps its place in the words.'
    ]);
  });

  it('does not carry back a key or a tempo changed there, and says which', () => {
    const returned = returnedOf(sent, slots => slots, {
      key: { tonic: 2, scaleId: 'ionian', preferSharps: true },
      tempo: 132
    });
    const outcome = songAfterReturnOf(state.doc, 'v1', returned, sent);

    expect(noticesOf(outcome)).toEqual([
      "The key and tempo set on the Progression page were not brought back: the song's own are set on the song."
    ]);
    if (outcome.kind !== 'changes') return;
    expect(outcome.steps).toEqual([]);
  });

  it('says a chord changed there but taken out of the section here meanwhile stays out', () => {
    const removed = state.apply(state.tr.delete(chordAt(state.doc, 'Am'), chordAt(state.doc, 'Am') + 1));
    const returned = returnedOf(sent, slots => lengthened(slots, 'Am', 8));
    const outcome = songAfterReturnOf(removed.doc, 'v1', returned, sent);

    expect(noticesOf(outcome)).toEqual([
      '1 chord changed on the Progression page had been taken out of Verse 1 here, so it stays out.'
    ]);
    expect(outcome.kind === 'changes' && outcome.steps).toEqual([]);
  });

  it('is one undo step, however much it changes', () => {
    const returned = returnedOf(sent, slots => [
      { ...slot(slots, 'C'), lengthBeats: 2 },
      slot(slots, 'F'),
      added(4, 'G7')
    ]);
    const after = applied(state, songAfterReturnOf(state.doc, 'v1', returned, sent));

    expect(undoDepth(after)).toBe(1);
    let undone = after;
    undo(after, tr => (undone = after.apply(tr)));
    expect(undone.doc.eq(state.doc)).toBeTrue();
  });

  it('refuses a chord the song could not hold, and applies none of them', () => {
    const returned = returnedOf(sent, slots => [
      { ...slots[0], lengthBeats: 2 },
      { ...slots[1], harmony: null as unknown as ChordSlot['harmony'] }
    ]);
    const outcome = songAfterReturnOf(state.doc, 'v1', returned, sent);

    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.reason).toMatch(/^The Progression page's chords could not be brought back: /);
  });

  it('refuses a progression with one chord twice', () => {
    const returned = returnedOf(sent, slots => [...slots, slots[0]]);
    expect(songAfterReturnOf(state.doc, 'v1', returned, sent).kind).toBe('refused');
  });

  it("refuses another section's progression", () => {
    const returned = returnedOf(sent, slots => slots, { id: 'c1' });
    expect(songAfterReturnOf(state.doc, 'v1', returned, sent).kind).toBe('refused');
  });

  it('hands back every chord, checked, when the section is no longer in the song', () => {
    const gone = state.apply(state.tr.delete(0, state.doc.child(0).nodeSize));
    const returned = returnedOf(sent, slots => [...slots, added(4, 'G7')]);
    const outcome = songAfterReturnOf(gone.doc, 'v1', returned, sent);

    expect(outcome.kind).toBe('sectionGone');
    if (outcome.kind !== 'sectionGone') return;
    expect(outcome.chords.map(each => each.id)).toEqual(['C', 'Am', 'F', 'G7']);
    expect(outcome.chords[0]).toEqual(atom(state.doc, 'C'));
  });

  it('does not change its input', () => {
    const returned = returnedOf(sent, slots => [...slots.slice(1), added(4, 'G7')]);
    const before = JSON.stringify([state.doc.toJSON(), returned, sent]);
    songAfterReturnOf(state.doc, 'v1', returned, sent);
    expect(JSON.stringify([state.doc.toJSON(), returned, sent])).toBe(before);
  });
});

describe('applyReturn', () => {
  it('refuses steps made from another document', () => {
    const state = stateOf(lastDance());
    const sent = sentOf(state.doc);
    const outcome = songAfterReturnOf(state.doc, 'v1', returnedOf(sent, slots => slots.slice(1)), sent);
    if (outcome.kind !== 'changes') throw new Error('Expected changes');
    const moved = state.apply(state.tr.insertText('Hey ', 2));

    expect(applyReturn(state.doc, outcome.steps)(moved)).toEqual({
      kind: 'refused',
      reason: "The song changed before the Progression page's chords could be brought back."
    });
  });
});

describe('addReturnedSection', () => {
  it('puts the chords in a new section at the end of the song, as copies with ids of their own, as one step', () => {
    const state = stateOf(lastDance());
    const chords = [attrsOn(0, 'x1'), attrsOn(4, 'x2')];
    const after = ran(state, addReturnedSection('Verse 1', 'verse', chords));

    const sections = sectionsOf(after.doc);
    expect(sections.map(entry => [entry.label, entry.kind])).toEqual([
      ['Verse 1', 'verse'],
      ['Chorus', 'chorus'],
      ['Verse 1', 'verse']
    ]);
    const placed = chordsOf(sections[2].node, sections[2].pos).map(entry => entry.attrs);
    expect(placed.map(entry => entry.harmony)).toEqual(chords.map(entry => entry.harmony));
    expect(placed.map(entry => entry.id)).not.toContain('x1');
    expect(undoDepth(after)).toBe(1);
  });
});

describe('sectionHandoffOf', () => {
  it("is the section's derived progression, with what the Progression page says about it", () => {
    const doc = lastDance();
    expect(sectionHandoffOf('song-1', doc, 'c1')).toEqual({
      songId: 'song-1',
      songTitle: 'Last Dance',
      sectionId: 'c1',
      sectionLabel: 'Chorus',
      sectionKind: 'chorus',
      progression: jasmine.objectContaining({ id: 'c1', slots: [jasmine.objectContaining({ id: 'G' })] })
    });
    expect(songMetaOf(doc).title).toBe('Last Dance');
  });

  it('calls an untitled song what the rest of the app calls it', () => {
    const doc = songSchema.node('doc', { ...META, title: '  ' }, [lastDance().child(0)]);
    expect(sectionHandoffOf('song-1', doc, 'v1')?.songTitle).toBe('Untitled song');
  });

  it('is null for a section the song does not have', () => {
    expect(sectionHandoffOf('song-1', lastDance(), 'nope')).toBeNull();
  });
});

/** The position of the chord atom `id`. */
function chordAt(doc: Node, id: string): number {
  for (const section of sectionsOf(doc)) {
    const found = chordsOf(section.node, section.pos).find(entry => entry.attrs.id === id);
    if (found) return found.pos;
  }
  throw new Error(`No chord ${id}`);
}
