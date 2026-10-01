import { baseKeymap, splitBlock } from 'prosemirror-commands';
import { closeHistory, history, redo, undo } from 'prosemirror-history';
import { InputRule, inputRules, undoInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { Node } from 'prosemirror-model';
import { Command, EditorState, NodeSelection, Plugin, Selection, TextSelection, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { SectionKind } from '../models/song.model';
import {
  characterWidthAt,
  commandOf,
  isSongCommand,
  markSongCommand,
  moveChordBy,
  selectedChordOf
} from './song-commands';
import { createSongIdsPlugin } from './song-document';
import { songSchema } from './song-schema';

/**
 * The song sheet's editor plugins: what a key press, a typed character and
 * the undo history do in a song.
 *
 * `songEditorPlugins` is the whole list, in the order it must run, and the
 * sheet passes it to its `EditorState` unchanged. Pure but for the view the
 * key handlers are given by ProseMirror; nothing here touches Angular or the
 * DOM itself.
 *
 * ## The keys
 *
 * - **Mod-z** undoes; **Mod-y** and **Mod-Shift-z** redo, so both the Windows
 *   and the Mac habit work.
 * - **Enter** splits the lyric line at the caret, inside its section - never
 *   the section itself, which `baseKeymap`'s Enter does on an empty line in
 *   the middle of one (`liftEmptyBlock` splits the parent). With a chord
 *   selected, the line is split just after the chord and the chord is kept:
 *   Enter is not a way to delete a chord.
 * - **Shift-Enter** does exactly what Enter does. A song's line break *is* a
 *   new lyric line - the schema has no soft break inside one, because a line is
 *   the unit the syllable margin counts and a chord sheet prints - and Shift-
 *   Enter is the line break a hand reaches for from chat boxes and word
 *   processors. Making it do nothing, or something else, would punish the
 *   habit.
 * - **Backspace / Delete** are `baseKeymap`'s: they join two lines of one
 *   section. At a section's edge they stop, because sections are `isolating`
 *   in the schema - and they also *take* the key there, doing nothing, so the
 *   browser's own deletion cannot merge the two sections' DOM behind
 *   ProseMirror's back. A Backspace straight after the `[Chorus]` rule gives
 *   the typed heading back instead (`undoInputRule`).
 * - **ArrowLeft / ArrowRight** step over chord atoms as if they took no width,
 *   which on the sheet they do not: a chord's name sits above the letter it is
 *   anchored to. A press beside a chord moves past it *and* the letter beyond,
 *   so every press moves the caret a letter on screen; with nothing but chords
 *   left in the line it goes on to the next line. Left to themselves, the
 *   arrows would select the chord on one press and step off it on the next -
 *   two presses with the caret standing still - and a browser can stall at a
 *   non-editable span. The chord is selected by clicking its name instead.
 * - **Alt-ArrowLeft / Alt-ArrowRight** move a selected chord a letter
 *   (`moveChordBy`). With a chord selected the key is always taken - at an edge
 *   the refusal is reported through `onRefuse` - so a Mac's Alt+arrow word jump
 *   cannot fire instead and drop the selection. With no chord selected they are
 *   left to the browser.
 *
 * ## `[`: a chord on a line with words, a section heading on an empty line
 *
 * Two features want the bracket. Pressing `[` opens the chord field (task 7)
 * where a chord belongs; typing `[Chorus]` on an empty line makes a section.
 * The rule that lets both live is **which line the caret is in**:
 *
 * - on a lyric line with anything on it - words or chords - `[` asks for the
 *   chord field (`onChordFieldRequest`) and is not typed;
 * - on an empty lyric line `[` is typed as a bracket, so the heading rule can
 *   see `[Chorus]` when its `]` arrives.
 *
 * The cost is that `[` cannot open the chord field on an empty line; a chord
 * there comes from the Chords panel, or by typing a word first. That is the
 * smaller loss: an empty line is exactly where a heading goes, and a chord
 * with no word under it has nothing to be anchored to yet.
 *
 * It is a `handleTextInput` hook rather than a keymap entry because it is
 * about the *character*: on many keyboard layouts `[` is AltGr+8 or Option+5,
 * which a keymap would have to list layout by layout, while the text input
 * arrives as `[` whatever produced it.
 *
 * ## The `[Section]` rule
 *
 * `[Name]` typed on an otherwise empty lyric line - no words, no chords, nothing
 * after the caret - turns that line into the start of a new section called
 * `Name`. Intro, Verse, Pre-Chorus, Chorus, Bridge and Outro, in any case and
 * with an optional number ("Verse 2"), give their kind (`sectionHeadingOf`);
 * any other name is a section of kind `other`. The typed text goes; the line
 * stays, empty, with the caret in it, ready for the section's first words.
 *
 * "From that line on": the line and every line after it in its section become
 * the new section, and the lines before it stay where they were. On a section's
 * *first* line there are no lines before it, and splitting would leave an empty
 * section, so the section itself is renamed - it keeps its id, and a new song's
 * "Verse 1" typed over with `[Intro]` simply becomes the Intro.
 *
 * ## Undo
 *
 * Typing groups as ProseMirror's history always groups it: adjacent edits in
 * quick succession are one step. Every command is a step of its own, apart
 * from the typing on either side of it - `song-commands.ts` closes the step
 * before (`closeHistory`), and the last plugin here closes it after, by
 * appending an empty, closing transaction to any dispatch that carried a
 * command. The heading rule is a command by that measure, so Mod-z after it
 * undoes the section and leaves the typing (`[Chorus`, as the closing bracket
 * was never inserted). The id plugin's repairs join the step they repair.
 */

/** Where the caret is on screen, as the view measures it. */
export interface CaretCoords {
  left: number;
  top: number;
  bottom: number;
}

/** What the sheet is asked for when `[` opens the chord field. */
export interface ChordFieldRequest {
  /** Where the chord will go: the selection's start, as `insertChord` puts it. */
  pos: number;
  /** Where to open the field, or null when there is no view to measure (a spec). */
  coords: CaretCoords | null;
}

export interface SongEditorOptions {
  /** Called when `[` asks for the chord field; without it, `[` is typed. */
  onChordFieldRequest?: (request: ChordFieldRequest) => void;
  /** Told why a key's command was refused - an Alt+arrow at the edge of a line. */
  onRefuse?: (reason: string) => void;
}

/** A heading read from `[...]`: the section's kind and its name as typed. */
export interface SectionHeading {
  kind: SectionKind;
  label: string;
}

/** The six section words, and the kind each one names. */
const SECTION_WORDS: readonly { word: RegExp; kind: SectionKind }[] = [
  { word: /^intro$/i, kind: 'intro' },
  { word: /^verse$/i, kind: 'verse' },
  { word: /^pre[- ]?chorus$/i, kind: 'pre' },
  { word: /^chorus$/i, kind: 'chorus' },
  { word: /^bridge$/i, kind: 'bridge' },
  { word: /^outro$/i, kind: 'outro' }
];

/** A heading's name and its optional trailing number. */
const NUMBERED_HEADING = /^(.*?)\s*\d*$/;

/**
 * `[Name]` at the start of a line's text, ending at the bracket just typed.
 * The name holds no brackets and no `￼` - the stand-in the input-rule
 * plugin puts for a chord atom - so a line with a chord on it never matches.
 */
const HEADING_RULE = /^\[([^[\]￼]+)\]$/;

/**
 * The section a heading names: one of the six words, in any case, with an
 * optional number, gives its kind, and anything else is kind `other`. The
 * label is the text as typed, trimmed. Null for a heading with nothing in it.
 */
export function sectionHeadingOf(text: string): SectionHeading | null {
  const label = text.trim();
  if (label === '') return null;
  const word = NUMBERED_HEADING.exec(label)?.[1] ?? label;
  const known = SECTION_WORDS.find(entry => entry.word.test(word));
  return { kind: known?.kind ?? 'other', label };
}

function isLyricLine(node: Node): boolean {
  return node.type === songSchema.nodes.lyricLine;
}

function isChord(node: Node | null | undefined): boolean {
  return node?.type === songSchema.nodes.chord;
}

// ---------------------------------------------------------------------------
// The chord field
// ---------------------------------------------------------------------------

/**
 * Asks for the chord field if `[` should open it here, and answers whether it
 * did: on a lyric line with anything on it (see the header). The position is
 * the selection's start, where `insertChord` will put the chord; the
 * coordinates are the view's measure of it, when there is a view.
 */
export function requestChordField(
  state: EditorState,
  view: Pick<EditorView, 'coordsAtPos'> | undefined,
  onRequest: (request: ChordFieldRequest) => void
): boolean {
  const $from = state.selection.$from;
  if (!isLyricLine($from.parent) || $from.parent.content.size === 0) return false;

  const pos = state.selection.from;
  const rect = view?.coordsAtPos(pos);
  onRequest({ pos, coords: rect === undefined ? null : { left: rect.left, top: rect.top, bottom: rect.bottom } });
  return true;
}

function chordFieldPlugin(options: SongEditorOptions): Plugin {
  return new Plugin({
    props: {
      handleTextInput: (view, _from, _to, text) => {
        const onRequest = options.onChordFieldRequest;
        return text === '[' && onRequest !== undefined && requestChordField(view.state, view, onRequest);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// The [Section] rule
// ---------------------------------------------------------------------------

/**
 * Turns the empty line holding `pos` into the start of a section (see the
 * header): split off with the lines after it, or - on a section's first line -
 * the section renamed in place.
 *
 * The split is not put to `canSplit` first, which refuses to split any
 * `isolating` node - a rule for the *user's* splits, which is what keeps Enter
 * inside a section. Here the split is the point, and it always fits: it falls
 * between two lines, so both halves keep a line.
 */
function startSection(tr: Transaction, pos: number, heading: SectionHeading): Transaction {
  const $line = tr.doc.resolve(pos);
  const sectionPos = $line.before(1);
  if ($line.index(1) === 0) {
    tr.setNodeAttribute(sectionPos, 'label', heading.label);
    return tr.setNodeAttribute(sectionPos, 'kind', heading.kind);
  }

  const linePos = $line.before(2);
  tr.split(linePos, 1, [{ type: songSchema.nodes.section, attrs: { id: crypto.randomUUID(), ...heading } }]);
  // Past the old section's end and the new one's start, into the line.
  return tr.setSelection(TextSelection.create(tr.doc, linePos + 3));
}

const sectionHeadingRule = new InputRule(HEADING_RULE, (state, match, start, end) => {
  const $start = state.doc.resolve(start);
  const line = $start.parent;
  // Otherwise empty: the heading is the line's whole text - nothing before it,
  // nothing after the caret, no chord anywhere in it.
  if (!isLyricLine(line) || $start.parentOffset !== 0 || end !== $start.end()) return null;
  if (line.textContent.length !== line.content.size) return null;

  const heading = sectionHeadingOf(match[1]);
  if (heading === null) return null;
  return markSongCommand(startSection(state.tr.delete(start, end), start, heading));
});

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** Enter: split the lyric line; past a selected chord, keeping it. See the header. */
export const splitLine: Command = (state, dispatch) => {
  const selection = state.selection;
  if (!isLyricLine(selection.$from.parent)) return false;
  if (!(selection instanceof NodeSelection)) return splitBlock(state, dispatch);

  if (dispatch !== undefined) {
    const tr = state.tr.split(selection.to);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(selection.to))).scrollIntoView());
  }
  return true;
};

/**
 * ArrowLeft (`-1`) or ArrowRight (`1`) beside a chord: past every chord there
 * and the letter beyond, or on to the next line when only chords are left (see
 * the header). False - the browser's own move - when no chord is beside the
 * caret, or there is a selection to collapse.
 */
export function stepPastChord(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const selection = state.selection;
    if (!(selection instanceof TextSelection) || !selection.empty) return false;
    const doc = state.doc;
    const beside = (pos: number): Node | null =>
      dir > 0 ? doc.resolve(pos).nodeAfter : doc.resolve(pos).nodeBefore;

    let at = selection.head;
    if (!isLyricLine(selection.$head.parent) || !isChord(beside(at))) return false;
    while (isChord(beside(at))) at += dir;

    const $at = doc.resolve(at);
    let next: Selection;
    if (beside(at) !== null) {
      next = TextSelection.create(doc, at + dir * characterWidthAt($at, dir));
    } else {
      const edge = doc.resolve(dir > 0 ? $at.after() : $at.before());
      next = Selection.findFrom(edge, dir, true) ?? TextSelection.create(doc, at);
    }
    dispatch?.(state.tr.setSelection(next).scrollIntoView());
    return true;
  };
}

/** Alt+arrow: move the selected chord a letter. Taken whenever a chord is selected. */
function moveSelectedChord(delta: -1 | 1, onRefuse: ((reason: string) => void) | undefined): Command {
  return (state, dispatch) => {
    const chord = selectedChordOf(state);
    if (chord === null) return false;
    commandOf(moveChordBy(chord.attrs.id, delta), onRefuse)(state, dispatch);
    return true;
  };
}

/**
 * Whether the caret is at the start (`-1`) or end (`1`) of its section's text,
 * where Backspace or Delete would cross into the next section. Answering true
 * takes the key and does nothing: see the header.
 */
function holdsAtSectionEdge(dir: -1 | 1): Command {
  return state => {
    const selection = state.selection;
    if (!(selection instanceof TextSelection) || !selection.empty) return false;
    const $head = selection.$head;
    if ($head.depth < 2) return false;
    return dir < 0
      ? $head.parentOffset === 0 && $head.index(1) === 0
      : $head.parentOffset === $head.parent.content.size && $head.indexAfter(1) === $head.node(1).childCount;
  };
}

function songKeymap(options: SongEditorOptions): Record<string, Command> {
  return {
    'Mod-z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,
    Enter: splitLine,
    'Shift-Enter': splitLine,
    Backspace: undoInputRule,
    ArrowLeft: stepPastChord(-1),
    ArrowRight: stepPastChord(1),
    'Alt-ArrowLeft': moveSelectedChord(-1, options.onRefuse),
    'Alt-ArrowRight': moveSelectedChord(1, options.onRefuse)
  };
}

/** After `baseKeymap`: the deletions it binds, held at a section's edge. */
const SECTION_EDGE_KEYMAP: Record<string, Command> = {
  Backspace: holdsAtSectionEdge(-1),
  'Mod-Backspace': holdsAtSectionEdge(-1),
  'Shift-Backspace': holdsAtSectionEdge(-1),
  Delete: holdsAtSectionEdge(1),
  'Mod-Delete': holdsAtSectionEdge(1)
};

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/**
 * Closes the undo step after any dispatch that carried a command, so the
 * typing that follows starts a step of its own (see the header). An empty
 * transaction carrying `closeHistory` changes nothing but the history's
 * grouping.
 */
function commandStepPlugin(): Plugin {
  return new Plugin({
    appendTransaction: (transactions, _before, state) =>
      transactions.some(isSongCommand) ? closeHistory(state.tr) : null
  });
}

/**
 * Every plugin the song sheet's editor runs, in order.
 *
 * The order matters in two places. Key handlers run in list order, so the
 * song's keymap comes before `baseKeymap` - its Enter and arrows win - and the
 * section-edge hold after it, so it only answers what `baseKeymap` declined.
 * And appended transactions run in list order too: the id plugin must repair a
 * command's ids *before* the step is closed behind it, or the repair would be
 * an undo step of its own, so `commandStepPlugin` is last.
 */
export function songEditorPlugins(options: SongEditorOptions = {}): Plugin[] {
  return [
    chordFieldPlugin(options),
    inputRules({ rules: [sectionHeadingRule] }),
    keymap(songKeymap(options)),
    keymap(baseKeymap),
    keymap(SECTION_EDGE_KEYMAP),
    history(),
    createSongIdsPlugin(),
    commandStepPlugin()
  ];
}
