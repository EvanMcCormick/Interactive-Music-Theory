import { DOMParser, DOMSerializer, Fragment, Node, Slice } from 'prosemirror-model';
import { AllSelection, EditorState } from 'prosemirror-state';
import { ChordSlot, ProgressionKey, createDegreeSlot } from '../models/progression.model';
import { ChordAtomAttrs, SongMeta } from '../models/song.model';
import { regenerateSlot } from './progression-edit';
import { NEW_SECTION, songSchema } from './song-schema';

/**
 * The song's schema: what a song document can hold, how it goes to JSON and
 * back, and how its nodes survive the clipboard.
 *
 * Headless: ProseMirror's model needs no view. The clipboard specs use the
 * schema's own `DOMSerializer` and `DOMParser`, which are the two halves the
 * editor's copy and paste run through - Karma's Chrome supplies the document.
 */
const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const IONIAN = [0, 2, 4, 5, 7, 9, 11];

const META: SongMeta = {
  title: 'Last Dance',
  artist: 'The Band',
  key: C_MAJOR,
  tempo: 100,
  timeSignature: { numerator: 4, denominator: 4, isCommon: true }
};

/** A chord atom's attributes, as a slot in C major really carries them: voiced, one bar long. */
function chordAttrs(degree: number): ChordAtomAttrs {
  const slot: ChordSlot = regenerateSlot(createDegreeSlot(degree, 0), C_MAJOR, IONIAN);
  return { id: slot.id, harmony: slot.harmony, lengthBeats: slot.lengthBeats, notes: slot.notes, owned: slot.owned };
}

function chordNode(degree: number): Node {
  return songSchema.node('chord', chordAttrs(degree));
}

function line(...content: (string | Node)[]): Node {
  return songSchema.node(
    'lyricLine',
    null,
    content.map(part => (typeof part === 'string' ? songSchema.text(part) : part))
  );
}

function section(id: string, label: string, ...children: Node[]): Node {
  return songSchema.node('section', { id, label, kind: 'verse' }, children);
}

function song(...sections: Node[]): Node {
  return songSchema.node('doc', META, sections);
}

/** Every chord atom in a node or a slice's content, in document order. */
function chordsIn(node: Node | Fragment): Node[] {
  const found: Node[] = [];
  node.descendants(child => {
    if (child.type.name === 'chord') found.push(child);
  });
  return found;
}

/** A slice through the schema's clipboard serializer and parser, as copy then paste moves it. */
function throughClipboard(slice: Slice): Slice {
  const container = document.createElement('div');
  container.appendChild(DOMSerializer.fromSchema(songSchema).serializeFragment(slice.content));
  return DOMParser.fromSchema(songSchema).parseSlice(container);
}

describe('songSchema', () => {
  describe('JSON', () => {
    it('round-trips a song with sections, words, chords, a tab block and a memo', () => {
      const original = song(
        section('s1', 'Verse 1', line(chordNode(5), 'Wondering ', chordNode(3), 'where the'), line()),
        section(
          's2',
          'Chorus',
          songSchema.node('tabBlock', {
            id: 't1',
            name: 'Riff',
            score: { title: '', subTitle: '', artist: '', album: '', tempo: 100, masterBars: [], tracks: [] }
          }),
          songSchema.node('memo', { id: 'm1', name: 'Hum', durationSec: 12.5 })
        )
      );

      const json = original.toJSON();
      const restored = Node.fromJSON(songSchema, JSON.parse(JSON.stringify(json)));

      expect(restored.eq(original)).toBeTrue();
      expect(restored.toJSON()).toEqual(json);
      expect(() => restored.check()).not.toThrow();
    });

    it('keeps the song facts on the doc node, so they share the words\' undo history', () => {
      const json = song(section('s1', 'Verse 1', line())).toJSON();

      expect(json.attrs).toEqual(META);
    });

    it('stores a chord without a startBeat: it is derived, and one handed in is dropped', () => {
      const withStart = { ...chordAttrs(0), startBeat: 8 };
      const chord = songSchema.node('chord', withStart);

      expect('startBeat' in chord.attrs).toBeFalse();
      expect(chord.toJSON().attrs).toEqual(withoutStartBeat(withStart));
    });
  });

  describe('content', () => {
    it('refuses a song with no section', () => {
      expect(() => songSchema.node('doc', META, []).check()).toThrowError(/doc/);
    });

    it('fills an empty section with one empty lyric line, which is where its caret goes', () => {
      const filled = songSchema.nodes['section'].createAndFill({ id: 's1', label: 'Chorus', kind: 'chorus' });

      expect(filled?.childCount).toBe(1);
      expect(filled?.firstChild?.type.name).toBe('lyricLine');
      expect(filled?.firstChild?.content.size).toBe(0);
    });

    it('leaves one empty lyric line when everything in a section is deleted', () => {
      const doc = song(section('s1', 'Verse 1', line('one'), line('two')), section('s2', 'Chorus', line('three')));
      const first = doc.child(0);

      const after = EditorState.create({ doc }).tr.delete(1, 1 + first.content.size).doc;

      expect(after.child(0).attrs['id']).toBe('s1');
      expect(after.child(0).childCount).toBe(1);
      expect(after.child(0).firstChild?.content.size).toBe(0);
      expect(after.child(1).textContent).toBe('three');
    });

    it('generates a new song\'s first section, without an id, when everything is deleted', () => {
      const doc = song(section('s1', 'Verse 1', line('one')), section('s2', 'Chorus', line('two')));
      const state = EditorState.create({ doc });

      const after = state.apply(state.tr.setSelection(new AllSelection(state.doc)).deleteSelection()).doc;

      expect(after.childCount).toBe(1);
      expect(after.child(0).attrs).toEqual({ id: null, label: NEW_SECTION.label, kind: NEW_SECTION.kind });
    });

    it('holds text and chords in a lyric line, and no marks', () => {
      const lyric = line(chordNode(0), 'Got me ', chordNode(3), 'thinking');

      expect(() => lyric.check()).not.toThrow();
      expect(songSchema.nodes['lyricLine'].spec.marks).toBe('');
    });

    it('refuses text directly in a section', () => {
      const attrs = { id: 's1', label: 'Verse 1', kind: 'verse' };

      expect(() => songSchema.node('section', attrs, [songSchema.text('loose')])).toThrowError(/section/);
    });
  });

  describe('attributes', () => {
    it('refuses a chord whose degree is outside the scale', () => {
      const attrs = chordAttrs(0);
      const harmony = { kind: 'degree', degree: { ...degreeOf(attrs), degree: 9 } };

      expect(() => songSchema.node('chord', { ...attrs, harmony })).toThrowError(/harmony/);
    });

    it('refuses a chord whose harmony is not one of the two kinds', () => {
      expect(() => songSchema.node('chord', { ...chordAttrs(0), harmony: { kind: 'guess' } })).toThrowError(/harmony/);
      expect(() => songSchema.node('chord', { ...chordAttrs(0), harmony: 'C' })).toThrowError(/harmony/);
    });

    it('refuses a chord with a note that is not a MIDI number, or with no id', () => {
      const notes = [{ midi: 60.5, startBeat: 0, lengthBeats: 4, velocity: 80 }];

      expect(() => songSchema.node('chord', { ...chordAttrs(0), notes })).toThrowError(/notes/);
      expect(() => songSchema.node('chord', { ...chordAttrs(0), id: '' })).toThrowError(/id/);
    });

    it('refuses a section kind it does not know', () => {
      const attrs = { id: 's1', label: 'Verse', kind: 'refrain' };

      expect(() => songSchema.node('section', attrs, [line()])).toThrowError(/kind/);
    });

    it('refuses a song key, tempo or time signature that could not be played', () => {
      const sections = [section('s1', 'Verse 1', line())];
      const songWith = (meta: Partial<SongMeta>): Node => songSchema.node('doc', { ...META, ...meta }, sections);

      expect(() => songWith({ key: { ...C_MAJOR, tonic: 12 } })).toThrowError(/key/);
      expect(() => songWith({ tempo: 1000 })).toThrowError(/tempo/);
      expect(() => songWith({ timeSignature: { numerator: 4, denominator: 3, isCommon: false } })).toThrowError(
        /time signature/
      );
    });

    it('checks an attribute set by a step, not only one given at creation', () => {
      const doc = song(section('s1', 'Verse 1', line(chordNode(0))));
      const tr = EditorState.create({ doc }).tr;

      expect(() => tr.setNodeAttribute(2, 'lengthBeats', Number.NaN)).toThrowError(/lengthBeats/);
    });
  });

  describe('the clipboard', () => {
    it('carries a chord\'s whole slot through copy and paste', () => {
      const doc = song(section('s1', 'Verse 1', line('Wondering ', chordNode(5), 'where')));
      const copied = doc.slice(2, 2 + 'Wondering '.length + 1 + 'where'.length);

      const pasted = throughClipboard(copied);
      const [chord] = chordsIn(pasted.content);

      expect(chord.attrs).toEqual(chordsIn(doc)[0].attrs);
      expect(pasted.content.textBetween(0, pasted.content.size)).toBe('Wondering where');
    });

    it('carries a whole section, its label and kind included', () => {
      const doc = song(
        section('s1', 'Verse 1', line('one')),
        songSchema.node('section', { id: 's2', label: 'Chorus 2', kind: 'chorus' }, [line(chordNode(0), 'two')])
      );
      const second = doc.child(0).nodeSize;

      const pasted = throughClipboard(doc.slice(second, doc.content.size));

      expect(pasted.content.firstChild?.attrs).toEqual({ id: 's2', label: 'Chorus 2', kind: 'chorus' });
      expect(chordsIn(pasted.content).length).toBe(1);
    });

    it('drops a chord whose data cannot be read, rather than inventing one', () => {
      const container = document.createElement('div');
      container.innerHTML =
        '<p>one <span data-chord="{not json">x</span>two <span data-chord=\'{"id":"c"}\'></span>three</p>';

      const pasted = DOMParser.fromSchema(songSchema).parseSlice(container);

      expect(chordsIn(pasted.content).length).toBe(0);
      expect(pasted.content.textBetween(0, pasted.content.size)).toBe('one xtwo three');
    });

    it('reads a plain paragraph from elsewhere as a lyric line', () => {
      const container = document.createElement('div');
      container.innerHTML = '<p>Got me thinking</p>';

      const pasted = DOMParser.fromSchema(songSchema).parseSlice(container);

      expect(pasted.content.firstChild?.type.name).toBe('lyricLine');
      expect(pasted.content.firstChild?.textContent).toBe('Got me thinking');
    });
  });
});

function degreeOf(attrs: ChordAtomAttrs): object {
  if (attrs.harmony.kind !== 'degree') throw new Error('expected a degree slot');
  return attrs.harmony.degree;
}

/** The attributes the schema keeps from a set that also carried a `startBeat`. */
function withoutStartBeat(attrs: ChordAtomAttrs & { startBeat: number }): ChordAtomAttrs {
  return { id: attrs.id, harmony: attrs.harmony, lengthBeats: attrs.lengthBeats, notes: attrs.notes, owned: attrs.owned };
}
