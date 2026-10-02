import {
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject
} from '@angular/core';
import { redo, redoDepth, undo, undoDepth } from 'prosemirror-history';
import { Node } from 'prosemirror-model';
import { EditorState, TextSelection, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { ChordAtomAttrs } from '../../../models/song.model';
import {
  SongEdit,
  SongKeyRules,
  commandOf,
  insertChord,
  moveChordTo,
  selectedChordOf
} from '../../../services/song-commands';
import { ChordAt, songMetaOf } from '../../../services/song-document';
import { CaretCoords, ChordFieldRequest, songEditorPlugins } from '../../../services/song-editor-plugins';
import { LyricSize } from '../../../services/song-sheet-preferences.service';
import { ChordNaming, ChordView, ChordViewHost, chordSpacingPlugin, spaceChordNames } from './chord-view';
import { lyricPlaceholderPlugin } from './lyric-placeholder';
import { SectionHost, SectionView } from './section-view';

/** A chord to open in its popover: which, and the box of its name on screen, which the popover hangs under. */
export interface ChordOpening {
  id: string;
  anchor: CaretCoords;
}

/** Whether the song's history has a step to undo and one to redo: what the toolbar's Undo and Redo show. */
export interface SheetHistory {
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * The song sheet: the ProseMirror editor that holds a song's words, chords and sections (design Part 2).
 *
 * **It owns the editor and nothing else.** The document's state is ProseMirror's `EditorState`, which this component
 * creates from `initialDoc` and keeps; the page learns of every change through `docChanged` and saves it, and changes
 * the song only by handing a `SongEdit` to `run`, so the toolbar's key, tempo and section commands act on this one
 * view and land in its one history. Taken as an input once, `initialDoc` is not watched: the page shows a sheet only
 * for a loaded song, and a different song is a different sheet.
 *
 * **Outside Angular's zone.** The view and its DOM listeners are created outside it, so a keystroke, a selection change
 * or a pointer move over the lyrics runs no change detection; the zone is re-entered only to emit. ProseMirror needs
 * nothing from Angular, and the sheet is the busiest surface on the page.
 *
 * **Chords are placed, opened and moved here, and edited by the page.** `[` asks for the chord field
 * (`chordFieldRequested`), and the page places what it reads with `placeChord`; a click on a name or Enter on a selected
 * chord asks for its popover (`chordOpened`), whose edits come back through `run`; and a chord's name is dragged to
 * another letter here, outright (`ChordView`), with a thin caret showing where it will land and a refused drop said on
 * `refused`. The field and the popover are the page's, not the sheet's: the sheet owns the editor and nothing else.
 * The Chords panel, which takes the focus when clicked, asks two things of the sheet to act on it: where the caret
 * was (`lastCaret`) and which chord is selected (`selectedChord`, and `selectedChordChanged` to mark its cell).
 *
 * **What the page shows it with** - names or numerals, the lyric size, the key rules chord names are worked out by -
 * are inputs, because they are the viewer's or the app's and not the song's (`SongSheetPreferencesService`). A change
 * to any of them, or to the song's key, re-renders every chord's name and measures the lines again.
 *
 * Its styles reach into ProseMirror's DOM with `:host ::ng-deep` under `.song-sheet`, which this component owns: that
 * DOM is built outside Angular's templates, so emulated encapsulation never marks it (brief decision 10).
 */
@Component({
  selector: 'app-song-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './song-sheet.component.html',
  styleUrls: ['./song-sheet.component.scss']
})
export class SongSheetComponent implements AfterViewInit, AfterViewChecked, OnChanges, OnDestroy {
  /** The song to edit, as `songNodeOf` accepted it. Read once, when the editor is made. */
  @Input() initialDoc: Node | null = null;
  /** The app's rules for keys and scales: a chord's name needs the scale its key's id names. */
  @Input() keys: Pick<SongKeyRules, 'chordScaleFor'> | null = null;
  /** Roman numerals over the words rather than chord names. */
  @Input() numerals = false;
  @Input() lyricSize: LyricSize = 'medium';

  /** Every new document, after any change to it - typing, a command, an undo. */
  @Output() readonly docChanged = new EventEmitter<Node>();
  /** Why a command - from `run`, a key, or a section's menu - was refused. */
  @Output() readonly refused = new EventEmitter<string>();
  /** What a section's menu did, for the page's live region: "Deleted Verse 2. Undo brings it back." */
  @Output() readonly notice = new EventEmitter<string>();
  @Output() readonly historyChanged = new EventEmitter<SheetHistory>();
  /**
   * `[` pressed on a line with words: the chord field is wanted at `pos`. Only while something listens - with
   * nothing bound, `[` is typed as itself, so the sheet never swallows a key it has no answer for.
   */
  @Output() readonly chordFieldRequested = new EventEmitter<ChordFieldRequest>();
  /**
   * A chord's popover is wanted: its name was clicked, or Enter pressed with it selected. The chord is selected. Enter
   * asks only while something listens - with nothing bound, Enter on a selected chord splits the line after it.
   */
  @Output() readonly chordOpened = new EventEmitter<ChordOpening>();
  /**
   * The chord selected on the sheet changed: a chord was selected, the selection left it, or the selected chord itself
   * was rewritten - a key change, a chord change - so whatever shows it is out of date. Null when no chord is selected.
   * Only on a change, so a keystroke in the words, which moves the caret on every press, emits nothing.
   */
  @Output() readonly selectedChordChanged = new EventEmitter<ChordAtomAttrs | null>();
  /**
   * A section's ⋮ → Open in Progression: the section with this id is to go to the Progression page. The page does it -
   * it saves the song first, and leaving is the page's to do - so the sheet only asks, and changes nothing.
   */
  @Output() readonly progressionOpened = new EventEmitter<string>();

  @ViewChild('mount', { static: true }) private mount?: ElementRef<HTMLElement>;
  @ViewChild('dropCaret', { static: true }) private dropCaret?: ElementRef<HTMLElement>;

  private readonly zone = inject(NgZone);
  private view: EditorView | null = null;
  /** Every chord's view now on the sheet, so a key or toggle change can re-render them all. */
  private readonly chordViews = new Set<ChordView>();
  private naming: ChordNaming = { key: { tonic: 0, scaleId: 'ionian', preferSharps: true }, scaleIntervals: null, numerals: false };
  private history: SheetHistory = { canUndo: false, canRedo: false };
  /** The selected chord's attributes as last emitted on `selectedChordChanged`. */
  private selected: ChordAtomAttrs | null = null;
  /** Whether the lyrics have had the focus, so the caret is one the user put somewhere (`lastCaret`). */
  private caretChosen = false;
  private resizes: ResizeObserver | null = null;
  /** The frame a resize is to be measured in, while one is waiting: however many resizes come first, one measure. */
  private resizeFrame: number | null = null;
  /** Set when an input changed what the lines look like; the lines are measured once the view has caught up. */
  private remeasureDue = false;

  ngAfterViewInit(): void {
    const doc = this.initialDoc;
    const mount = this.mount?.nativeElement;
    if (doc === null || mount === undefined) return;

    this.naming = this.namingFor(doc);
    this.zone.runOutsideAngular(() => {
      const state = EditorState.create({
        doc,
        plugins: [
          ...songEditorPlugins({
            onChordFieldRequest: this.chordFieldRequested.observed
              ? request => this.zone.run(() => this.chordFieldRequested.emit(request))
              : undefined,
            onRefuse: reason => this.zone.run(() => this.refused.emit(reason)),
            onChordOpen: this.chordOpened.observed ? chord => this.openChordAt(chord) : undefined,
            // Read through on each use, so a new `keys` input reaches the bracket rule without a new editor.
            keys: { chordScaleFor: key => this.keys?.chordScaleFor(key) ?? null }
          }),
          lyricPlaceholderPlugin(),
          chordSpacingPlugin()
        ]
      });

      this.view = new EditorView(mount, {
        state,
        dispatchTransaction: tr => this.dispatch(tr),
        nodeViews: {
          chord: (node, view, getPos) => new ChordView(node, view, getPos, this.chordHost(view)),
          section: (node, view) => new SectionView(node, this.sectionHost(view))
        },
        handleDOMEvents: {
          // Noted and left to ProseMirror: it has its own work to do on focus.
          focus: () => {
            this.caretChosen = true;
            return false;
          },
          mouseup: view => {
            this.catchUpCaret(view);
            return false;
          }
        },
        attributes: {
          class: 'song-sheet-editor',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': 'Lyrics and chords',
          spellcheck: 'true'
        }
      });

      // A narrower window wraps lines differently, and a late font changes every name's width: both move collisions.
      // A resize is measured on the next frame, not in the observer's callback: padding that wraps a line makes the
      // sheet taller, and a size the callback itself changes is one the browser cannot report in the same frame - it
      // reports an error instead ("ResizeObserver loop completed with undelivered notifications"). Measured a frame
      // later, that height change is reported like any other, and the measure it leads to lays out the same padding
      // again, because measuring gives the same layout every time (`spaceChordNames`) - so no size changes, and the
      // observer falls quiet. The one frame drawn before the measure is a frame of a window being resized.
      this.resizes = new ResizeObserver(() => this.remeasureNextFrame());
      this.resizes.observe(mount);
      void document.fonts?.ready.then(() => this.remeasure());
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.view === null) return;
    if (changes['numerals'] || changes['keys']) {
      this.naming = this.namingFor(this.view.state.doc);
      this.renderChords();
    }
    if (changes['numerals'] || changes['keys'] || changes['lyricSize']) this.remeasureDue = true;
  }

  /** The lyric size is a binding, so its lines are measured only after this view has applied it. */
  ngAfterViewChecked(): void {
    if (!this.remeasureDue) return;
    this.remeasureDue = false;
    this.remeasure();
  }

  ngOnDestroy(): void {
    this.resizes?.disconnect();
    if (this.resizeFrame !== null) cancelAnimationFrame(this.resizeFrame);
    this.view?.destroy();
    this.view = null;
  }

  /**
   * Runs a song command on the sheet: dispatched as one undo step when it changes something, its reason emitted on
   * `refused` when it is refused. True when the song changed.
   */
  run(edit: SongEdit): boolean {
    const view = this.view;
    if (view === null) return false;
    return commandOf(edit, reason => this.zone.run(() => this.refused.emit(reason)))(view.state, tr => this.dispatch(tr));
  }

  undo(): boolean {
    const view = this.view;
    return view !== null && undo(view.state, tr => this.dispatch(tr));
  }

  redo(): boolean {
    const view = this.view;
    return view !== null && redo(view.state, tr => this.dispatch(tr));
  }

  /**
   * Places the chord `attrs` at `pos` - where `[` was pressed, as the chord field recorded it - as one undo step, and
   * puts the focus back in the lyrics with the caret just after the chord, for the word it sits over. True when it was
   * placed; a refusal is emitted on `refused`, and the focus comes back either way.
   */
  placeChord(pos: number, attrs: ChordAtomAttrs): boolean {
    const placed = this.run(insertChord(attrs, pos));
    this.focus();
    return placed;
  }

  /**
   * Where a chord placed from outside the sheet goes - the Chords panel's click - or null when the lyrics have never
   * had the focus.
   *
   * **The editor's own selection, kept.** ProseMirror's state holds the selection whether or not the editor has the
   * focus: a press on a panel button takes the focus and leaves the state's selection where it was, and every
   * transaction since - typing, a transpose from the panel, an undo - maps it as it maps the caret, because it *is* the
   * caret. So no copy is kept and nothing is mapped by hand; this reads the selection's start, which is where
   * `insertChord` puts a chord on selected words and where `[` records its place (`ChordFieldRequest.pos`). The one
   * thing done is to read a click's caret as the click ends, before ProseMirror would (`catchUpCaret`), so a cell
   * pressed straight after it does not find the caret from before.
   *
   * **Null until the lyrics have had the focus.** A new state's selection is the first position in the song, which
   * no one chose: a chord placed there before the user has been in the lyrics at all would land on the first word
   * unasked. The page hands null on as a place no line can hold, so the refusal and its words are `insertChord`'s.
   */
  lastCaret(): number | null {
    const view = this.view;
    if (view === null || !this.caretChosen) return null;
    return view.state.selection.from;
  }

  /** The chord selected on the sheet - a click on its name, Alt+arrows, a chord placed by drag - or null. */
  selectedChord(): ChordAt | null {
    const view = this.view;
    return view === null ? null : selectedChordOf(view.state);
  }

  /** Puts the focus in the lyrics, at the caret. */
  focus(): void {
    this.view?.focus();
  }

  /** The editor's state now, or null before the editor is made. */
  editorState(): EditorState | null {
    return this.view?.state ?? null;
  }

  /**
   * Applies a transaction - with whatever the plugins append to it - and tells the page what changed.
   *
   * A key change is seen here, by the doc's `key` attribute changing, and the chord names follow it in the same
   * dispatch: the naming is swapped before the view updates, so a chord the change rewrote renders in the new key, and
   * every other chord is re-rendered after.
   */
  private dispatch(tr: Transaction): void {
    const view = this.view;
    if (view === null) return;
    const before = view.state;
    const state = before.apply(tr);
    const rekeyed = state.doc.attrs['key'] !== before.doc.attrs['key'];
    if (rekeyed) this.naming = this.namingFor(state.doc);

    view.updateState(state);
    if (rekeyed) {
      this.renderChords();
      this.remeasure();
    }

    const history: SheetHistory = { canUndo: undoDepth(state) > 0, canRedo: redoDepth(state) > 0 };
    const historyMoved = history.canUndo !== this.history.canUndo || history.canRedo !== this.history.canRedo;
    this.history = history;
    // By identity: an atom no step touched keeps its node, and so its attributes object, through any amount of typing
    // around it, while a step that rewrites it - a re-key, a new chord - makes a new one.
    const selected = selectedChordOf(state)?.attrs ?? null;
    const selectionMoved = selected !== this.selected;
    this.selected = selected;
    if (state.doc === before.doc && !historyMoved && !selectionMoved) return;

    this.zone.run(() => {
      if (state.doc !== before.doc) this.docChanged.emit(state.doc);
      if (historyMoved) this.historyChanged.emit(history);
      if (selectionMoved) this.selectedChordChanged.emit(selected);
    });
  }

  /**
   * Reads into the editor the caret a click in the words has just put down, as the click ends.
   *
   * The browser moves its caret on the press, but ProseMirror learns of it from `selectionchange`, which Chrome fires
   * a task later - and ignores once the editor has lost the focus. A press on a Chords panel cell straight after the
   * click can take the focus in between, and the chord then goes to the caret before the click. So the browser's
   * caret is read here, at `mouseup`, while the editor still has the focus; ProseMirror's own reading a moment later
   * finds the state already there and changes nothing.
   *
   * At the end of a click and not as the focus leaves: a keystroke's text can be in the browser's DOM before
   * ProseMirror has read it, and a caret read then would be ahead of the document - but a click types nothing. A press
   * on a chord's name never gets here (`ChordView` keeps its own events), and a browser selection anywhere but in a
   * line of words is left alone.
   */
  private catchUpCaret(view: EditorView): void {
    const state = view.state;
    const dom = view.dom.ownerDocument.getSelection();
    if (dom === null) return;
    const { anchorNode, anchorOffset, focusNode, focusOffset } = dom;
    if (anchorNode === null || focusNode === null) return;
    if (!view.dom.contains(anchorNode) || !view.dom.contains(focusNode)) return;

    let anchor: number;
    let head: number;
    try {
      anchor = view.posAtDOM(anchorNode, anchorOffset);
      head = view.posAtDOM(focusNode, focusOffset);
    } catch {
      // A node ProseMirror does not map (a chord name's own text): nothing to read.
      return;
    }
    if (anchor === state.selection.anchor && head === state.selection.head) return;
    const $anchor = state.doc.resolve(anchor);
    const $head = state.doc.resolve(head);
    if (!$anchor.parent.inlineContent || !$head.parent.inlineContent) return;
    this.dispatch(state.tr.setSelection(TextSelection.between($anchor, $head)));
  }

  private namingFor(doc: Node): ChordNaming {
    const key = songMetaOf(doc).key;
    return { key, scaleIntervals: this.keys?.chordScaleFor(key) ?? null, numerals: this.numerals };
  }

  private renderChords(): void {
    for (const chord of this.chordViews) chord.render();
  }

  private remeasure(): void {
    if (this.view !== null) spaceChordNames(this.view.dom);
  }

  /** Measures on the next frame, once, however many times it is asked before then (see the `ResizeObserver`). */
  private remeasureNextFrame(): void {
    if (this.resizeFrame !== null) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = null;
      this.remeasure();
    });
  }

  /** What each chord's view may ask of this sheet. */
  private chordHost(view: EditorView): ChordViewHost {
    return {
      naming: () => this.naming,
      views: this.chordViews,
      open: (id, name) =>
        this.zone.run(() => this.chordOpened.emit({ id, anchor: anchorOf(name.getBoundingClientRect()) })),
      showDropCaret: pos => this.showDropCaret(view, pos),
      drop: (id, pos) => {
        // No position at all - a drop off the sheet - is handed on as one no line can hold, so the refusal and its
        // words are `moveChordTo`'s, the same as for a drop between sections.
        this.run(moveChordTo(id, pos ?? Number.NaN));
        view.focus();
      }
    };
  }

  /** Enter on a selected chord: its popover, hung under its name - or under its place in the line, if no name is drawn. */
  private openChordAt(chord: ChordAt): void {
    const view = this.view;
    if (view === null) return;
    const dom = view.nodeDOM(chord.pos);
    const name = dom instanceof HTMLElement ? dom.querySelector('.song-chord-name') : null;
    const anchor = name === null ? view.coordsAtPos(chord.pos) : name.getBoundingClientRect();
    this.zone.run(() => this.chordOpened.emit({ id: chord.attrs.id, anchor: anchorOf(anchor) }));
  }

  /**
   * Shows the drop caret at `pos` while a chord is dragged, or hides it - and hides it too where the chord could not be
   * dropped, so the caret appears only where letting go would move the chord.
   *
   * Written to the element's style directly rather than bound: this runs on every pointer move, outside Angular's
   * zone, and a change detection pass per move would be all cost - the same reason the editor itself runs outside it.
   */
  private showDropCaret(view: EditorView, pos: number | null): void {
    const caret = this.dropCaret?.nativeElement;
    if (caret === undefined) return;
    const doc = view.state.doc;
    if (pos === null || pos > doc.content.size || doc.resolve(pos).parent.type.name !== 'lyricLine') {
      caret.hidden = true;
      return;
    }
    // The caret is positioned in the sheet's own box, which scrolls with the lyrics.
    const frame = caret.parentElement?.getBoundingClientRect();
    const at = view.coordsAtPos(pos);
    caret.style.left = `${at.left - (frame?.left ?? 0)}px`;
    caret.style.top = `${at.top - (frame?.top ?? 0)}px`;
    caret.style.height = `${at.bottom - at.top}px`;
    caret.hidden = false;
  }

  /** What one section's header may do on this sheet. */
  private sectionHost(view: EditorView): SectionHost {
    return {
      run: edit => this.run(edit),
      state: () => view.state,
      notify: message => this.zone.run(() => this.notice.emit(message)),
      focusEditor: () => view.focus(),
      focusSectionMenu: id =>
        view.dom
          .querySelector<HTMLElement>(`[data-section-id="${CSS.escape(id)}"] .song-section-menu-toggle`)
          ?.focus(),
      openInProgression: id => this.zone.run(() => this.progressionOpened.emit(id))
    };
  }
}

/** A box on screen as the three edges an anchored popup needs. */
function anchorOf(box: { left: number; top: number; bottom: number }): CaretCoords {
  return { left: box.left, top: box.top, bottom: box.bottom };
}
