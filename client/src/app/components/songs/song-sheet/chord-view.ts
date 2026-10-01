import { Node } from 'prosemirror-model';
import { NodeSelection, Plugin } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { ProgressionKey } from '../../../models/progression.model';
import type { ChordAtomAttrs } from '../../../models/song.model';
import { spokenChordName } from '../../../services/progression-chord-names';
import { effectiveChord } from '../../../services/progression-harmony';
import { chordRootName } from '../../../services/progression-spelling';
import { leadSheetNameOf, numeralOf } from '../../../services/song-chord-names';

/**
 * A chord atom on the sheet: its name over the letter it is anchored to, taking no width in the words (design
 * Part 2), and the measuring that keeps two names from colliding.
 *
 * ## How a name sits over its letter
 *
 * The atom is an empty inline `span` placed just before the letter, so it is zero wide and its left edge is that
 * letter's left edge. The name is absolutely positioned inside it, at its right edge and just above the text, so it
 * starts exactly where the letter starts and takes no room in the line. The line keeps room above itself for the
 * names (the sheet's SCSS), so a name never covers the line before it.
 *
 * ## When two names would collide
 *
 * Two chords a letter or two apart would print their names on top of one another. The line widens instead: the later
 * chord's span gets left padding, which pushes it - and the letter after it - right until its name clears the one
 * before it. The name stays at the span's right edge, so it is still over its own letter. The padding is measured, not
 * computed from character counts, because names are a proportional bold face over a monospace line and the lyric size
 * is the viewer's to change; `chordSpacingPlugin` measures after every update of the view.
 */

/** What a chord's name is worked out from: the song's key and its scale, and whether the sheet shows numerals. */
export interface ChordNaming {
  key: ProgressionKey;
  /** The key's scale when it can build chords, else null - and then no chord can be named. */
  scaleIntervals: readonly number[] | null;
  numerals: boolean;
}

/** What the sheet prints for a chord, and what it says to assistive technology. */
export interface ChordLabel {
  text: string;
  spoken: string;
}

/**
 * The room left between two names, as a share of the name's font size: about a narrow letter's width, enough to read
 * `C` `F` as two chords and not `CF`.
 */
const NAME_GAP_EM = 0.5;

/** What a chord with no name prints: one detached from its degree, or one in a key no chord can be named in. */
const UNLABELLED: ChordLabel = Object.freeze({ text: '?', spoken: 'chord, unlabelled' });

/** A note name as said aloud: `Bb` is "B flat", `F##` "F double sharp" - `spokenChordName`'s rule for its root. */
function spokenNoteOf(name: string): string {
  if (name.length < 2) return name;
  return `${name[0]} ${name.length > 2 ? 'double ' : ''}${name[1] === '#' ? 'sharp' : 'flat'}`;
}

/**
 * A chord's label: its lead-sheet name (`Am`, `Bb7`, `F/A`) or, with numerals on, its Roman numeral (`vi`, `♭VII`),
 * and in either case a spoken name for its `aria-label`, "chord A minor", "chord F major over A".
 *
 * **The spoken name is the chord's name even with numerals showing.** A numeral read aloud is a string of letters -
 * "vee eye" - and the name says which chord it is, which is what someone placing a word under it needs; the numeral is
 * a way of *showing* the chord, as the progression page's cards treat it.
 *
 * A literal chord - one detached from the key, which the sheet itself never makes but Open in Progression can bring
 * back (task 10) - has no degree to name, and is printed `?`, as `chordName` prints a chord it cannot name: unlabelled
 * rather than mislabelled.
 */
export function chordLabelOf(attrs: ChordAtomAttrs, naming: ChordNaming): ChordLabel {
  const { harmony } = attrs;
  const intervals = naming.scaleIntervals;
  if (harmony.kind !== 'degree' || intervals === null) return UNLABELLED;

  const degree = harmony.degree;
  const name = leadSheetNameOf(degree, naming.key, intervals);
  const root = chordRootName(naming.key, intervals, degree);
  // The bass is the text after the last slash - but only for an inversion: `C6/9` is a figure, not a slash chord.
  const bass = degree.inversion === 0 ? null : name.slice(name.lastIndexOf('/') + 1);
  const spoken = `chord ${spokenChordName(root, effectiveChord(intervals, degree))}`;

  return {
    text: naming.numerals ? numeralOf(degree, intervals) : name,
    spoken: bass === null ? spoken : `${spoken} over ${spokenNoteOf(bass)}`
  };
}

/**
 * The chord atom's node view: an empty `span.song-chord` carrying the name in `span.song-chord-name`.
 *
 * Its name is asked of `naming` on every render rather than held, because what it depends on - the song's key and the
 * names/numerals toggle - lives outside the atom: ProseMirror calls `update` only when the atom itself changes, so
 * the sheet calls `render` on every live view (`views`) when the key or the toggle does.
 */
export class ChordView implements NodeView {
  readonly dom: HTMLElement;
  private readonly name: HTMLElement;

  constructor(
    private node: Node,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly naming: () => ChordNaming,
    private readonly views: Set<ChordView>
  ) {
    this.dom = document.createElement('span');
    this.dom.className = 'song-chord';
    // An image of a chord symbol, named by its label: `aria-label` alone is not allowed on a plain span.
    this.dom.setAttribute('role', 'img');
    this.name = document.createElement('span');
    this.name.className = 'song-chord-name';
    this.name.setAttribute('aria-hidden', 'true');
    this.dom.append(this.name);
    this.dom.addEventListener('click', this.select);

    views.add(this);
    this.render();
  }

  /** Writes the name and label for the current key and toggle; only what changed, so an unchanged name costs no layout. */
  render(): void {
    const label = chordLabelOf(this.node.attrs as ChordAtomAttrs, this.naming());
    if (this.name.textContent !== label.text) this.name.textContent = label.text;
    if (this.dom.getAttribute('aria-label') !== label.spoken) this.dom.setAttribute('aria-label', label.spoken);
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  /** The view's own spacing and the name's text are this view's business: nothing for ProseMirror to re-read. */
  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.dom.removeEventListener('click', this.select);
    this.views.delete(this);
  }

  /**
   * A click on the name selects the chord, as a `NodeSelection` - what the popover (task 7), Alt+arrows and Delete act
   * on. On `click`, not `mousedown`, so pressing and dragging the name still drags the chord to another word: the
   * browser fires `click` only for a press that did not become a drag.
   */
  private readonly select = (): void => {
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
    this.view.focus();
  };
}

/**
 * Pads chords whose names would collide (see the file comment), across every lyric line under `root`, and takes the
 * padding off chords that no longer need it.
 *
 * Left to right through each line, each chord is compared with the name before it on the same row: a line that wraps
 * starts again on its next row. A chord's own box starts where it sits in the words whatever its padding, so the
 * padding each one needs is worked out from where it would be unpadded, and the result does not depend on the padding
 * it had - measuring twice gives the same answer. Writes happen only where the padding changes, so a measure that finds
 * nothing to change forces no layout but its first read.
 */
export function spaceChordNames(root: HTMLElement): void {
  for (const line of Array.from(root.querySelectorAll<HTMLElement>('.song-lyric-line'))) spaceLine(line);
}

function spaceLine(line: HTMLElement): void {
  let previous: { right: number; top: number } | null = null;
  let gap: number | null = null;

  for (const chord of Array.from(line.querySelectorAll<HTMLElement>('.song-chord'))) {
    const name = chord.querySelector<HTMLElement>('.song-chord-name');
    if (name === null) continue;
    gap ??= parseFloat(getComputedStyle(name).fontSize) * NAME_GAP_EM;

    let box = chord.getBoundingClientRect();
    const sameRow = previous !== null && Math.abs(box.top - previous.top) < 1;
    const needed = previous !== null && sameRow ? Math.max(0, previous.right + gap - box.left) : 0;
    const current = parseFloat(chord.style.paddingLeft) || 0;
    if (Math.abs(needed - current) >= 0.5) {
      chord.style.paddingLeft = needed > 0 ? `${needed}px` : '';
      box = chord.getBoundingClientRect();
    }
    previous = { right: name.getBoundingClientRect().right, top: box.top };
  }
}

/**
 * The plugin that measures the names after every update of the view, and once when it starts.
 *
 * After every update rather than only when a chord changes, because typing a letter between two chords moves them
 * apart as surely as adding one moves them together. What the view cannot see - the lyric size, the window's width,
 * a font arriving late - the sheet answers by calling `spaceChordNames` itself.
 */
export function chordSpacingPlugin(): Plugin {
  return new Plugin({
    view: view => {
      spaceChordNames(view.dom);
      return { update: next => spaceChordNames(next.dom) };
    }
  });
}
