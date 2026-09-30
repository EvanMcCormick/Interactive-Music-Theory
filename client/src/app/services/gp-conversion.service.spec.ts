import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTexService } from './alpha-tex.service';
import { ComposerGpService } from './composer-gp.service';
import { ComposerLibraryService } from './composer-library.service';
import { ComposerService } from './composer.service';
import { GpConversionService } from './gp-conversion.service';
import { GpLibraryService } from './gp-library.service';

/**
 * Convert, in the design's order - which is its error handling. The two libraries are spied rather than opened: what is
 * pinned here is which of them is written, deleted from or left alone at each step, and what the page is left showing.
 * The page's spec converts through real IndexedDB.
 */
describe('GpConversionService', () => {
  let conversion: GpConversionService;
  let gp: ComposerGpService;
  let composer: ComposerService;
  let tex: AlphaTexService;
  let save: jasmine.Spy;
  let deleteEntry: jasmine.Spy;
  let markOpened: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    conversion = TestBed.inject(GpConversionService);
    gp = TestBed.inject(ComposerGpService);
    composer = TestBed.inject(ComposerService);
    tex = TestBed.inject(AlphaTexService);
    const library = TestBed.inject(ComposerLibraryService);
    save = spyOn(library, 'save').and.resolveTo('composition-1');
    markOpened = spyOn(library, 'markOpened');
    deleteEntry = spyOn(TestBed.inject(GpLibraryService), 'deleteEntry').and.resolveTo();
  });

  /** Opens `source`, parsed as alphaTex, as the file `Band.gp` in entry `entry-1`. */
  function openFile(source: string): void {
    const { score } = tex.parse(source);
    if (!score) throw new Error('the file did not parse');
    gp.open({ entryId: 'entry-1', fileName: 'Band.gp', bytes: new ArrayBuffer(4), score });
  }

  const guitar = ['\\title "Riff"', '\\tempo 96', '\\track "Guitar"', '3.3.4 3.3.4 3.3.4 3.3.4 | 5.3.1 |'].join('\n');

  /** Holds a double bar on bar 1 as the edit that asked. */
  function askWithDoubleBar(): void {
    gp.requestEdit('doubleBar', 'Double bar', () => composer.toggleMasterBarFlag('isDoubleBar'));
  }

  it('writes the composition, deletes the file, and opens the composition clean with the edit on its own undo step', async () => {
    openFile(guitar);
    askWithDoubleBar();

    const outcome = await conversion.convert();

    expect(outcome).toEqual({ kind: 'converted', compositionId: 'composition-1', originalKept: false });
    expect(save).toHaveBeenCalledWith(jasmine.objectContaining({ title: 'Riff', tempo: 96, trackCount: 1, barCount: 2 }));
    expect(deleteEntry).toHaveBeenCalledWith('entry-1');
    expect(markOpened).toHaveBeenCalledWith('composition-1');
    expect(gp.isOriginal).toBeFalse();
    expect(composer.doc.title).toBe('Riff');
    expect(composer.doc.masterBars[0].isDoubleBar).toBeTrue();

    composer.undo();
    expect(composer.doc.masterBars[0].isDoubleBar).toBeFalse();
    expect(composer.state.canUndo).toBeFalse();
  });

  it('saves the alphaTex it proved reopens', async () => {
    openFile(guitar);
    askWithDoubleBar();

    await conversion.convert();

    const written = (save.calls.mostRecent().args[0] as { tex: string }).tex;
    expect(tex.parse(written).score).not.toBeNull();
  });

  it('names a file with no title after its file name', async () => {
    openFile(['\\track "Guitar"', '3.3.4 3.3.4 3.3.4 3.3.4 |'].join('\n'));
    askWithDoubleBar();

    await conversion.convert();

    expect(composer.doc.title).toBe('Band');
    expect(save).toHaveBeenCalledWith(jasmine.objectContaining({ title: 'Band' }));
  });

  it('refuses a drum kit alphaTex cannot name, naming the track, and writes and deletes nothing', async () => {
    openFile(['\\track "Kit" {instrument percussion}', '\\articulation defaults', '"Snare (hit)".4 r.4 r.2 |'].join('\n'));
    const kit = gp.original!.score.tracks[0];
    const head = alphaTab.model.MusicFontSymbol.NoteheadBlack;
    kit.percussionArticulations.push(new alphaTab.model.InstrumentArticulation('Mystery', 5, 77, head, head, head, alphaTab.model.MusicFontSymbol.None, undefined, 999));
    kit.staves[0].bars[0].voices[0].beats[0].notes[0].percussionArticulation = kit.percussionArticulations.length - 1;
    askWithDoubleBar();
    const before = composer.doc;

    const outcome = await conversion.convert();

    expect(outcome.kind).toBe('refused');
    expect(outcome.kind === 'refused' && outcome.reason).toMatch(/^The track "Kit" uses drums alphaTex cannot name/);
    expect(save).not.toHaveBeenCalled();
    expect(deleteEntry).not.toHaveBeenCalled();
    expect(gp.isOriginal).toBeTrue();
    expect(composer.doc).toBe(before);
  });

  it('refuses when the composition cannot be saved, and deletes nothing', async () => {
    save.and.rejectWith(new Error('Quota exceeded'));
    openFile(guitar);
    askWithDoubleBar();

    const outcome = await conversion.convert();

    expect(outcome).toEqual({ kind: 'refused', reason: 'The composition could not be saved, so the file was not converted: Quota exceeded' });
    expect(deleteEntry).not.toHaveBeenCalled();
    expect(gp.isOriginal).toBeTrue();
  });

  it('converts and keeps the original when its delete fails, and says the original is still in the library', async () => {
    deleteEntry.and.rejectWith(new Error('blocked'));
    openFile(guitar);
    askWithDoubleBar();

    const outcome = await conversion.convert();

    expect(outcome).toEqual({ kind: 'converted', compositionId: 'composition-1', originalKept: true });
    expect(gp.isOriginal).toBeFalse();
    expect(composer.state.refusal).toBeNull();
    expect(composer.doc.masterBars[0].isDoubleBar).toBeTrue();
  });
});
