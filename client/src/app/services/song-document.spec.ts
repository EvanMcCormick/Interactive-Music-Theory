import { DOMParser, DOMSerializer, Node } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import {
  ChordDegree,
  ChordSlot,
  ProgressionKey,
  createDefaultProgression,
  createDegreeSlot
} from '../models/progression.model';
import { ChordAtomAttrs, SongDoc, SongMeta } from '../models/song.model';
import { DeriveState, ProgressionStore } from './progression-history';
import { regenerateSlot, requireUniqueSlotIds, settle } from './progression-edit';
import {
  chordSlotOf,
  chordsOf,
  createSectionNode,
  createSongContent,
  createSongIdsPlugin,
  idRepairsOf,
  sectionProgressionOf,
  sectionsOf,
  songMetaOf,
  songNodeOf,
  songSummaryOf
} from './song-document';
import { songSchema } from './song-schema';

/**
 * The song document's derivations and constructors, headless.
 *
 * Every spec builds its document through the schema, or as stored JSON for the
 * validation specs, and runs transactions on a bare `EditorState`: nothing here
 * needs a view.
 */
const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const A_MINOR: ProgressionKey = { tonic: 9, scaleId: 'aeolian', preferSharps: false };
const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const FOUR_FOUR = { numerator: 4, denominator: 4, isCommon: true };
const THREE_FOUR = { numerator: 3, denominator: 4, isCommon: false };

const META: SongMeta = { title: 'Last Dance', artist: 'The Band', key: C_MAJOR, tempo: 100, timeSignature: FOUR_FOUR };

/** A chord atom for a C major degree, `lengthBeats` long and voiced. */
function chordNode(degree: number, lengthBeats = 4): Node {
  const slot: ChordSlot = regenerateSlot({ ...createDegreeSlot(degree, 0), lengthBeats }, C_MAJOR, IONIAN);
  const attrs: ChordAtomAttrs = {
    id: slot.id,
    harmony: slot.harmony,
    lengthBeats: slot.lengthBeats,
    notes: slot.notes,
    owned: slot.owned
  };
  return songSchema.node('chord', attrs);
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

function song(meta: SongMeta, ...sections: Node[]): Node {
  return songSchema.node('doc', meta, sections);
}

function degreeOf(slot: { harmony: ChordSlot['harmony'] }): ChordDegree {
  if (slot.harmony.kind !== 'degree') throw new Error('expected a degree slot');
  return slot.harmony.degree;
}

function storedSong(content: Readonly<Record<string, unknown>>): SongDoc {
  return { id: 'song-1', revision: 3, createdAt: 1000, updatedAt: 2000, content };
}

describe('createSongContent', () => {
  it('starts a song on one "Verse 1" with one empty line, in C major at 100 BPM in 4/4', () => {
    const doc = createSongContent();

    expect(songMetaOf(doc)).toEqual({ title: '', artist: '', key: C_MAJOR, tempo: 100, timeSignature: FOUR_FOUR });
    expect(sectionsOf(doc).map(({ label, kind }) => ({ label, kind }))).toEqual([{ label: 'Verse 1', kind: 'verse' }]);
    expect(doc.child(0).childCount).toBe(1);
    expect(doc.child(0).child(0).type.name).toBe('lyricLine');
    expect(doc.child(0).child(0).content.size).toBe(0);
  });

  it('takes what the meta says over the defaults', () => {
    const doc = createSongContent({ title: 'Waltz', key: A_MINOR, timeSignature: THREE_FOUR });

    expect(songMetaOf(doc)).toEqual({ title: 'Waltz', artist: '', key: A_MINOR, tempo: 100, timeSignature: THREE_FOUR });
  });

  it('gives each new song its own section id, and a song that reads back', () => {
    const first = createSongContent();
    const second = createSongContent();

    expect(sectionsOf(first)[0].id).not.toEqual(sectionsOf(second)[0].id);
    expect(songNodeOf(first.toJSON()).kind).toBe('song');
  });
});

describe('createSectionNode', () => {
  it('builds a section with a fresh id, its label and kind, and one empty line', () => {
    const chorus = createSectionNode('Chorus', 'chorus');

    expect(chorus.attrs['id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(chorus.attrs['label']).toBe('Chorus');
    expect(chorus.attrs['kind']).toBe('chorus');
    expect(chorus.childCount).toBe(1);
    expect(createSectionNode('Chorus', 'chorus').attrs['id']).not.toBe(chorus.attrs['id']);
  });
});

describe('songNodeOf', () => {
  const good = (): Record<string, unknown> =>
    song(META, section('s1', 'Verse 1', line(chordNode(0), 'one ', chordNode(4), 'two')), section('s2', 'Chorus', line())).toJSON();

  /** The stored JSON with one part replaced, built as a corrupt record would be. */
  function corrupted(edit: (json: Record<string, any>) => void): Record<string, unknown> {
    const json = JSON.parse(JSON.stringify(good()));
    edit(json);
    return json;
  }

  function reasonFor(json: unknown): string {
    const reading = songNodeOf(json);
    if (reading.kind !== 'refused') throw new Error('expected a refusal');
    return reading.reason;
  }

  it('reads a stored song back into the document it was', () => {
    const original = song(META, section('s1', 'Verse 1', line(chordNode(0), 'one')));

    const reading = songNodeOf(JSON.parse(JSON.stringify(original.toJSON())));

    expect(reading.kind).toBe('song');
    expect(reading.kind === 'song' && reading.doc.eq(original)).toBeTrue();
  });

  it('refuses something that is not a document at all', () => {
    expect(reasonFor(null)).toMatch(/Invalid input/);
    expect(reasonFor('a song')).toMatch(/node type/);
    expect(reasonFor({ type: 'chorus' })).toMatch(/chorus/);
  });

  it('refuses a part of a song stored as if it were a whole one', () => {
    const lone = section('s1', 'Verse 1', line('one')).toJSON();

    expect(reasonFor(lone)).toMatch(/not a song/);
  });

  it('refuses a song with no sections, or a section with nothing in it', () => {
    expect(reasonFor(corrupted(json => (json['content'] = [])))).toMatch(/doc/);
    expect(reasonFor(corrupted(json => (json['content'][1]['content'] = [])))).toMatch(/section/);
  });

  it('refuses text with marks the schema does not have', () => {
    const reason = reasonFor(
      corrupted(json => (json['content'][0]['content'][0]['content'][1]['marks'] = [{ type: 'strong' }]))
    );

    expect(reason).toMatch(/strong/);
  });

  it('refuses song facts that are missing or unplayable', () => {
    expect(reasonFor(corrupted(json => delete json['attrs']['key']))).toMatch(/key/);
    expect(reasonFor(corrupted(json => (json['attrs']['key']['tonic'] = 1.5)))).toMatch(/key/);
    expect(reasonFor(corrupted(json => (json['attrs']['tempo'] = '100')))).toMatch(/tempo/);
    expect(reasonFor(corrupted(json => (json['attrs']['timeSignature'] = { numerator: 0 })))).toMatch(/time signature/);
    expect(reasonFor(corrupted(json => (json['attrs']['title'] = 7)))).toMatch(/title/);
  });

  it('refuses a section with no id, or a kind it does not know', () => {
    expect(reasonFor(corrupted(json => (json['content'][0]['attrs']['id'] = null)))).toMatch(/no id/);
    expect(reasonFor(corrupted(json => (json['content'][0]['attrs']['kind'] = 'refrain')))).toMatch(/kind/);
  });

  it('refuses a chord the progression model would refuse', () => {
    const chordAt = (json: Record<string, any>): Record<string, any> => json['content'][0]['content'][0]['content'][0];

    expect(reasonFor(corrupted(json => (chordAt(json)['attrs']['harmony']['degree']['degree'] = 7)))).toMatch(/harmony/);
    expect(reasonFor(corrupted(json => (chordAt(json)['attrs']['notes'] = 'C E G')))).toMatch(/notes/);
    expect(reasonFor(corrupted(json => (chordAt(json)['attrs']['owned'] = { pitches: 'yes' })))).toMatch(/owned/);
    expect(reasonFor(corrupted(json => delete chordAt(json)['attrs']['lengthBeats']))).toMatch(/lengthBeats/);
  });

  it('refuses two sections that share an id', () => {
    expect(reasonFor(corrupted(json => (json['content'][1]['attrs']['id'] = 's1')))).toMatch(/s1.*more than once/);
  });

  it('refuses two chords that share an id, even in different sections', () => {
    const doc = song(META, section('s1', 'Verse 1', line(chordNode(0))), section('s2', 'Chorus', line(chordNode(4))));
    const json = JSON.parse(JSON.stringify(doc.toJSON()));
    const firstId: string = json['content'][0]['content'][0]['content'][0]['attrs']['id'];
    json['content'][1]['content'][0]['content'][0]['attrs']['id'] = firstId;

    expect(reasonFor(json)).toMatch(new RegExp(`${firstId}.*more than once`));
  });

  it('never throws, whatever it is handed', () => {
    for (const json of [undefined, 0, [], { type: 'doc' }, { type: 'doc', attrs: META, content: 'x' }]) {
      expect(() => songNodeOf(json)).not.toThrow();
      expect(songNodeOf(json).kind).toBe('refused');
    }
  });
});

describe('sectionsOf and chordsOf', () => {
  const am = chordNode(5);
  const f = chordNode(3);
  const c = chordNode(0);
  const doc = song(
    META,
    section('s1', 'Verse 1', line(am, 'Wondering ', f, 'where the'), line('second line')),
    songSchema.node('section', { id: 's2', label: 'Chorus', kind: 'chorus' }, [line(c, 'Got me')])
  );

  it('lists each section with its id, label, kind and position', () => {
    const sections = sectionsOf(doc);

    expect(sections.map(({ id, label, kind }) => ({ id, label, kind }))).toEqual([
      { id: 's1', label: 'Verse 1', kind: 'verse' },
      { id: 's2', label: 'Chorus', kind: 'chorus' }
    ]);
    for (const entry of sections) expect(doc.nodeAt(entry.pos)).toBe(entry.node);
  });

  it('lists a section\'s chords in document order, at their positions in the document', () => {
    const [verse, chorus] = sectionsOf(doc);

    const verseChords = chordsOf(verse.node, verse.pos);
    const chorusChords = chordsOf(chorus.node, chorus.pos);

    expect(verseChords.map(entry => entry.attrs.id)).toEqual([am.attrs['id'], f.attrs['id']]);
    expect(chorusChords.map(entry => entry.attrs.id)).toEqual([c.attrs['id']]);
    for (const entry of [...verseChords, ...chorusChords]) {
      expect(doc.nodeAt(entry.pos)?.attrs['id']).toBe(entry.attrs.id);
    }
  });
});

describe('sectionProgressionOf', () => {
  const am = chordNode(5, 4);
  const f = chordNode(3, 2);
  const g = chordNode(4, 6);
  const doc = song(
    META,
    section('s1', 'Verse 1', line(am, 'Wondering ', f, 'where the'), line(g, 'lights go')),
    section('s2', 'Chorus', line(chordNode(0), 'Got me'))
  );

  it('is the section\'s chords in order, with their start beats summed', () => {
    const progression = sectionProgressionOf(doc, 's1');

    expect(progression?.slots.map(slot => slot.id)).toEqual([am.attrs['id'], f.attrs['id'], g.attrs['id']]);
    expect(progression?.slots.map(slot => slot.startBeat)).toEqual([0, 4, 6]);
    expect(progression?.slots.map(slot => slot.lengthBeats)).toEqual([4, 2, 6]);
    expect(progression?.slots[0].notes).toEqual(am.attrs['notes']);
  });

  it('carries the song\'s key, tempo and time signature, and a name from both titles', () => {
    const waltz = song({ ...META, key: A_MINOR, tempo: 84, timeSignature: THREE_FOUR }, section('s1', 'Bridge', line()));

    const progression = sectionProgressionOf(waltz, 's1');

    expect(progression?.key).toEqual(A_MINOR);
    expect(progression?.tempo).toBe(84);
    expect(progression?.timeSignature).toEqual(THREE_FOUR);
    expect(progression?.name).toBe('Last Dance — Bridge');
    expect(progression?.slots).toEqual([]);
  });

  it('names an untitled song\'s section so it still reads as a song\'s', () => {
    const untitled = song({ ...META, title: '  ' }, section('s1', 'Verse 1', line()));

    expect(sectionProgressionOf(untitled, 's1')?.name).toBe('Untitled song — Verse 1');
  });

  it('is identified by the section, the same every time, at revision 0', () => {
    expect(sectionProgressionOf(doc, 's1')?.id).toBe('s1');
    expect(sectionProgressionOf(doc, 's1')).toEqual(sectionProgressionOf(doc, 's1'));
    expect(sectionProgressionOf(doc, 's1')?.revision).toBe(0);
  });

  it('is null for a section the song does not have', () => {
    expect(sectionProgressionOf(doc, 'nope')).toBeNull();
  });

  it('reorders when a chord is moved to another word, and keeps the moved chord\'s length', () => {
    const verse = sectionsOf(doc)[0];
    const [amAt, , gAt] = chordsOf(verse.node, verse.pos);
    const state = EditorState.create({ doc });

    // Am to the start of the second line, after G: delete it, then insert it
    // where G's position has been mapped to, one past G.
    const tr = state.tr.delete(amAt.pos, amAt.pos + 1);
    const target = tr.mapping.map(gAt.pos) + 1;
    tr.insert(target, am);

    const progression = sectionProgressionOf(tr.doc, 's1');

    expect(progression?.slots.map(slot => slot.id)).toEqual([f.attrs['id'], g.attrs['id'], am.attrs['id']]);
    expect(progression?.slots.map(slot => slot.startBeat)).toEqual([0, 2, 8]);
  });

  it('is already what the progression store would settle it to, so it can be handed over as is', () => {
    const progression = sectionProgressionOf(doc, 's1');
    if (progression === null) throw new Error('expected a progression');

    expect(settle(progression)).toEqual(progression);
    expect(() => requireUniqueSlotIds(progression)).not.toThrow();

    const derive: DeriveState = (current, selectedSlotId, isDirty, history, relabel) => ({
      doc: current,
      selectedSlotId,
      relabel,
      canBuildChords: true,
      keyScale: null,
      isDirty,
      canUndo: history.canUndo,
      canRedo: history.canRedo
    });
    const store = new ProgressionStore(createDefaultProgression(), derive);
    store.replaceDocument(progression, true);
    expect(store.doc.slots).toEqual(progression.slots);
  });

  it('shares nothing with the document it was read from', () => {
    const progression = sectionProgressionOf(doc, 's1');
    if (progression === null) throw new Error('expected a progression');

    expect(progression.timeSignature).not.toBe(doc.attrs['timeSignature']);
    expect(progression.key).not.toBe(doc.attrs['key']);
    expect(progression.slots[0].harmony).not.toBe(am.attrs['harmony']);
    expect(progression.slots[0].notes).not.toBe(am.attrs['notes']);
  });
});

describe('songSummaryOf', () => {
  it('lists a song\'s title, artist, key, section count and when it was last written', () => {
    const doc = song(META, section('s1', 'Verse 1', line()), section('s2', 'Chorus', line()));

    expect(songSummaryOf(storedSong(doc.toJSON()))).toEqual({
      id: 'song-1',
      title: 'Last Dance',
      artist: 'The Band',
      key: C_MAJOR,
      sectionCount: 2,
      updatedAt: 2000,
      unreadable: null
    });
  });

  it('still lists a song it cannot open, with whatever title it can read and the reason', () => {
    const json = JSON.parse(JSON.stringify(song(META, section('s1', 'Verse 1', line())).toJSON()));
    json['content'] = [];

    const summary = songSummaryOf(storedSong(json));

    expect(summary.title).toBe('Last Dance');
    expect(summary.artist).toBe('The Band');
    expect(summary.key).toBeNull();
    expect(summary.sectionCount).toBe(0);
    expect(summary.unreadable).toMatch(/doc/);
  });

  it('lists a record with no readable title at all under an empty one', () => {
    const summary = songSummaryOf(storedSong({ type: 'doc', attrs: { title: 42 } }));

    expect(summary.title).toBe('');
    expect(summary.artist).toBe('');
    expect(summary.unreadable).not.toBeNull();
  });
});

describe('chordSlotOf', () => {
  const vi: ChordDegree = degreeOf(createDegreeSlot(5, 0));

  it('makes a chord one bar long in the song\'s time signature', () => {
    expect(chordSlotOf(vi, C_MAJOR, IONIAN, FOUR_FOUR).lengthBeats).toBe(4);
    expect(chordSlotOf(vi, C_MAJOR, IONIAN, THREE_FOUR).lengthBeats).toBe(3);
    // A bar of 6/8 is three quarter notes: the progression's beat is a quarter.
    expect(chordSlotOf(vi, C_MAJOR, IONIAN, { numerator: 6, denominator: 8, isCommon: false }).lengthBeats).toBe(3);
  });

  it('voices the chord, so it sounds before anything else touches it', () => {
    const slot = chordSlotOf(vi, C_MAJOR, IONIAN, THREE_FOUR);

    // A minor from middle C: A, C, E in root position above A3... as the
    // generator voices vi in C: its root's pitch class first, then up.
    expect(slot.notes.map(note => note.midi % 12)).toEqual([9, 0, 4]);
    expect(slot.notes.every(note => note.lengthBeats === 3 && note.startBeat === 0)).toBeTrue();
  });

  it('keeps the whole degree it was given, suspension and extensions included', () => {
    const sus: ChordDegree = { ...degreeOf(createDegreeSlot(4, 0)), extent: 7, suspension: 'sus4' };

    const slot = chordSlotOf(sus, C_MAJOR, IONIAN, FOUR_FOUR);

    expect(degreeOf(slot)).toEqual(sus);
    expect(slot.notes.map(note => note.midi % 12)).toEqual([7, 0, 2, 5]);
  });

  it('gives every chord a fresh id, owns nothing, and stores no startBeat', () => {
    const first = chordSlotOf(vi, C_MAJOR, IONIAN, FOUR_FOUR);
    const second = chordSlotOf(vi, C_MAJOR, IONIAN, FOUR_FOUR);

    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.id).not.toBe(second.id);
    expect(first.owned).toEqual({ pitches: false, timing: false, velocity: false });
    expect('startBeat' in first).toBeFalse();
    expect(() => songSchema.node('chord', first)).not.toThrow();
  });
});

describe('ids', () => {
  const plugins = [createSongIdsPlugin()];

  function idsIn(doc: Node): (string | null)[] {
    const ids: (string | null)[] = [];
    doc.descendants(node => {
      if ('id' in node.attrs) ids.push(node.attrs['id']);
    });
    return ids;
  }

  it('gives a pasted copy of a chord a fresh id, and leaves the original its own', () => {
    const am = chordNode(5);
    const doc = song(META, section('s1', 'Verse 1', line(am, 'Wondering where')));
    const state = EditorState.create({ doc, plugins });
    const copied = doc.slice(2, 3);

    const end = 2 + 1 + 'Wondering where'.length;
    const after = state.apply(state.tr.setSelection(TextSelection.create(doc, end)).replaceSelection(copied)).doc;

    const [original, copy] = chordsOf(after.child(0), 0);
    expect(original.attrs.id).toBe(am.attrs['id']);
    expect(copy.attrs.id).not.toBe(am.attrs['id']);
    expect({ ...copy.attrs, id: '' }).toEqual({ ...original.attrs, id: '' });
  });

  it('gives a chord copied and pasted through the clipboard a fresh id, its slot otherwise whole', () => {
    const am = chordNode(5);
    const doc = song(META, section('s1', 'Verse 1', line(am, 'Wondering')));
    const state = EditorState.create({ doc, plugins });
    const container = document.createElement('div');
    container.appendChild(DOMSerializer.fromSchema(songSchema).serializeFragment(doc.slice(2, 3).content));
    const pasted = DOMParser.fromSchema(songSchema).parseSlice(container);

    const end = 2 + 1 + 'Wondering'.length;
    const after = state.apply(state.tr.setSelection(TextSelection.create(doc, end)).replaceSelection(pasted)).doc;

    const [original, copy] = chordsOf(after.child(0), 0);
    expect(original.attrs.id).toBe(am.attrs['id']);
    expect(copy.attrs.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(copy.attrs.id).not.toBe(am.attrs['id']);
    expect({ ...copy.attrs, id: '' }).toEqual({ ...original.attrs, id: '' });
  });

  it('keeps the original\'s id when the copy is pasted in front of it', () => {
    const am = chordNode(5);
    const doc = song(META, section('s1', 'Verse 1', line(am, 'Wondering')));
    const state = EditorState.create({ doc, plugins });

    const after = state.apply(state.tr.insert(2, doc.slice(2, 3).content)).doc;

    const [copy, original] = chordsOf(after.child(0), 0);
    expect(original.attrs.id).toBe(am.attrs['id']);
    expect(copy.attrs.id).not.toBe(am.attrs['id']);
  });

  it('keeps a moved chord\'s id: a move leaves one of it', () => {
    const am = chordNode(5);
    const doc = song(META, section('s1', 'Verse 1', line(am, 'Wondering where')));
    const state = EditorState.create({ doc, plugins });

    const tr = state.tr.delete(2, 3);
    tr.insert(tr.mapping.map(2) + 5, am);
    const after = state.apply(tr).doc;

    expect(chordsOf(after.child(0), 0).map(entry => entry.attrs.id)).toEqual([am.attrs['id']]);
  });

  it('gives the second half of a split section its own id', () => {
    const doc = song(META, section('s1', 'Verse 1', line('one'), line('two')));
    const state = EditorState.create({ doc, plugins });
    const between = 1 + doc.child(0).child(0).nodeSize;

    const after = state.apply(state.tr.split(between)).doc;

    expect(after.childCount).toBe(2);
    expect(after.child(0).attrs['id']).toBe('s1');
    expect(after.child(1).attrs['id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('gives a section ProseMirror generated an id', () => {
    const doc = song(META, section('s1', 'Verse 1', line('one')));
    const state = EditorState.create({ doc, plugins });

    const after = state.apply(state.tr.delete(0, doc.content.size)).doc;

    expect(idsIn(after)).toEqual([jasmine.stringMatching(/^[0-9a-f-]{36}$/)]);
    expect(songNodeOf(after.toJSON()).kind).toBe('song');
  });

  it('names exactly the positions that need a fresh id', () => {
    const am = chordNode(5);
    const doc = song(META, section('s1', 'Verse 1', line(am, 'one')));
    const state = EditorState.create({ doc });
    const tr = state.tr.insert(6, doc.slice(2, 3).content);

    expect(idRepairsOf(doc, tr.doc, tr.mapping)).toEqual([6]);
    expect(idRepairsOf(doc, doc, state.tr.mapping)).toEqual([]);
  });
});
