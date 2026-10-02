import { Node } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { Step, Transform } from 'prosemirror-transform';
import type { ChordSlot, ProgressionDoc } from '../models/progression.model';
import type { ChordAtomAttrs, SectionKind } from '../models/song.model';
import type { SectionHandoff } from './progression-handoff.service';
import { SongEdit, checkedChord, markSongCommand } from './song-commands';
import {
  ChordAt,
  SongSection,
  UNTITLED_SONG,
  atomAttrsOf,
  chordsOf,
  sectionProgressionOf,
  sectionsOf,
  songMetaOf
} from './song-document';
import { songSchema } from './song-schema';

/**
 * Open in Progression, the song's half (brief decision 7): what goes out to the Progression page, and what the song
 * makes of what comes back.
 *
 * Pure but for the fresh ids `addReturnedSection` draws. The page's half - which progression is open, and the way
 * there and back - is `ProgressionHandoffService`'s; this file is everything that reads or writes a song document,
 * kept here so that service never imports ProseMirror and the Progression page's chunk never loads it.
 *
 * ## Coming back is a three-way merge
 *
 * A section is out on the Progression page for as long as the user likes, and the sheet stays editable meanwhile -
 * the user can go back to the song by the nav, place a chord, change one, and go to the Progression page again. So
 * what comes back is not simply "the section now". Three versions are compared: the progression as it was **sent**
 * (the base), as it was **returned** (the Progression page's edits), and the section's atoms **now** (the sheet's).
 * Only what the Progression page changed is written, and only to what the sheet still has:
 *
 * - **a chord changed there** - its harmony, length, notes or ownership differ from the sent slot - is written over
 *   its atom, found by id. A chord it left as it was is not written at all, so an edit made on the sheet since the
 *   section went out is kept rather than overwritten by the stale copy the Progression page was holding;
 * - **a chord removed there** has its atom deleted, if the sheet still has it; its words stay;
 * - **a chord added there** has no word to sit on, so it goes at the end of the section's last line, in the
 *   progression's order, and a notice says how many - the user drags each onto its word;
 * - **a chord placed on the sheet since** was never sent, so the Progression page cannot have removed it: it stays;
 * - **a chord changed there but taken out of the section here meanwhile** stays out - the sheet's delete is the
 *   later word on it - and a notice says so rather than dropping the change unmentioned;
 * - **a reorder made there** cannot move the words, and the sheet's order is the lyrics' order, so it is not
 *   applied, and a notice says so;
 * - **the key, the tempo and the time signature are the song's**, shared by every section (design Part 1), so one
 *   section's progression cannot change them; a notice says which the Progression page changed and that they were
 *   not brought back.
 *
 * Everything lands as one transaction, so one undo step, built here as steps over the document it was worked out
 * from and applied by `applyReturn`. **Nothing is applied when the revision did not move**: the Progression page's
 * store issues a new revision on every commit, so an unmoved one is proof nothing was edited there.
 */

/** What the song makes of a progression coming back. See the file comment. */
export type SongAfterReturn =
  /**
   * The steps to apply, all over the document `songAfterReturnOf` was given, and what to tell the user. The steps
   * may be empty when there is only something to say (a reorder, a tempo).
   */
  | { kind: 'changes'; steps: readonly Step[]; notices: readonly string[] }
  /** Nothing was edited there, or nothing that differs from the song. */
  | { kind: 'unchanged' }
  /** What came back is not chords the song can hold; none of it is applied. */
  | { kind: 'refused'; reason: string }
  /**
   * The section is no longer in the song - deleted in another tab, or here and saved, while it was out. Nothing is
   * applied, and every chord that came back is handed over, checked, so the page can offer them a new section
   * (`addReturnedSection`) rather than dropping them.
   */
  | { kind: 'sectionGone'; chords: readonly ChordAtomAttrs[] };

const UNCHANGED: SongAfterReturn = { kind: 'unchanged' };
const REFUSED = "The Progression page's chords could not be brought back:";
const STALE_DOC = "The song changed before the Progression page's chords could be brought back.";
const REORDERED = 'The chords were reordered on the Progression page; on the sheet each keeps its place in the words.';

// ---------------------------------------------------------------------------
// Going out
// ---------------------------------------------------------------------------

/**
 * What Open in Progression sends for the section `sectionId`: its derived progression (`sectionProgressionOf`) and
 * the names the Progression page's banner shows. Null when the song has no such section.
 */
export function sectionHandoffOf(songId: string, doc: Node, sectionId: string): SectionHandoff | null {
  const progression = sectionProgressionOf(doc, sectionId);
  const section = sectionsOf(doc).find(entry => entry.id === sectionId);
  if (progression === null || section === undefined) return null;
  const title = songMetaOf(doc).title.trim();
  return {
    songId,
    songTitle: title === '' ? UNTITLED_SONG : title,
    sectionId,
    sectionLabel: section.label,
    sectionKind: section.kind,
    progression
  };
}

// ---------------------------------------------------------------------------
// Coming back
// ---------------------------------------------------------------------------

/**
 * What the song `doc` makes of the progression `returned` for its section `sectionId`, sent as `sent`. See the file
 * comment for the rules.
 *
 * Every returned chord is checked by the schema's own rules (`checkedChord`) before anything is worked out, and one
 * the song could not hold refuses the whole return: a progression with a broken chord in it is not one to apply
 * half of.
 */
export function songAfterReturnOf(
  doc: Node,
  sectionId: string,
  returned: ProgressionDoc,
  sent: ProgressionDoc
): SongAfterReturn {
  if (returned.revision === sent.revision) return UNCHANGED;
  if (returned.id !== sectionId || sent.id !== sectionId) {
    return { kind: 'refused', reason: `${REFUSED} that progression is not this section's.` };
  }

  const checked = checkedChordsOf(returned);
  if (typeof checked === 'string') return { kind: 'refused', reason: `${REFUSED} ${checked}` };

  const section = sectionsOf(doc).find(entry => entry.id === sectionId);
  if (section === undefined) return { kind: 'sectionGone', chords: checked };

  const label = section.label;
  const sentById = new Map(sent.slots.map(slot => [slot.id, atomAttrsOf(slot)]));
  const returnedIds = new Set(checked.map(chord => chord.id));
  const atoms = chordsOf(section.node, section.pos);
  const atomById = new Map(atoms.map(atom => [atom.attrs.id, atom]));
  const tf = new Transform(doc);
  const notices: string[] = [];

  // Changed there: written over the atom, attribute by attribute. Attribute steps map no positions, so every
  // position read from `doc` stays good through them.
  let changed = 0;
  let outOfSection = 0;
  for (const chord of checked) {
    const base = sentById.get(chord.id);
    if (base === undefined || sameChord(chord, base)) continue;
    const atom = atomById.get(chord.id);
    if (atom === undefined) {
      outOfSection++;
    } else if (!sameChord(chord, atom.attrs)) {
      writeChord(tf, atom, chord);
      changed++;
    }
  }

  // Removed there: deleted from the end backwards, so each position is still the one read from `doc`.
  const removed = sent.slots
    .filter(slot => !returnedIds.has(slot.id))
    .map(slot => atomById.get(slot.id))
    .filter((atom): atom is ChordAt => atom !== undefined)
    .sort((a, b) => b.pos - a.pos);
  for (const atom of removed) tf.delete(atom.pos, atom.pos + 1);

  // Added there: at the end of the section's last line, through the deletes' mapping.
  const fresh = checked.filter(chord => !sentById.has(chord.id));
  if (fresh.length > 0) appendChords(tf, section, fresh);

  if (changed > 0 || removed.length > 0) notices.push(summaryOf(label, changed, removed.length));
  if (fresh.length > 0) {
    const one = fresh.length === 1;
    notices.push(
      `${chordsCount(fresh.length)} added on the Progression page ${one ? 'is' : 'are'} at the end of ` +
        `${label}'s last line; drag ${one ? 'it' : 'each'} onto its word.`
    );
  }
  if (outOfSection > 0) {
    notices.push(
      `${chordsCount(outOfSection)} changed on the Progression page had been taken out of ${label} here, so ` +
        `${outOfSection === 1 ? 'it stays' : 'they stay'} out.`
    );
  }
  if (reordered(sent, checked)) notices.push(REORDERED);
  const facts = songFactsChanged(sent, returned);
  if (facts !== null) {
    notices.push(
      `The ${facts} set on the Progression page ${facts.includes(' and ') ? 'were' : 'was'} not brought back: ` +
        "the song's own are set on the song."
    );
  }

  if (tf.steps.length === 0 && notices.length === 0) return UNCHANGED;
  return { kind: 'changes', steps: tf.steps, notices };
}

/**
 * The edit that applies a return's steps as one undo step. `doc` is the document they were worked out from: steps are
 * positions in it, so on any other document - the song changed between working them out and applying them - the edit
 * is refused rather than writing chords into the wrong places.
 */
export function applyReturn(doc: Node, steps: readonly Step[]): SongEdit {
  return state => {
    if (state.doc !== doc) return { kind: 'refused', reason: STALE_DOC };
    const tr = state.tr;
    for (const step of steps) {
      const result = tr.maybeStep(step);
      if (result.failed !== null) return { kind: 'refused', reason: `${REFUSED} ${result.failed}` };
    }
    return tr.docChanged ? { kind: 'edit', tr: markSongCommand(tr) } : { kind: 'unchanged' };
  };
}

/**
 * Puts `chords` - a return whose section had gone (`sectionGone`) - in a new section of `kind` called `label` at the
 * end of the song, on one line with no words, as one undo step, with the caret at the start of that line.
 *
 * **Fresh ids**, because they are copies now: the section they came from may yet come back - an undo in the tab that
 * deleted it - holding the originals under those ids, and the song's ids must stay unique (`songNodeOf`).
 */
export function addReturnedSection(label: string, kind: SectionKind, chords: readonly ChordAtomAttrs[]): SongEdit {
  return state => {
    const nodes: Node[] = [];
    for (const chord of chords) {
      const node = checkedChord({ ...chord, id: crypto.randomUUID() });
      if (typeof node === 'string') return { kind: 'refused', reason: `${REFUSED} ${node}` };
      nodes.push(node);
    }
    const section = songSchema.nodes.section.create({ id: crypto.randomUUID(), label, kind }, [
      songSchema.nodes.lyricLine.create(null, nodes)
    ]);
    const at = state.doc.content.size;
    const tr = state.tr.insert(at, section);
    // One into the section, one into its line.
    tr.setSelection(TextSelection.create(tr.doc, at + 2));
    return { kind: 'edit', tr: markSongCommand(tr) };
  };
}

// ---------------------------------------------------------------------------
// The parts
// ---------------------------------------------------------------------------

/** Every returned slot as a chord atom's attributes, checked by the schema, or the first reason one fails. */
function checkedChordsOf(returned: ProgressionDoc): ChordAtomAttrs[] | string {
  if (!Array.isArray(returned.slots)) return 'it has no chords.';
  const checked: ChordAtomAttrs[] = [];
  const seen = new Set<string>();
  for (const slot of returned.slots as readonly ChordSlot[]) {
    let node: Node | string;
    try {
      node = checkedChord(atomAttrsOf(slot));
    } catch (error) {
      node = error instanceof Error ? error.message : String(error);
    }
    if (typeof node === 'string') return node;
    const attrs = node.attrs as ChordAtomAttrs;
    if (seen.has(attrs.id)) return `the chord ${attrs.id} is in it twice.`;
    seen.add(attrs.id);
    checked.push(attrs);
  }
  return checked;
}

/** The four attributes that make a chord, written where they differ from `atom`'s. Its id stays. */
function writeChord(tf: Transform, atom: ChordAt, chord: ChordAtomAttrs): void {
  for (const name of ['harmony', 'lengthBeats', 'notes', 'owned'] as const) {
    if (!sameValue(chord[name], atom.attrs[name])) tf.setNodeAttribute(atom.pos, name, chord[name]);
  }
}

/**
 * Puts `chords` at the end of `section`'s last line of lyrics, in order - after its last word, where a chord on a
 * held note already sits. A section with no line (only tab blocks and memos) is given one at its end to hold them.
 * `section`'s position is in the document `tf` started from, and is mapped through the steps already on it.
 */
function appendChords(tf: Transform, section: SongSection, chords: readonly ChordAtomAttrs[]): void {
  const nodes = chords.map(chord => songSchema.nodes.chord.create(chord));
  let lastLineEnd: number | null = null;
  // The section's content starts one past its own position, and a line's content one past the line's.
  let at = section.pos + 1;
  for (let index = 0; index < section.node.childCount; index++) {
    const child = section.node.child(index);
    if (child.type === songSchema.nodes.lyricLine) lastLineEnd = at + 1 + child.content.size;
    at += child.nodeSize;
  }
  if (lastLineEnd !== null) {
    tf.insert(tf.mapping.map(lastLineEnd), nodes);
  } else {
    const sectionEnd = section.pos + section.node.nodeSize - 1;
    tf.insert(tf.mapping.map(sectionEnd), songSchema.nodes.lyricLine.create(null, nodes));
  }
}

/** "Verse 1: 2 chords changed and 1 removed on the Progression page." */
function summaryOf(label: string, changed: number, removed: number): string {
  const parts: string[] = [];
  if (changed > 0) parts.push(`${chordsCount(changed)} changed`);
  if (removed > 0) parts.push(changed > 0 ? `${removed} removed` : `${chordsCount(removed)} removed`);
  return `${label}: ${parts.join(' and ')} on the Progression page.`;
}

function chordsCount(count: number): string {
  return `${count} chord${count === 1 ? '' : 's'}`;
}

/**
 * Whether the chords both sides still have came back in a different order from the one they went out in. Chords
 * added or removed there do not count: only a move does.
 */
function reordered(sent: ProgressionDoc, returned: readonly ChordAtomAttrs[]): boolean {
  const returnedIds = new Set(returned.map(chord => chord.id));
  const sentIds = new Set(sent.slots.map(slot => slot.id));
  const before = sent.slots.map(slot => slot.id).filter(id => returnedIds.has(id));
  const after = returned.map(chord => chord.id).filter(id => sentIds.has(id));
  return before.join('\n') !== after.join('\n');
}

/** "key", "tempo", "key and tempo", "key, tempo and time signature": the song's facts changed there, or null. */
function songFactsChanged(sent: ProgressionDoc, returned: ProgressionDoc): string | null {
  const facts: string[] = [];
  if (!sameValue(sent.key, returned.key)) facts.push('key');
  if (sent.tempo !== returned.tempo) facts.push('tempo');
  if (!sameValue(sent.timeSignature, returned.timeSignature)) facts.push('time signature');
  if (facts.length === 0) return null;
  return facts.length === 1 ? facts[0] : `${facts.slice(0, -1).join(', ')} and ${facts[facts.length - 1]}`;
}

/** Whether two chords are the same chord: harmony, length, notes and ownership. Not their ids. */
function sameChord(a: ChordAtomAttrs, b: ChordAtomAttrs): boolean {
  return sameValue([a.harmony, a.lengthBeats, a.notes, a.owned], [b.harmony, b.lengthBeats, b.notes, b.owned]);
}

/**
 * Two values compared as data, whatever order their keys were written in. A slot normalised by the progression
 * store and the same slot read off an atom can list a degree's fields in different orders; that is not a change.
 */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map(key => [key, canonical(record[key])])
  );
}
