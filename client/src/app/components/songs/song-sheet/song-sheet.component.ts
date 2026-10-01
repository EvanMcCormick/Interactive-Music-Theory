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
import { EditorState, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { SongEdit, SongKeyRules, commandOf } from '../../../services/song-commands';
import { songMetaOf } from '../../../services/song-document';
import { ChordFieldRequest, songEditorPlugins } from '../../../services/song-editor-plugins';
import { LyricSize } from '../../../services/song-sheet-preferences.service';
import { ChordNaming, ChordView, chordSpacingPlugin, spaceChordNames } from './chord-view';
import { lyricPlaceholderPlugin } from './lyric-placeholder';
import { SectionHost, SectionView } from './section-view';

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
   * `[` pressed on a line with words: the chord field is wanted at `pos` (task 7). Only while something listens - with
   * nothing bound, `[` is typed as itself, so the sheet never swallows a key it has no answer for.
   */
  @Output() readonly chordFieldRequested = new EventEmitter<ChordFieldRequest>();

  @ViewChild('mount', { static: true }) private mount?: ElementRef<HTMLElement>;

  private readonly zone = inject(NgZone);
  private view: EditorView | null = null;
  /** Every chord's view now on the sheet, so a key or toggle change can re-render them all. */
  private readonly chordViews = new Set<ChordView>();
  private naming: ChordNaming = { key: { tonic: 0, scaleId: 'ionian', preferSharps: true }, scaleIntervals: null, numerals: false };
  private history: SheetHistory = { canUndo: false, canRedo: false };
  private resizes: ResizeObserver | null = null;
  /** Set when an input changed what the lines look like; the lines are measured once the view has caught up. */
  private remeasureDue = false;

  ngAfterViewInit(): void {
    const doc = this.initialDoc;
    const mount = this.mount?.nativeElement;
    if (doc === null || mount === undefined) return;

    this.naming = this.namingFor(doc);
    this.zone.runOutsideAngular(() => {
      const listening = this.chordFieldRequested.observed;
      const state = EditorState.create({
        doc,
        plugins: [
          ...songEditorPlugins({
            onChordFieldRequest: listening
              ? request => this.zone.run(() => this.chordFieldRequested.emit(request))
              : undefined,
            onRefuse: reason => this.zone.run(() => this.refused.emit(reason))
          }),
          lyricPlaceholderPlugin(),
          chordSpacingPlugin()
        ]
      });

      this.view = new EditorView(mount, {
        state,
        dispatchTransaction: tr => this.dispatch(tr),
        nodeViews: {
          chord: (node, view, getPos) => new ChordView(node, view, getPos, () => this.naming, this.chordViews),
          section: (node, view) => new SectionView(node, this.sectionHost(view))
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
      this.resizes = new ResizeObserver(() => this.remeasure());
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
    if (state.doc === before.doc && !historyMoved) return;

    this.zone.run(() => {
      if (state.doc !== before.doc) this.docChanged.emit(state.doc);
      if (historyMoved) this.historyChanged.emit(history);
    });
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
          ?.focus()
    };
  }
}
