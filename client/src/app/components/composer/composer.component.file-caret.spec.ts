import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import * as alphaTab from '@coderline/alphatab';

import { ComposerComponent, paletteStateOf } from './composer.component';
import { ComposerLibraryPanelComponent } from './components/composer-library-panel/composer-library-panel.component';
import { ComposerScoreComponent } from './components/composer-score/composer-score.component';
import { AlphaTexService } from '../../services/alpha-tex.service';
import { ComposerGpService } from '../../services/composer-gp.service';
import { ComposerLibraryService } from '../../services/composer-library.service';
import { popoverValuesOf } from '../../services/composer-popover-values';
import { ComposerService } from '../../services/composer.service';
import { GP_LIBRARY_DB } from '../../services/gp-library.service';
import { deletedDatabase } from '../../services/indexed-db.spec-helper';

@Component({ selector: 'app-composer-score', standalone: true, template: '' })
class StubScoreComponent {
  @Input() highlight: unknown = null;
  ignoreNextPress(): void {
    // The score is stubbed: nothing here presses it.
  }
}

@Component({ selector: 'app-composer-library-panel', standalone: true, template: '' })
class StubLibraryPanelComponent {
  @Input() modalOpen = false;
  @Output() readonly menuOpened = new EventEmitter<void>();
}

/**
 * The page over the file's own caret in Original (`ComposerGpService.caret`): what reads the selection - Copy, the palette's
 * states, the popovers' values - reads the file's, not the empty composition under it, and what clears it - Escape -
 * clears the file's. Kept apart from `composer.component.spec.ts`, which is past the line cap.
 *
 * The score and the library panel are stubbed, as there; a press on the score reaches the caret as `setCursor`, which is
 * what the score's own press calls.
 */
describe('ComposerComponent over the file\'s caret', () => {
  let fixture: ComponentFixture<ComposerComponent>;
  let gp: ComposerGpService;
  let composer: ComposerService;
  const gpDb = `gp-library-file-caret-spec-${Math.random().toString(36).slice(2)}`;

  afterAll(async () => {
    await deletedDatabase(gpDb);
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerComponent], providers: [provideRouter([]), { provide: GP_LIBRARY_DB, useValue: gpDb }] })
      .overrideComponent(ComposerComponent, {
        remove: { imports: [ComposerScoreComponent, ComposerLibraryPanelComponent] },
        add: { imports: [StubScoreComponent, StubLibraryPanelComponent] }
      })
      .compileComponents();

    gp = TestBed.inject(ComposerGpService);
    composer = TestBed.inject(ComposerService);
    fixture = TestBed.createComponent(ComposerComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  /** Opens `source`, read as alphaTex and then changed by `change`, as the file `Band.gp`. */
  async function openFile(source: string, change: (score: alphaTab.model.Score) => void = () => undefined): Promise<void> {
    const score = TestBed.inject(AlphaTexService).parse(source).score;
    if (!score) throw new Error('the file did not parse');
    change(score);
    gp.open({ entryId: 'entry-1', fileName: 'Band.gp', bytes: new ArrayBuffer(4), score });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function press(init: KeyboardEventInit): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    fixture.detectChanges();
  }

  /** Resolves once `done` holds, checking every few milliseconds for up to two seconds: IndexedDB answers outside the zone. */
  async function until(done: () => boolean): Promise<void> {
    for (let waited = 0; !done() && waited < 2000; waited += 10) await new Promise(resolve => setTimeout(resolve, 10));
    fixture.detectChanges();
  }

  const promptOpen = (): boolean =>
    (fixture.nativeElement as HTMLElement).querySelector('app-composer-convert-prompt .prompt')?.classList.contains('open') ?? false;
  const promptButton = (label: string): HTMLButtonElement | undefined =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('app-composer-convert-prompt .prompt button')).find(
      button => button.textContent?.trim() === label
    );
  const tool = (id: string): HTMLButtonElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-tool="${id}"]`);

  const riff = ['\\title "Riff"', '\\track "Guitar"', '3.3.4 5.3.4 7.3.4 8.3.4 | 0.3.4 0.3.4 0.3.4 0.3.4 |'].join('\n');

  it("copies the file's range, and pastes it once converted: Shift-select, Ctrl+C, a click elsewhere, Ctrl+V", async () => {
    spyOn(TestBed.inject(ComposerLibraryService), 'save').and.resolveTo('composition-1');
    await openFile(riff);

    press({ key: 'ArrowRight', shiftKey: true });
    press({ key: 'c', code: 'KeyC', ctrlKey: true });
    expect(promptOpen()).withContext('Copy reads; it does not ask').toBeFalse();
    expect(composer.state.refusal).toBeNull();
    composer.setCursor({ barIndex: 1, beatIndex: 0 });
    press({ key: 'v', code: 'KeyV', ctrlKey: true });
    expect(promptOpen()).withContext('Paste writes, so it asks').toBeTrue();

    promptButton('Convert')?.click();
    await until(() => !gp.isOriginal);

    const frets = (barIndex: number) =>
      composer.doc.tracks[0].staves[0].bars[barIndex].voices[0].beats.map(beat => beat.notes.map(note => (note.pitch.kind === 'fretted' ? note.pitch.fret : null)));
    expect(frets(1)).toEqual([[3], [5], [0], [0]]);
    expect(frets(0)).withContext('the range copied, as the file had it').toEqual([[3], [5], [7], [8]]);
  });

  it('refuses Copy, saying why, when the file could not be read as a document', async () => {
    await openFile(riff);
    const original = gp.original;
    if (!original) throw new Error('no file is open');
    (original as { doc: unknown }).doc = null;

    press({ key: 'c', code: 'KeyC', ctrlKey: true });

    expect(composer.state.refusal).toBe('The file could not be read as a composition, so nothing can be copied from it.');
  });

  it("asks before Cut, which writes, and selects all of the file's staff without asking", async () => {
    await openFile(riff);

    press({ key: 'a', code: 'KeyA', ctrlKey: true });
    expect(promptOpen()).toBeFalse();
    expect(gp.caret?.anchor).toEqual(jasmine.objectContaining({ barIndex: 0, beatIndex: 0 }));
    expect(gp.caret?.cursor).toEqual(jasmine.objectContaining({ barIndex: 1, beatIndex: 3 }));

    press({ key: 'x', code: 'KeyX', ctrlKey: true });
    expect(promptOpen()).toBeTrue();
    expect(gp.request?.id).toBe('cut');
  });

  it("clears the file's range on Escape, leaving its caret where it is", async () => {
    await openFile(riff);
    composer.setCursor({ barIndex: 1 });
    press({ key: 'ArrowRight', shiftKey: true });
    expect(gp.caret?.anchor).not.toBeNull();

    press({ key: 'Escape' });

    expect(gp.caret?.anchor).toBeNull();
    expect(gp.caret?.cursor).toEqual(jasmine.objectContaining({ barIndex: 1, beatIndex: 1 }));
  });

  it("draws the palette for the note under the file's caret, not the empty composition's", async () => {
    await openFile(riff, score => (score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].isPalmMute = true));
    // On the third string from the top, which the note is on.
    composer.setCursor({ stringIndex: 2 });
    fixture.detectChanges();
    expect(tool('palmMute')?.getAttribute('aria-pressed')).withContext('a palm-muted note under the caret').toBe('true');

    composer.setCursor({ beatIndex: 1 });
    fixture.detectChanges();

    expect(tool('palmMute')?.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('paletteStateOf', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  /** A guitar file in 3/4. */
  function waltz(): alphaTab.model.Score {
    const score = TestBed.inject(AlphaTexService).parse(['\\track "Guitar"', '\\ts 3 4', '3.3.4 3.3.4 3.3.4 |'].join('\n')).score;
    if (!score) throw new Error('the file did not parse');
    return score;
  }

  it("is the composition's state in Composition, and the file's document and caret in Original, keeping the rest", () => {
    const state = TestBed.inject(ComposerService).state;
    expect(paletteStateOf(state, null, null)).toBe(state);

    const file = TestBed.inject(ComposerGpService);
    file.open({ entryId: 'e', fileName: 'a.gp', bytes: new ArrayBuffer(1), score: waltz() });
    const view = paletteStateOf(state, file.original, file.caret);

    expect(view.doc).toBe(file.original?.doc as never);
    expect(view.cursor).toBe(file.caret?.cursor as never);
    expect(view.entryMode).toBe(state.entryMode);
    expect(popoverValuesOf(view.doc, view.anchor, view.cursor).timeSignature).toEqual(jasmine.objectContaining({ numerator: 3, denominator: 4 }));
  });

  it("is the composition's state when the file could not be read as a document", () => {
    const state = TestBed.inject(ComposerService).state;
    expect(paletteStateOf(state, { doc: null } as never, { cursor: state.cursor, anchor: null })).toBe(state);
  });
});
