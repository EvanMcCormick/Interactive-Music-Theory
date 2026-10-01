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
 * Part 2), the name as the handle a click opens and a drag moves (`ChordView`), and the measuring that keeps two
 * names from colliding.
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
 * What a chord's view asks of the sheet it is on: how to name it, where to list itself, and what to do when its name
 * is clicked or dragged.
 */
export interface ChordViewHost {
  /** The key, scale and names/numerals toggle a chord's name is worked out from, as they are now. */
  naming(): ChordNaming;
  /** Every chord view now on the sheet, so a key or toggle change can re-render them all. */
  readonly views: Set<ChordView>;
  /** The name was clicked - the chord is selected - and its popover is wanted, under `name`. */
  open(id: string, name: HTMLElement): void;
  /** A drag would drop the chord at `pos` now: show where, or nothing for null. */
  showDropCaret(pos: number | null): void;
  /** The chord `id` was dropped at `pos`, or where the sheet has no position (null). */
  drop(id: string, pos: number | null): void;
}

/** How far, in CSS pixels, a press on a name must move before it is a drag rather than a click. */
export const DRAG_THRESHOLD_PX = 4;

/**
 * The events on a chord that are the chord's own, which ProseMirror is told to leave alone (`stopEvent`): its press,
 * click and drag, and every pointer event. Not a drop of something else onto it, which is ProseMirror's to place in
 * the line.
 */
const OWN_EVENTS: ReadonlySet<string> = new Set([
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'dragstart',
  'touchstart',
  'touchmove'
]);

/** A press on the name, from `pointerdown` until it is let go or cancelled. */
interface Press {
  pointerId: number;
  x: number;
  y: number;
  /** Past the threshold: a drag. Short of it at `pointerup`: a click, which the `click` event that follows handles. */
  dragging: boolean;
}

/**
 * The chord atom's node view: an empty `span.song-chord` carrying the name in `span.song-chord-name`.
 *
 * Its name is asked of the host on every render rather than held, because what it depends on - the song's key and the
 * names/numerals toggle - lives outside the atom: ProseMirror calls `update` only when the atom itself changes, so
 * the sheet calls `render` on every live view (`views`) when the key or the toggle does.
 *
 * ## Clicking and dragging the name
 *
 * The name is the chord's handle (design Part 2). A **click** selects the chord, as a `NodeSelection` - what Alt+arrows
 * and Delete act on - and asks the host to open its popover. A **drag** - a press that moves `DRAG_THRESHOLD_PX` or more
 * - carries the name with the pointer, shows a thin caret where it would land, and on release asks the host to move the
 * chord there (`moveChordTo`). Its timing does not change: the word only places it (design decision 3).
 *
 * **Pointer events with pointer capture**, not HTML5 drag and drop: capture keeps the moves and the release coming to
 * the name even when the pointer leaves it or the window, and one code path serves a mouse, a pen and a finger. Where
 * it lands is the letter just under the moved name's left edge, which is where a name sits over its letter - so what
 * the user sees during the drag is where the chord goes, and the point asked of `posAtCoords` is under the name rather
 * than on it, so the name never hides the line from the hit test.
 *
 * **ProseMirror's own drag is kept out.** The chord node is `draggable` in the schema, so ProseMirror marks the
 * chord's DOM `draggable` as it renders it - after this view is built, over anything set here - and would mark it so
 * on a press anyway once the chord is selected, schema or not. A press and a move would then start the browser's
 * HTML5 drag, and ProseMirror's own `dragstart` and `drop` would move the node as a slice: a second move of the same
 * chord, racing this one. Three things stop it. `stopEvent` tells ProseMirror that a press, click or drag on the
 * chord is the chord's, so its mouse and drag handling never see them; the `mousedown` is cancelled, which keeps the
 * browser from starting a text selection or moving its caret on a press that is the name's; and the `dragstart` is
 * cancelled, so no HTML5 drag ever starts from a chord, whatever its `draggable` says.
 *
 * A press that became a drag ends in a `click` too - down and up were both on the captured name - and that click is
 * swallowed, so a drag does not also open the popover.
 */
export class ChordView implements NodeView {
  readonly dom: HTMLElement;
  private readonly name: HTMLElement;
  private press: Press | null = null;
  /** Set when a drag ends: the `click` the browser fires next belongs to the drag. Cleared by it, or the next press. */
  private swallowClick = false;

  constructor(
    private node: Node,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly host: ChordViewHost
  ) {
    this.dom = document.createElement('span');
    this.dom.className = 'song-chord';
    // An image of a chord symbol, named by its label: `aria-label` alone is not allowed on a plain span.
    this.dom.setAttribute('role', 'img');
    this.name = document.createElement('span');
    this.name.className = 'song-chord-name';
    this.name.setAttribute('aria-hidden', 'true');
    this.dom.append(this.name);

    this.dom.addEventListener('mousedown', this.onMouseDown);
    this.dom.addEventListener('dragstart', this.onDragStart);
    this.dom.addEventListener('click', this.onClick);
    this.name.addEventListener('pointerdown', this.onPointerDown);
    this.name.addEventListener('pointermove', this.onPointerMove);
    this.name.addEventListener('pointerup', this.onPointerUp);
    this.name.addEventListener('pointercancel', this.onPointerCancel);

    host.views.add(this);
    this.render();
  }

  /** Writes the name and label for the current key and toggle; only what changed, so an unchanged name costs no layout. */
  render(): void {
    const label = chordLabelOf(this.node.attrs as ChordAtomAttrs, this.host.naming());
    if (this.name.textContent !== label.text) this.name.textContent = label.text;
    if (this.dom.getAttribute('aria-label') !== label.spoken) this.dom.setAttribute('aria-label', label.spoken);
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  /** A press, click or drag on the chord is the chord's (see the class comment). */
  stopEvent(event: Event): boolean {
    return OWN_EVENTS.has(event.type) || event.type.includes('pointer');
  }

  /** The view's own spacing, the name's text and its drag are this view's business: nothing for ProseMirror to re-read. */
  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    if (this.press?.dragging) this.host.showDropCaret(null);
    this.press = null;
    this.dom.removeEventListener('mousedown', this.onMouseDown);
    this.dom.removeEventListener('dragstart', this.onDragStart);
    this.dom.removeEventListener('click', this.onClick);
    this.name.removeEventListener('pointerdown', this.onPointerDown);
    this.name.removeEventListener('pointermove', this.onPointerMove);
    this.name.removeEventListener('pointerup', this.onPointerUp);
    this.name.removeEventListener('pointercancel', this.onPointerCancel);
    this.host.views.delete(this);
  }

  /** Cancelled, so neither the browser nor ProseMirror acts on a press that is the chord's (see the class comment). */
  private readonly onMouseDown = (event: MouseEvent): void => {
    event.preventDefault();
  };

  /** Cancelled: a chord moves by its own drag, never by the browser's (see the class comment). */
  private readonly onDragStart = (event: DragEvent): void => {
    event.preventDefault();
  };

  /** A click that was not the end of a drag: select the chord, put the focus in the sheet, and ask for its popover. */
  private readonly onClick = (): void => {
    if (this.swallowClick) {
      this.swallowClick = false;
      return;
    }
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
    this.view.focus();
    this.host.open(this.node.attrs['id'], this.name);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary) return;
    this.swallowClick = false;
    this.press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
    this.name.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const press = this.press;
    if (press === null || event.pointerId !== press.pointerId) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (!press.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      press.dragging = true;
      this.dom.classList.add('is-dragging');
    }
    this.name.style.transform = `translate(${dx}px, ${dy}px)`;
    this.host.showDropCaret(this.dropPos());
  };

  /** The end of a press: a drag drops the chord; anything shorter is left to the `click` that follows. */
  private readonly onPointerUp = (event: PointerEvent): void => {
    const press = this.press;
    if (press === null || event.pointerId !== press.pointerId) return;
    this.press = null;
    if (!press.dragging) return;

    const pos = this.dropPos();
    this.endDrag();
    this.swallowClick = true;
    this.host.drop(this.node.attrs['id'], pos);
  };

  /** The browser took the pointer back - a touch turned into a scroll, a system gesture: the chord stays where it was. */
  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (this.press === null || event.pointerId !== this.press.pointerId) return;
    const wasDragging = this.press.dragging;
    this.press = null;
    if (wasDragging) this.endDrag();
  };

  private endDrag(): void {
    this.name.style.transform = '';
    this.dom.classList.remove('is-dragging');
    this.host.showDropCaret(null);
  }

  /**
   * Where the chord would land now: the position at the letter under the moved name's left edge, half a name's height
   * below it - in the line of words the name sits over - or null where the sheet has no position at all.
   */
  private dropPos(): number | null {
    const box = this.name.getBoundingClientRect();
    return this.view.posAtCoords({ left: box.left + 1, top: box.bottom + box.height / 2 })?.pos ?? null;
  }
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
