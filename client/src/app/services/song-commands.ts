import { closeHistory } from 'prosemirror-history';
import { Node, ResolvedPos } from 'prosemirror-model';
import { Command, EditorState, NodeSelection, Selection, TextSelection, Transaction } from 'prosemirror-state';
import type { TimeSignature } from '../models/composer.model';
import { normalizeChordSlot, normalizeProgressionKey } from '../models/progression-normalize';
import type { ChordDegree, ChordSlot, ProgressionKey } from '../models/progression.model';
import { ChordAtomAttrs, SECTION_KINDS, SectionKind, SongMeta } from '../models/song.model';
import { messageOf } from './error-message';
import { rekeyedSlot } from './progression-degree-editor';
import { keyTransposeInterval, reclaimPitches, regenerateSlot, retimeNotes, sameDegree } from './progression-edit';
import type { ProgressionKeyContext } from './progression-key-context';
import { ChordAt, SongSection, atomAttrsOf, createSectionNode, sectionsOf, songMetaOf } from './song-document';
import { songSchema } from './song-schema';

/**
 * Editing a song: every change the sheet makes to a song document other than
 * typing, as an edit that either builds one transaction or says why it will
 * not.
 *
 * Pure, with no Angular and no view. Each export below is a factory taking the
 * edit's arguments and returning a `SongEdit` - a function of the editor state
 * - and `commandOf` turns one into the ProseMirror `Command` a keymap or a
 * button calls. Nothing here holds state; the document is the state (design
 * Part 1), and an edit reads it, never a copy.
 *
 * ## Refusals: an outcome, not an exception and not a bare `false`
 *
 * A ProseMirror command can only answer true or false, and false means both
 * "not here" and "not allowed". The sheet needs to tell the user which, and
 * why, so each edit returns a `SongEditOutcome` - the composer's rule
 * (`ComposerHistory.commit`: an edit returns a reason, which refuses it and
 * commits nothing) in the shape ProseMirror wants:
 *
 * - `edit` carries the one transaction to dispatch;
 * - `refused` carries a sentence the user can act on, which `commandOf` hands
 *   to its `onRefuse` callback - the page's status line - only when it was
 *   asked to *run*, never when a menu merely asks whether it *could* (a command
 *   called without `dispatch`);
 * - `unchanged` is an edit that would change nothing - a rename to the same
 *   name, a tempo field committed at the tempo it shows. It is not refused,
 *   because nothing is wrong, and not dispatched, because an empty step on the
 *   undo stack is a press of Ctrl+Z that does nothing visible. That is the
 *   progression page's rule too (`editDegree`: "an edit that changes nothing is
 *   not recorded").
 *
 * The outcome is the testable channel: a spec asks an edit what it would do
 * without a dispatch to capture, and the reason is the same string the page
 * shows.
 *
 * ## One edit, one undo step
 *
 * Every transaction an edit builds is marked with `closeHistory`, so the
 * history does not fold it into the typing before it, and with a meta flag
 * (`isSongCommand`) that the editor's plugin list reads to close the step
 * after it as well - so typing straight after a chord goes in does not join
 * the chord's step either (`song-editor-plugins.ts`). The id plugin's repair,
 * appended to the same dispatch, is folded into the step it repairs.
 *
 * ## Positions never leave the document
 *
 * Chords and sections are named by id, and found again in the state the edit
 * is run on (`chordWithId`, `sectionsOf`). A popover holding a chord's id can
 * run an edit after any amount of typing and still reach the right chord - or
 * be told it is gone - where a held position would quietly hit a neighbour.
 * The one position an edit takes is `moveChordTo`'s drop target, which the
 * view computes from the pointer in the same event that runs it.
 */

/** What an edit makes of the state it is run on. See the header. */
export type SongEditOutcome =
  | { kind: 'edit'; tr: Transaction }
  | { kind: 'unchanged' }
  | { kind: 'refused'; reason: string };

/** An edit: a function of the editor state, building one transaction or saying why not. */
export type SongEdit = (state: EditorState) => SongEditOutcome;

/**
 * What the key commands ask of the app's scales: exactly the three questions
 * `ProgressionService.setKey` asks, so the song and the progression page
 * answer a key change by one set of rules.
 *
 * A `ProgressionKeyContext` is one, and the page hands its own over; it is
 * named as a `Pick` so the commands stay pure - they are handed the rules
 * rather than reaching for `MusicTheoryService` - and so a spec can see the
 * whole of what they depend on.
 */
export type SongKeyRules = Pick<ProgressionKeyContext, 'findScale' | 'chordScaleFor' | 'spellingFor'>;

const OUTSIDE_LINE = 'Put the caret in a line of lyrics to add a chord there.';
const GONE_CHORD = 'That chord is no longer in the song.';
const DUPLICATE_CHORD = 'That chord is already in the song; a copy needs an id of its own.';
const NOT_BEATS = "A chord's length must be a number of beats.";
const AT_LINE_START = 'The chord is already at the start of its line.';
const AT_LINE_END = 'The chord is already at the end of its line.';
const DROP_OUTSIDE = 'A chord can only be dropped onto a line of lyrics.';
/** Why no chord can go into a song whose key's scale cannot stack thirds; the Chords tab says it too. */
export const NO_CHORDS_KEY = "This key's scale can't build chords; choose a seven-note scale for the song.";
const GONE_SECTION = 'That section is no longer in the song.';
const BLANK_LABEL = 'A section needs a name.';
const FIRST_SECTION = 'This is already the first section.';
const LAST_SECTION = 'This is already the last section.';
const ONLY_SECTION = 'A song keeps at least one section.';

/** The meta flag `edited` sets; read through `isSongCommand`. */
const SONG_COMMAND = 'songCommand';

// ---------------------------------------------------------------------------
// The channel
// ---------------------------------------------------------------------------

function refused(reason: string): SongEditOutcome {
  return { kind: 'refused', reason };
}

const UNCHANGED: SongEditOutcome = { kind: 'unchanged' };

/** A transaction as an edit's outcome. */
function edited(tr: Transaction): SongEditOutcome {
  return { kind: 'edit', tr: markSongCommand(tr) };
}

/**
 * Makes `tr` one undo step of its own: closed off from the history before it,
 * and flagged so the editor closes the step after it too (see the header).
 *
 * Every edit here goes through it; it is exported for the one change the
 * sheet makes outside this file that is a command rather than typing - the
 * `[Chorus]` input rule, whose transaction ProseMirror's input-rule plugin
 * builds and dispatches itself.
 */
export function markSongCommand(tr: Transaction): Transaction {
  return closeHistory(tr).setMeta(SONG_COMMAND, true);
}

/**
 * An edit as a ProseMirror `Command`.
 *
 * Follows the command contract: without `dispatch` it only answers whether the
 * edit would run, so a menu can enable or dim an item by asking. With
 * `dispatch`, an edit dispatches its transaction and a refusal is handed to
 * `onRefuse` - once, at the press - before answering false.
 */
export function commandOf(edit: SongEdit, onRefuse?: (reason: string) => void): Command {
  return (state, dispatch) => {
    const outcome = edit(state);
    if (outcome.kind === 'edit') {
      dispatch?.(outcome.tr);
      return true;
    }
    if (outcome.kind === 'refused' && dispatch !== undefined) onRefuse?.(outcome.reason);
    return false;
  };
}

/** Whether a transaction was built by one of the edits here. */
export function isSongCommand(tr: Transaction): boolean {
  return tr.getMeta(SONG_COMMAND) === true;
}

// ---------------------------------------------------------------------------
// Finding things
// ---------------------------------------------------------------------------

function isLyricLine(node: Node): boolean {
  return node.type === songSchema.nodes.lyricLine;
}

function isChord(node: Node | null | undefined): boolean {
  return node?.type === songSchema.nodes.chord;
}

/** Every chord atom in the song, in document order. */
function chordsIn(doc: Node): ChordAt[] {
  const chords: ChordAt[] = [];
  doc.descendants((node, pos) => {
    if (isChord(node)) chords.push({ attrs: node.attrs as ChordAtomAttrs, pos });
    // Nothing nests inside an inline node, so a line's children are the last
    // level worth walking.
    return !node.isInline;
  });
  return chords;
}

/** The chord atom with `id`, and where it is, or null when the song has none. */
export function chordWithId(doc: Node, id: string): ChordAt | null {
  return chordsIn(doc).find(chord => chord.attrs.id === id) ?? null;
}

/**
 * The chord the selection is on, or null.
 *
 * A chord is selected when the selection is a `NodeSelection` of its atom -
 * what clicking its name makes, and what Alt+arrows act on.
 */
export function selectedChordOf(state: EditorState): ChordAt | null {
  const selection = state.selection;
  if (!(selection instanceof NodeSelection) || !isChord(selection.node)) return null;
  return { attrs: selection.node.attrs as ChordAtomAttrs, pos: selection.from };
}

function sectionWithId(doc: Node, id: string): SongSection | null {
  return sectionsOf(doc).find(section => section.id === id) ?? null;
}

/**
 * The index of the section holding the selection's head.
 *
 * At the top level - between sections, where a section's own `NodeSelection`
 * or a select-all ends - that is the section just before the head: the one
 * the user was last in.
 */
function sectionIndexAtHead(state: EditorState): number {
  const $head = state.selection.$head;
  if ($head.depth > 0) return $head.index(0);
  return Math.max(0, $head.index(0) - 1);
}

// ---------------------------------------------------------------------------
// Checking and writing attributes
// ---------------------------------------------------------------------------

/** Two attribute values as the document would store them, compared. */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * A chord atom built from `attrs` and put through the schema's own checks
 * (`CHORD_CHECKS`, the progression model's rules), or the reason it failed.
 *
 * ProseMirror runs an attribute's `validate` in `Node.check()`, not when a
 * node is created or a step applied, so an edit that brings a chord in from
 * outside the document checks it here, once, rather than trusting the caller.
 */
function checkedChord(attrs: ChordAtomAttrs): Node | string {
  try {
    const node = songSchema.nodes.chord.create({
      id: attrs.id,
      harmony: attrs.harmony,
      lengthBeats: attrs.lengthBeats,
      notes: attrs.notes,
      owned: attrs.owned
    });
    node.check();
    return node;
  } catch (error) {
    return messageOf(error);
  }
}

/**
 * Writes a chord's slot attributes over the atom at `pos`, each only where it
 * changed, leaving its id.
 *
 * Attribute steps rather than a replacement, because an attribute step maps no
 * position: a selected chord stays selected, and the caret beside it stays
 * beside it.
 */
function writeChord(tr: Transaction, pos: number, next: ChordAtomAttrs, current: ChordAtomAttrs): void {
  for (const name of ['harmony', 'lengthBeats', 'notes', 'owned'] as const) {
    if (!sameValue(next[name], current[name])) tr.setNodeAttribute(pos, name, next[name]);
  }
}

/** A chord atom's attributes as a progression slot, for the slot functions. */
function slotOf(attrs: ChordAtomAttrs): ChordSlot {
  // The start is a placeholder: these slots are edited one at a time and
  // never laid out, and an atom's start is derived (`sectionProgressionOf`).
  return { ...attrs, startBeat: 0 };
}

/**
 * Why `value` cannot be the song's `name` attribute, by the schema's own check,
 * or null when it can. One rule for the song's facts, stated in the schema.
 */
function songAttributeProblem(name: keyof SongMeta, value: unknown): string | null {
  const validate = songSchema.topNodeType.spec.attrs?.[name]?.validate;
  if (typeof validate !== 'function') return null;
  try {
    validate(value);
    return null;
  } catch (error) {
    return messageOf(error);
  }
}

/** An edit writing one of the song's facts: checked, and unchanged when it is already so. */
function songAttributeEdit<K extends keyof SongMeta>(name: K, value: SongMeta[K]): SongEdit {
  return state => {
    const problem = songAttributeProblem(name, value);
    if (problem !== null) return refused(problem);
    if (sameValue(songMetaOf(state.doc)[name], value)) return UNCHANGED;
    return edited(state.tr.setDocAttribute(name, value));
  };
}

// ---------------------------------------------------------------------------
// Chords
// ---------------------------------------------------------------------------

/**
 * Puts a chord atom at the caret: before the character the caret is in front
 * of, which is the letter the chord's name will sit over. With a selection it
 * goes at the selection's start and the selected words are left alone - a
 * chord is placed on words, never in place of them.
 *
 * `at`, when given, is where the chord goes instead of the caret: a position
 * the caller recorded in this document - the chord field records where `[`
 * was pressed. The caret is then put just after the chord, ready for the
 * word it sits over, wherever it was. A position that is not in a line of
 * lyrics is refused as a caret there would be.
 *
 * `attrs` comes from `chordSlotOf`, so it is voiced and has a fresh id. A
 * chord the schema refuses, or one whose id the song already holds, is
 * refused rather than repaired: either is a caller's mistake, and repairing it
 * here would hide it.
 */
export function insertChord(attrs: ChordAtomAttrs, at?: number): SongEdit {
  return state => {
    if (at !== undefined && (!Number.isInteger(at) || at < 0 || at > state.doc.content.size)) {
      return refused(OUTSIDE_LINE);
    }
    const $from = at === undefined ? state.selection.$from : state.doc.resolve(at);
    if (!isLyricLine($from.parent)) return refused(OUTSIDE_LINE);
    if (chordWithId(state.doc, attrs.id) !== null) return refused(DUPLICATE_CHORD);

    const node = checkedChord(attrs);
    if (typeof node === 'string') return refused(node);
    const tr = state.tr.insert($from.pos, node);
    if (at !== undefined) tr.setSelection(TextSelection.create(tr.doc, $from.pos + 1));
    return edited(tr);
  };
}

/**
 * Writes a different chord over the chord `id`, which keeps its id and its
 * place. Any id on `attrs` is ignored. The popover's "change chord" comes
 * through here by way of `changeChord`, which works out the new chord's
 * attributes from a degree.
 */
export function replaceChord(id: string, attrs: Omit<ChordAtomAttrs, 'id'>): SongEdit {
  return state => {
    const found = chordWithId(state.doc, id);
    if (found === null) return refused(GONE_CHORD);

    const node = checkedChord({ ...attrs, id });
    if (typeof node === 'string') return refused(node);
    const next = node.attrs as ChordAtomAttrs;
    if (sameValue(next, found.attrs)) return UNCHANGED;

    const tr = state.tr;
    writeChord(tr, found.pos, next, found.attrs);
    return edited(tr);
  };
}

/**
 * Makes the chord `id` a different chord - `degree`, in the song's key - and
 * voices it: the popover's chord field. Its id, its place and its length stay.
 *
 * It means what the progression page's `setSlotChord` means, by the same
 * parts (`ProgressionDegreeEditor.editDegree`), so a chord's ownership reads
 * the same on both pages:
 *
 * - **the pitches are handed back** (`reclaimPitches`) and the chord re-voiced
 *   from its new degree (`regenerateSlot`). A slot that owns its pitches - a
 *   voicing written in the progression page's roll and brought back by Open in
 *   Progression - keeps them through a key change, but a chord change restates
 *   the chord, and keeping them would leave the sheet printing the new name
 *   over the old chord's sound. Undo puts the owned voicing back.
 * - **a rhythm or a dynamic the slot owns is kept**: changing the chord says
 *   nothing about either.
 * - **the same degree is unchanged**, owned pitches and all: retyping a
 *   chord's own name in the field must not quietly throw away its voicing.
 *
 * A key whose scale cannot build chords is refused, since no degree can be
 * voiced in it; the field refuses every name there first.
 */
export function changeChord(keys: Pick<SongKeyRules, 'chordScaleFor'>, id: string, degree: ChordDegree): SongEdit {
  return state => {
    const found = chordWithId(state.doc, id);
    if (found === null) return refused(GONE_CHORD);
    const key = songMetaOf(state.doc).key;
    const scaleIntervals = keys.chordScaleFor(key);
    if (scaleIntervals === null) return refused(NO_CHORDS_KEY);

    const harmony = found.attrs.harmony;
    if (harmony.kind === 'degree' && sameDegree(harmony.degree, degree)) return UNCHANGED;

    let slot: ChordSlot;
    try {
      const restated = normalizeChordSlot({ ...slotOf(found.attrs), harmony: { kind: 'degree', degree } });
      slot = regenerateSlot(reclaimPitches(restated), key, scaleIntervals);
    } catch (error) {
      return refused(messageOf(error));
    }
    return replaceChord(id, atomAttrsOf(slot))(state);
  };
}

/**
 * Sets how long the chord `id` plays, in beats (quarter notes).
 *
 * By the progression page's own road (`ProgressionService.setSlotLength`):
 * the length is bounded by `normalizeChordSlot` - under one beat is held at
 * one, `MIN_SLOT_BEATS` - and the voicing is re-timed to it by `retimeNotes`,
 * which leaves alone a slot that owns its timing. Only a length that is not a
 * number at all is refused, since there is nothing to bound.
 */
export function setChordLength(id: string, beats: number): SongEdit {
  return state => {
    if (!Number.isFinite(beats)) return refused(NOT_BEATS);
    const found = chordWithId(state.doc, id);
    if (found === null) return refused(GONE_CHORD);

    const resized = retimeNotes(normalizeChordSlot({ ...slotOf(found.attrs), lengthBeats: beats }));
    if (resized.lengthBeats === found.attrs.lengthBeats) return UNCHANGED;

    const tr = state.tr;
    writeChord(tr, found.pos, atomAttrsOf(resized), found.attrs);
    return edited(tr);
  };
}

/** Takes the chord `id` out of the song. The words it sat over stay. */
export function deleteChord(id: string): SongEdit {
  return state => {
    const found = chordWithId(state.doc, id);
    if (found === null) return refused(GONE_CHORD);
    return edited(state.tr.delete(found.pos, found.pos + 1));
  };
}

/**
 * How many positions the character beside `$pos` takes: two for a character
 * written as a UTF-16 surrogate pair (most emoji), one otherwise - so a chord
 * moved one character never lands between the halves of one, and nor does the
 * caret the arrow keys step past a chord (`song-editor-plugins.ts`).
 *
 * `nodeAfter` and `nodeBefore` are cut at the position, so the character next
 * to it is the first of the one and the last of the other.
 */
export function characterWidthAt($pos: ResolvedPos, dir: -1 | 1): number {
  const text = (dir > 0 ? $pos.nodeAfter : $pos.nodeBefore)?.text ?? '';
  const pair = dir > 0 ? text.slice(0, 2) : text.slice(-2);
  return pair.length === 2 && /^[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(pair) ? 2 : 1;
}

/**
 * Where the chord at `pos` lands moved one character in `dir`, or why it
 * cannot move: past any chords beside it - they take no width in the words -
 * and over one character, landing right beside that character. Never past
 * either end of its line.
 */
function oneCharacterOn(doc: Node, pos: number, dir: -1 | 1): number | string {
  const $chord = doc.resolve(pos);
  if (dir > 0) {
    let at = pos + 1;
    const end = $chord.end();
    while (at < end && isChord(doc.resolve(at).nodeAfter)) at++;
    if (at >= end) return AT_LINE_END;
    return at + characterWidthAt(doc.resolve(at), 1);
  }

  let at = pos;
  const start = $chord.start();
  while (at > start && isChord(doc.resolve(at).nodeBefore)) at--;
  if (at <= start) return AT_LINE_START;
  return at - characterWidthAt(doc.resolve(at), -1);
}

/**
 * Moves the chord atom from `from` to `to` (a position in the same document,
 * before the move) in one transaction: deleted and inserted, which the id
 * plugin reads as a move and so leaves the id alone. `at` is where the atom
 * now is.
 */
function movedChord(state: EditorState, from: number, to: number): { tr: Transaction; at: number } {
  const node = state.doc.nodeAt(from);
  // `from` is a chord atom's position, found in this document by the caller.
  if (node === null) throw new Error(`No chord at ${from}`);
  const tr = state.tr.delete(from, from + 1);
  const at = tr.mapping.map(to);
  tr.insert(at, node);
  return { tr, at };
}

/**
 * Moves the chord `id` one character left (`-1`) or right (`1`) in its line:
 * Alt+arrow. Its length does not change - a chord's timing is its own, and the
 * word only places it (design decision 3).
 *
 * "One character" counts letters, not chords: chords take no width in the
 * words, so a chord moves past any others beside it and over the next letter,
 * landing right beside that letter. A chord can sit after a line's last letter
 * (a chord on a held note), so the right edge is the end of the line. It never
 * crosses into the next line - dragging is how a chord goes further - so at
 * either edge it is refused, with which edge in the reason.
 *
 * A selected chord stays selected, so holding Alt and pressing the arrow
 * again keeps walking it.
 */
export function moveChordBy(id: string, delta: -1 | 1): SongEdit {
  return state => {
    const found = chordWithId(state.doc, id);
    if (found === null) return refused(GONE_CHORD);

    const target = oneCharacterOn(state.doc, found.pos, delta);
    if (typeof target === 'string') return refused(target);

    const { tr, at } = movedChord(state, found.pos, target);
    if (selectedChordOf(state)?.attrs.id === id) tr.setSelection(NodeSelection.create(tr.doc, at));
    return edited(tr);
  };
}

/**
 * Moves the chord `id` to `pos` - a drop, with `pos` a position in the current
 * document - anywhere in any line of the song, and selects it there, as
 * ProseMirror's own drop selects what it dropped.
 *
 * A drop outside a line of lyrics (between sections, on a tab block) is
 * refused. A drop where the chord already is - on either side of itself - is
 * unchanged.
 */
export function moveChordTo(id: string, pos: number): SongEdit {
  return state => {
    const found = chordWithId(state.doc, id);
    if (found === null) return refused(GONE_CHORD);
    if (!Number.isInteger(pos) || pos < 0 || pos > state.doc.content.size) return refused(DROP_OUTSIDE);
    if (!isLyricLine(state.doc.resolve(pos).parent)) return refused(DROP_OUTSIDE);
    if (pos === found.pos || pos === found.pos + 1) return UNCHANGED;

    const { tr, at } = movedChord(state, found.pos, pos);
    tr.setSelection(NodeSelection.create(tr.doc, at));
    return edited(tr);
  };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** A section's name as stored - trimmed - or the reason it cannot be one. */
function labelProblem(label: string, kind: SectionKind): string | null {
  if (!SECTION_KINDS.includes(kind)) return `A section's kind is one of ${SECTION_KINDS.join(', ')}; got ${kind}.`;
  return label.trim() === '' ? BLANK_LABEL : null;
}

/**
 * Adds a new, empty section of `kind` called `label` right after the section
 * holding the caret, and puts the caret in its first line - "+ Section".
 */
export function addSection(kind: SectionKind, label: string): SongEdit {
  return state => {
    const problem = labelProblem(label, kind);
    if (problem !== null) return refused(problem);

    const after = sectionsOf(state.doc)[sectionIndexAtHead(state)];
    const at = after.pos + after.node.nodeSize;
    const tr = state.tr.insert(at, createSectionNode(label.trim(), kind));
    // One into the section, one into its first line.
    tr.setSelection(TextSelection.create(tr.doc, at + 2));
    return edited(tr);
  };
}

/** Renames the section `id`, and changes its kind when `kind` is given. */
export function renameSection(id: string, label: string, kind?: SectionKind): SongEdit {
  return state => {
    const section = sectionWithId(state.doc, id);
    if (section === null) return refused(GONE_SECTION);
    const nextKind = kind ?? section.kind;
    const problem = labelProblem(label, nextKind);
    if (problem !== null) return refused(problem);

    const name = label.trim();
    if (name === section.label && nextKind === section.kind) return UNCHANGED;
    const tr = state.tr.setNodeAttribute(section.pos, 'label', name);
    if (nextKind !== section.kind) tr.setNodeAttribute(section.pos, 'kind', nextKind);
    return edited(tr);
  };
}

/**
 * `selection` moved by `shift` positions into `doc`: the caret or chord
 * selection of a section that has just been moved, kept where it was in it.
 */
function shiftedSelection(selection: Selection, shift: number, doc: Node): Selection {
  if (selection instanceof NodeSelection) return NodeSelection.create(doc, selection.from + shift);
  if (selection instanceof TextSelection) {
    return TextSelection.create(doc, selection.anchor + shift, selection.head + shift);
  }
  return Selection.near(doc.resolve(selection.head + shift));
}

/**
 * Moves the section `id` up (`-1`) or down (`1`) past its neighbour. The
 * caret, if it was in the section, goes with it.
 */
export function moveSection(id: string, delta: -1 | 1): SongEdit {
  return state => {
    const sections = sectionsOf(state.doc);
    const index = sections.findIndex(section => section.id === id);
    if (index < 0) return refused(GONE_SECTION);
    if (delta < 0 && index === 0) return refused(FIRST_SECTION);
    if (delta > 0 && index === sections.length - 1) return refused(LAST_SECTION);

    const moving = sections[index];
    const neighbour = sections[index + delta];
    const end = moving.pos + moving.node.nodeSize;
    const tr = state.tr.delete(moving.pos, end);
    const at = delta < 0 ? neighbour.pos : tr.mapping.map(neighbour.pos + neighbour.node.nodeSize);
    tr.insert(at, moving.node);

    const selection = state.selection;
    if (selection.from > moving.pos && selection.to < end) {
      tr.setSelection(shiftedSelection(selection, at - moving.pos, tr.doc));
    }
    return edited(tr);
  };
}

/** A label read as a name and a trailing number: "Verse 2" is "Verse " and 2. */
const NUMBERED = /^(.*?)(\d+)$/;

/**
 * The name a copy of the section called `label` gets, in a song whose
 * sections are called `labels`.
 *
 * **A numbered name counts on; any other name is kept.** "Verse 1" copies to
 * "Verse 2" - or past the highest number any section of that name already has,
 * so copying Verse 1 when Verse 2 exists gives "Verse 3", never a second
 * "Verse 2". "Chorus" copies to "Chorus": a repeated chorus is the same
 * chorus, and that is what a chord chart calls it. The number is the user's
 * own, read off the name rather than inferred from the kind, so a section
 * called "Take 5" counts on too and nothing is numbered that the user did not
 * number. The comparison ignores case and the spaces around the name.
 */
export function copyLabelOf(label: string, labels: readonly string[]): string {
  const numbered = NUMBERED.exec(label.trim());
  if (numbered === null) return label;

  const [, stem, digits] = numbered;
  const same = stem.trim().toLowerCase();
  let highest = Number(digits);
  for (const other of labels) {
    const match = NUMBERED.exec(other.trim());
    if (match !== null && match[1].trim().toLowerCase() === same) highest = Math.max(highest, Number(match[2]));
  }
  return `${stem}${highest + 1}`;
}

/** `node` with a fresh id on it and on every node inside that carries one. */
function withFreshIds(node: Node): Node {
  if (node.isText) return node;
  const attrs = 'id' in node.attrs ? { ...node.attrs, id: crypto.randomUUID() } : node.attrs;
  const content: Node[] = [];
  node.forEach(child => content.push(withFreshIds(child)));
  return node.type.create(attrs, content, node.marks);
}

/**
 * Copies the section `id` to right after itself, and puts the caret at the
 * start of the copy.
 *
 * - **The copy is its own** (design decision 8): a fresh id for the section
 *   and for every chord and tab block in it, made here rather than left to the
 *   id plugin, so the edit is whole on its own and the original keeps every id
 *   the hand-off or an open link knows it by.
 * - **Its name** is `copyLabelOf`'s: "Verse 1" → "Verse 2", "Chorus" stays.
 * - **A voice memo is left out.** Its recording lives outside the document,
 *   keyed by the memo's id (design Part 1), so a copied memo would either share
 *   the original's id - which the song refuses - or name a recording that does
 *   not exist. The take belongs to the section it was recorded on. A copy left
 *   with nothing else gets an empty line, since a section is never empty.
 */
export function duplicateSection(id: string): SongEdit {
  return state => {
    const sections = sectionsOf(state.doc);
    const section = sections.find(entry => entry.id === id);
    if (section === undefined) return refused(GONE_SECTION);

    const content: Node[] = [];
    section.node.forEach(child => {
      if (child.type !== songSchema.nodes.memo) content.push(withFreshIds(child));
    });
    if (content.length === 0) content.push(songSchema.nodes.lyricLine.create());
    const label = copyLabelOf(section.label, sections.map(entry => entry.label));
    const copy = songSchema.nodes.section.create({ id: crypto.randomUUID(), label, kind: section.kind }, content);

    const at = section.pos + section.node.nodeSize;
    const tr = state.tr.insert(at, copy);
    tr.setSelection(Selection.near(tr.doc.resolve(at + 1)));
    return edited(tr);
  };
}

/** Deletes the section `id` and everything in it. A song keeps at least one section. */
export function deleteSection(id: string): SongEdit {
  return state => {
    const section = sectionWithId(state.doc, id);
    if (section === null) return refused(GONE_SECTION);
    if (state.doc.childCount === 1) return refused(ONLY_SECTION);
    return edited(state.tr.delete(section.pos, section.pos + section.node.nodeSize));
  };
}

// ---------------------------------------------------------------------------
// The song
// ---------------------------------------------------------------------------

/**
 * Puts the song in a new key, and every chord in it, in one transaction - one
 * undo step for the key and all its chords.
 *
 * It means what `ProgressionService.setKey` means, by the same parts:
 *
 * - the tonic is wrapped into 0-11 (`normalizeProgressionKey`), and a tonic
 *   that is not a whole number is refused rather than thrown;
 * - `preferSharps` is the argument when given - the page knows whether the
 *   user picked F♯ or G♭, which a pitch class cannot say - and otherwise
 *   `spellingFor`: the key's signature, then the scale's own preference, then
 *   the spelling already in force;
 * - every chord atom goes through `rekeyedSlot` with the scale being left and
 *   the one being entered and `keyTransposeInterval` between the tonics, so a
 *   chord that leaves its pitches to the key keeps its degree and is voiced in
 *   the new key, and one whose pitches are owned keeps them - moved with the
 *   tonic - and is written as whatever numeral they make there.
 *
 * **One difference: a scale that cannot build chords is refused.** The
 * progression page applies such a key anyway, because its key comes from the
 * circle of fifths and refusing would leave it in a different key from the
 * fretboard behind it. The song owns its key - the circle is hidden on the
 * song pages - so that reason does not apply, and the opposite one does: every
 * chord on a song sheet is a degree, and in a pentatonic key no degree can be
 * written, so the sheet could print no chord name and accept no new chord. The
 * page's scale menu offers only scales that can build chords (decision 4);
 * this is the same rule at the command, for any other caller. An id the app
 * does not know is refused on the same grounds.
 *
 * A key identical to the song's - tonic, scale and spelling - is unchanged.
 */
export function setSongKey(
  keys: SongKeyRules,
  tonic: number,
  scaleId: string,
  preferSharps?: boolean
): SongEdit {
  return state => {
    if (!Number.isInteger(tonic)) return refused(`A key's tonic is a pitch class, a whole number; got ${tonic}.`);
    const scale = keys.findScale(scaleId);
    if (scale === null) return refused(`The app has no scale called "${scaleId}".`);

    const leavingKey = songMetaOf(state.doc).key;
    const bounded = normalizeProgressionKey({ tonic, scaleId, preferSharps: leavingKey.preferSharps });
    const key: ProgressionKey = {
      ...bounded,
      preferSharps: preferSharps ?? keys.spellingFor(bounded.tonic, scaleId, scale, leavingKey.preferSharps)
    };

    const entering = keys.chordScaleFor(key);
    if (entering === null) {
      return refused(
        `${scale.name} can't build chords: a song's chords are stacked in thirds through a seven-note scale. ` +
          'Choose one of those for the song.'
      );
    }
    if (sameValue(key, leavingKey)) return UNCHANGED;

    const leaving = keys.chordScaleFor(leavingKey);
    const transposeBy = keyTransposeInterval(leavingKey.tonic, key.tonic);
    const tr = state.tr.setDocAttribute('key', key);
    // Attribute steps map no positions, so each chord's position from the
    // document before the change is still its position here.
    for (const chord of chordsIn(state.doc)) {
      const moved = rekeyedSlot(slotOf(chord.attrs), leaving, entering, key, transposeBy);
      writeChord(tr, chord.pos, atomAttrsOf(moved), chord.attrs);
    }
    return edited(tr);
  };
}

/**
 * Moves the song a semitone up (`1`) or down (`-1`): Transpose ↑↓. It is
 * `setSongKey` with the tonic stepped and the scale kept, and - as on the
 * progression page - the spelling worked out afresh for the new tonic rather
 * than carried, so C up a semitone is D♭ major, not C♯.
 */
export function transposeSong(keys: SongKeyRules, delta: -1 | 1): SongEdit {
  return state => {
    const key = songMetaOf(state.doc).key;
    return setSongKey(keys, (key.tonic + delta + 12) % 12, key.scaleId)(state);
  };
}

/** Sets the song's tempo, in BPM. Refused outside the range the progression page plays. */
export function setTempo(bpm: number): SongEdit {
  return songAttributeEdit('tempo', bpm);
}

/**
 * Sets the song's time signature. **Chord lengths do not change.**
 *
 * A chord's length is in beats - quarter notes, as everywhere in the
 * progression model - not in bars, so it says how long the chord sounds and a
 * new meter does not change that: a four-beat chord in 4/4 is still four beats
 * in 3/4, now running a beat past the bar line. Scaling lengths to keep "one
 * bar" would silently rewrite the song's harmonic rhythm, and would not even
 * be undone by changing back - 4/4 to 3/4 turns 4 beats to 3, and 3/4 to 6/8
 * leaves them, so the round trip loses the fourth beat. What the meter does
 * decide is the length a chord gets when it is *placed* (`chordSlotOf`: one
 * bar), so chords added after the change are a bar of the new meter.
 */
export function setTimeSignature(timeSignature: TimeSignature): SongEdit {
  // Copied field by field, so what is stored and compared is exactly the
  // three fields, in the order the song's other time signatures have them.
  const { numerator, denominator, isCommon } = timeSignature;
  return songAttributeEdit('timeSignature', { numerator, denominator, isCommon });
}

/** Sets the song's title, as typed: a field being typed into is not trimmed under the caret. */
export function setTitle(title: string): SongEdit {
  return songAttributeEdit('title', title);
}

/** Sets the song's artist, as typed. */
export function setArtist(artist: string): SongEdit {
  return songAttributeEdit('artist', artist);
}
