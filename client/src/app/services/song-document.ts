import { Node } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { Mappable, Mapping } from 'prosemirror-transform';
import type { TimeSignature } from '../models/composer.model';
import {
  ChordDegree,
  ChordSlot,
  ProgressionDoc,
  ProgressionKey,
  createDegreeSlot
} from '../models/progression.model';
import {
  ChordAtomAttrs,
  SectionKind,
  SongDoc,
  SongMeta,
  SongSummary
} from '../models/song.model';
import { messageOf } from './error-message';
import { regenerateSlot, settle } from './progression-edit';
import { barBeats } from './progression-score';
import { NEW_SECTION, songSchema } from './song-schema';

/**
 * Reading and building song documents: the derivations over `songSchema`, and
 * the few constructors that make new nodes.
 *
 * Pure but for ids. Every function here reads a document and returns a value,
 * except the constructors, which also draw fresh UUIDs - `createSongContent`,
 * `createSectionNode`, `chordSlotOf` - and the id plugin, which writes them.
 * Nothing here holds state: the document is the state (design Part 1), and
 * everything a page shows about a song - its sections, a section's
 * progression, its library card - is derived from it on demand and never
 * stored (design Part 8).
 */

/** What a document read from storage turned out to be. */
export type SongReading = { kind: 'song'; doc: Node } | { kind: 'refused'; reason: string };

/** A section, where it is, and the facts a header or a menu needs. */
export interface SongSection {
  id: string;
  label: string;
  kind: SectionKind;
  /** The document position just before the section, so `doc.nodeAt(pos)` is `node`. */
  pos: number;
  node: Node;
}

/** A chord atom and its document position (`doc.nodeAt(pos)` is the atom). */
export interface ChordAt {
  attrs: ChordAtomAttrs;
  pos: number;
}

/** What a song with no title yet is called where it needs a name: its progressions, its copy's title. */
export const UNTITLED_SONG = 'Untitled song';

/** The node types that carry an `id`, and so must carry a unique one. */
const IDENTIFIED: ReadonlySet<string> = new Set(['section', 'chord', 'tabBlock', 'memo']);

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/**
 * The facts a new song starts with: untitled, C major, 100 BPM, 4/4.
 *
 * 100 rather than the progression page's 120 because a song starts at a
 * singing tempo, and the design's mock-up (Part 2) shows it. C ionian with
 * `preferSharps: true` is `createDefaultProgression`'s key and the reason is
 * the same - it is what `MusicTheoryService` starts on and what `setKey` would
 * derive for an empty signature. The title is empty rather than a placeholder
 * word, so "not named yet" is blankness and the page can show a hint for it.
 */
function newSongMeta(): SongMeta {
  return {
    title: '',
    artist: '',
    key: { tonic: 0, scaleId: 'ionian', preferSharps: true },
    tempo: 100,
    timeSignature: { numerator: 4, denominator: 4, isCommon: true }
  };
}

/**
 * A new song: the defaults above under whatever `meta` says, and one "Verse 1"
 * holding one empty lyric line for the caret.
 *
 * Returns the node, not JSON: the editor needs the node, and the one caller
 * that stores it calls `toJSON()` once.
 */
export function createSongContent(meta: Partial<SongMeta> = {}): Node {
  return songSchema.node('doc', { ...newSongMeta(), ...meta }, [
    createSectionNode(NEW_SECTION.label, NEW_SECTION.kind)
  ]);
}

/** A section with a fresh id, holding one empty lyric line. */
export function createSectionNode(label: string, kind: SectionKind): Node {
  return songSchema.node('section', { id: crypto.randomUUID(), label, kind }, [
    songSchema.node('lyricLine')
  ]);
}

/**
 * A new chord atom's attributes: `degree` in `key`, one bar of the song's time
 * signature long, voiced, owning nothing, with a fresh id.
 *
 * Built through `createDegreeSlot` and `regenerateSlot` - the progression
 * page's own road to a slot - so a chord placed on the sheet is the same object
 * the palette would have made, and its notes are there before anything plays
 * it. Two things differ from the factory's defaults, on purpose:
 *
 * - **The whole `degree` is written**, not only its index: a typed `Gsus4` or
 *   `G7b9` keeps its suspension and extensions, which `chosen` would clear.
 * - **The length is one bar of the song's meter** (`barBeats`), not
 *   `createDegreeSlot`'s fixed 4, which is one bar only in 4/4. Beats are
 *   quarter notes, as everywhere in the progression model, so 3/4 gives 3 and
 *   6/8 gives 3 too.
 *
 * The id is `createDegreeSlot`'s, which is `crypto.randomUUID()`: fresh per
 * call. `scaleIntervals` null - a key whose scale cannot build chords - leaves
 * the notes empty, as `regenerateSlot` does; the sheet refuses chord entry in
 * such a key before it gets here.
 */
export function chordSlotOf(
  degree: ChordDegree,
  key: ProgressionKey,
  scaleIntervals: readonly number[] | null,
  timeSignature: TimeSignature
): ChordAtomAttrs {
  const fresh = createDegreeSlot(degree.degree, 0);
  const slot = regenerateSlot(
    { ...fresh, harmony: { kind: 'degree', degree }, lengthBeats: barBeats(timeSignature) },
    key,
    scaleIntervals
  );
  return atomAttrsOf(slot);
}

/**
 * A slot's atom attributes. Listed rather than spread, so a field `ChordSlot`
 * gains is a compile error here rather than a field the atom silently drops,
 * and a slot's `startBeat` - derived, never stored - is left behind.
 *
 * Exported for the song commands, which take a chord atom through the
 * progression model's slot functions and back.
 */
export function atomAttrsOf(slot: ChordSlot): ChordAtomAttrs {
  return { id: slot.id, harmony: slot.harmony, lengthBeats: slot.lengthBeats, notes: slot.notes, owned: slot.owned };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * A stored song's content as a document, or the reason it cannot be one.
 *
 * Never throws: a corrupt record is a fact to report, not a crash. Everything
 * the schema checks (see `song-schema.ts`) runs here through
 * `Node.fromJSON` and `Node.check()`, and this adds the two rules a schema
 * cannot state: the top node must be a song, and every id must be present and
 * used once. A repeated id would break everything that finds a node by it -
 * Open in Progression's write-back, `requireUniqueSlotIds` - so a record with
 * one is refused rather than repaired by guessing which twin is the real one.
 */
export function songNodeOf(json: unknown): SongReading {
  let doc: Node;
  try {
    doc = Node.fromJSON(songSchema, json);
    doc.check();
  } catch (error) {
    return { kind: 'refused', reason: messageOf(error) };
  }

  if (doc.type !== songSchema.topNodeType) {
    return { kind: 'refused', reason: `This is a ${doc.type.name}, not a song.` };
  }

  const problem = idProblemOf(doc);
  return problem === null ? { kind: 'song', doc } : { kind: 'refused', reason: problem };
}

/** The first missing or repeated id in a document, said as a reason, or null. */
function idProblemOf(doc: Node): string | null {
  const seen = new Set<string>();
  for (const { id, type } of identifiedNodesOf(doc)) {
    if (id === null) return `A ${type} has no id.`;
    if (seen.has(id)) return `The id ${id} is used more than once.`;
    seen.add(id);
  }
  return null;
}

/** Every node that carries an id, in document order. */
function identifiedNodesOf(doc: Node): { id: string | null; type: string; pos: number }[] {
  const found: { id: string | null; type: string; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (IDENTIFIED.has(node.type.name)) found.push({ id: node.attrs['id'], type: node.type.name, pos });
  });
  return found;
}

/** The song's facts, off the doc node. */
export function songMetaOf(doc: Node): SongMeta {
  const { title, artist, key, tempo, timeSignature } = doc.attrs;
  return { title, artist, key, tempo, timeSignature };
}

/**
 * Every section, in order.
 *
 * Read from a document the editor has published or `songNodeOf` has accepted,
 * where every section has an id. (One ProseMirror has just generated has `null`
 * until `createSongIdsPlugin` runs, which it does before any such document is
 * published.)
 */
export function sectionsOf(doc: Node): SongSection[] {
  const sections: SongSection[] = [];
  doc.forEach((node, offset) => {
    sections.push({ id: node.attrs['id'], label: node.attrs['label'], kind: node.attrs['kind'], pos: offset, node });
  });
  return sections;
}

/**
 * A section's chord atoms in document order, which is the order they play in.
 *
 * `sectionPos` is the section's own position (`SongSection.pos`), so the
 * positions returned are document positions, ready for a transaction.
 */
export function chordsOf(section: Node, sectionPos: number): ChordAt[] {
  const chords: ChordAt[] = [];
  section.descendants((node, offset) => {
    if (node.type.name !== 'chord') return true;
    // The section's content starts one past its own position.
    chords.push({ attrs: node.attrs as ChordAtomAttrs, pos: sectionPos + 1 + offset });
    return false;
  });
  return chords;
}

/**
 * A section's progression, derived: its chord atoms in document order, start
 * beats summed, in the song's key, tempo and time signature. Null when the
 * song has no such section.
 *
 * Derived on every call and never stored, so it cannot fall out of step with
 * the sheet: moving a chord to another word reorders it by construction
 * (design Part 1).
 *
 * - **`id` is the section's id.** The same section gives the same id every
 *   time, which is what lets the hand-off (S1 task 10) recognise "the
 *   progression open on that page is this section's" by comparing one string,
 *   and lets a generated track's `GeneratedOrigin.progressionId` (S2) point at
 *   the section it came from. Section ids are UUIDs, so this cannot collide
 *   with a progression the user made. A song duplicated in the library shares
 *   its section ids with the original until the library re-ids it; the
 *   hand-off keys on the song id as well, so the two are still told apart.
 * - **`revision` is 0**, a progression's "never committed" value, as in
 *   `createDefaultProgression`. A derived progression has no history of its
 *   own, and `ProgressionStore.replaceDocument` re-issues the revision anyway;
 *   the hand-off records the one the store gives it.
 * - **It goes through `settle`**, the store's own normalise-then-reflow, so the
 *   result is already the fixed point the store would make of it: handed to
 *   `replaceDocument`, no `startBeat` moves and no length is clamped behind the
 *   sheet's back. `settle` also rebuilds every slot, key and note, so nothing
 *   in the result is shared with the document's attributes - an edit to it can
 *   never reach back into an immutable ProseMirror node.
 */
export function sectionProgressionOf(doc: Node, sectionId: string): ProgressionDoc | null {
  const section = sectionsOf(doc).find(entry => entry.id === sectionId);
  if (section === undefined) return null;

  const meta = songMetaOf(doc);
  const title = meta.title.trim() === '' ? UNTITLED_SONG : meta.title.trim();

  return settle({
    id: section.id,
    revision: 0,
    name: `${title} — ${section.label}`,
    key: meta.key,
    tempo: meta.tempo,
    timeSignature: { ...meta.timeSignature },
    // Each atom's start is a placeholder that `settle` replaces with the sum
    // of the lengths before it - the only place a start beat is ever made.
    slots: chordsOf(section.node, section.pos).map(({ attrs }) => ({ ...attrs, startBeat: 0 }))
  });
}

/**
 * A song's library card, from its stored record.
 *
 * Never throws, for the reason `songNodeOf` does not. A record whose content
 * cannot be read still gets a card, carrying the reason and whatever title and
 * artist can still be found on it, so the library can show it and offer to
 * delete it.
 */
export function songSummaryOf(song: SongDoc): SongSummary {
  const reading = songNodeOf(song.content);
  if (reading.kind === 'refused') {
    const attrs = song.content['attrs'];
    const text = (name: string): string => {
      const value = typeof attrs === 'object' && attrs !== null ? (attrs as Record<string, unknown>)[name] : undefined;
      return typeof value === 'string' ? value : '';
    };
    return {
      id: song.id,
      title: text('title'),
      artist: text('artist'),
      key: null,
      sectionCount: 0,
      updatedAt: song.updatedAt,
      unreadable: reading.reason
    };
  }

  const meta = songMetaOf(reading.doc);
  return {
    id: song.id,
    title: meta.title,
    artist: meta.artist,
    key: { ...meta.key },
    sectionCount: reading.doc.childCount,
    updatedAt: song.updatedAt,
    unreadable: null
  };
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/**
 * The positions, in `after`, of nodes that need a fresh id: every id-bearing
 * node with no id, and every copy of an id that now appears more than once.
 *
 * **Which twin is the copy** is decided by where the original went. For each
 * repeated id, the node that `before` held under it is followed through
 * `mapping` to its place in `after`; the one found there keeps the id, and every
 * other is renewed. So a chord pasted in front of itself, the second half of a
 * split section, and a chord dropped with Ctrl held are all renewed while the
 * original keeps the id the hand-off and any open link know it by. A chord
 * *moved* - deleted and reinserted in one transaction - appears once, and keeps
 * its id. Where no original can be followed (it was deleted and pasted back
 * twice), the first in document order keeps it.
 *
 * This is the one mechanism for unique ids, rather than a rule in the clipboard
 * parser, because ProseMirror runs `transformPasted` on an internal drag before
 * it knows whether the drop moves or copies: renewing there would re-id every
 * chord a user drags to another word.
 */
export function idRepairsOf(before: Node, after: Node, mapping: Mappable): number[] {
  const byId = new Map<string, number[]>();
  const repairs: number[] = [];
  for (const { id, pos } of identifiedNodesOf(after)) {
    if (id === null) repairs.push(pos);
    else byId.set(id, [...(byId.get(id) ?? []), pos]);
  }

  const repeated = [...byId].filter(([, positions]) => positions.length > 1);
  if (repeated.length > 0) {
    const originals = new Map<string, number>();
    for (const { id, pos } of identifiedNodesOf(before)) {
      // Associated forward, so a copy inserted exactly where the original
      // started maps the original past the copy, to where it now is.
      const mapped = mapping.mapResult(pos, 1);
      if (id !== null && !mapped.deletedAfter) originals.set(id, mapped.pos);
    }
    for (const [id, positions] of repeated) {
      const original = originals.get(id);
      const keeper = original !== undefined && positions.includes(original) ? original : positions[0];
      repairs.push(...positions.filter(pos => pos !== keeper));
    }
  }

  return repairs.sort((a, b) => a - b);
}

/**
 * The plugin that keeps every id in a song present and unique, whatever the
 * edit: it gives each position `idRepairsOf` names a fresh UUID, in a
 * transaction appended to the one that made the need.
 *
 * Appended rather than separate, so the history plugin folds it into the same
 * undo step - undoing a paste undoes its new ids with it - and no state with a
 * missing or repeated id is ever published to the view. It walks the whole
 * document on each change; a song is a few hundred nodes, which costs less than
 * the render the change triggers.
 */
export function createSongIdsPlugin(): Plugin {
  return new Plugin({
    appendTransaction: (transactions, oldState, newState) => {
      if (!transactions.some(tr => tr.docChanged)) return null;

      const mapping = new Mapping();
      for (const tr of transactions) mapping.appendMapping(tr.mapping);

      const repairs = idRepairsOf(oldState.doc, newState.doc, mapping);
      if (repairs.length === 0) return null;

      // `setNodeAttribute` replaces no content, so the positions stay valid
      // from one repair to the next.
      const tr = newState.tr;
      for (const pos of repairs) tr.setNodeAttribute(pos, 'id', crypto.randomUUID());
      return tr;
    }
  });
}
