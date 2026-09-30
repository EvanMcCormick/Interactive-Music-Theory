import { ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTexService } from './alpha-tex.service';
import { ComposerGpService } from './composer-gp.service';
import { ComposerLibraryService } from './composer-library.service';
import { ComposerService } from './composer.service';
import { GpConversionService } from './gp-conversion.service';
import { GpLibraryService } from './gp-library.service';
import { frettedDocOf } from './pitch-on-strings';
import { ScoreDocMapperService } from './score-doc-mapper.service';

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
  let mapper: ScoreDocMapperService;
  let save: jasmine.Spy;
  let deleteEntry: jasmine.Spy;
  let markOpened: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    conversion = TestBed.inject(GpConversionService);
    gp = TestBed.inject(ComposerGpService);
    composer = TestBed.inject(ComposerService);
    tex = TestBed.inject(AlphaTexService);
    mapper = TestBed.inject(ScoreDocMapperService);
    const library = TestBed.inject(ComposerLibraryService);
    save = spyOn(library, 'save').and.resolveTo('composition-1');
    markOpened = spyOn(library, 'markOpened');
    deleteEntry = spyOn(TestBed.inject(GpLibraryService), 'deleteEntry').and.resolveTo();
  });

  /** Opens `source`, parsed as alphaTex and then changed by `change`, as the file `Band.gp` in entry `entry-1`. */
  function openFile(source: string, change: (score: alphaTab.model.Score) => void = () => undefined): void {
    const { score } = tex.parse(source);
    if (!score) throw new Error('the file did not parse');
    change(score);
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

  /** Holds an edit that changes nothing, so the page is left showing the converted document as it was written. */
  function askWithNothing(): void {
    gp.requestEdit('doubleBar', 'Double bar', () => undefined);
  }

  it('saves the alphaTex it proved reopens, and shows the page what reopening it gives, clean', async () => {
    openFile(guitar);
    askWithNothing();

    await conversion.convert();

    const written = (save.calls.mostRecent().args[0] as { tex: string }).tex;
    const reread = tex.parse(written).score;
    expect(reread).not.toBeNull();
    if (!reread) return;
    expect(composer.doc).toEqual(frettedDocOf(mapper.toDoc(reread)).doc);
    expect(composer.state.isDirty).toBeFalse();
  });

  it('shows the page what the library holds where the first save loses something: a double bar is gone, and the page is clean', async () => {
    openFile(guitar, score => (score.masterBars[0].isDoubleBar = true));
    askWithNothing();

    await conversion.convert();

    expect(composer.doc.masterBars[0].isDoubleBar).toBeFalse();
    expect(composer.state.isDirty).toBeFalse();
  });

  it('refuses a file it cannot read as a document, and writes and deletes nothing', async () => {
    openFile(guitar);
    askWithDoubleBar();
    spyOn(mapper, 'toDoc').and.throwError('unreadable');

    const outcome = await conversion.convert();

    expect(outcome).toEqual({ kind: 'refused', reason: 'The file could not be read as a composition, so it was not converted: unreadable' });
    expect(save).not.toHaveBeenCalled();
    expect(deleteEntry).not.toHaveBeenCalled();
    expect(gp.isOriginal).toBeTrue();
  });

  it('converts when the edit that asked throws, reports the throw, and says the edit could not be applied', async () => {
    const handleError = spyOn(TestBed.inject(ErrorHandler), 'handleError');
    const thrown = new Error('boom');
    openFile(guitar);
    gp.requestEdit('doubleBar', 'Double bar', () => {
      throw thrown;
    });

    const outcome = await conversion.convert();

    expect(outcome).toEqual({ kind: 'converted', compositionId: 'composition-1', originalKept: false });
    expect(handleError).toHaveBeenCalledWith(thrown);
    expect(gp.isOriginal).toBeFalse();
    expect(composer.state.isDirty).toBeFalse();
    expect(composer.state.refusal).toBe('"Riff" was converted. The edit could not be applied.');
  });

  it('converts when the edit that asked is refused, clean, and says both', async () => {
    // A hammer-on where the caret has no note: the caret starts on a string the file's one note is not on.
    openFile(['\\title "Riff"', '\\track "Guitar"', '3.3.1 |'].join('\n'));
    gp.requestEdit('hammerOn', 'Hammer-on / pull-off', () => composer.toggleNoteEffect('isHammerPullOrigin', true, false));

    const outcome = await conversion.convert();

    expect(outcome.kind).toBe('converted');
    expect(gp.isOriginal).toBeFalse();
    expect(composer.state.isDirty).toBeFalse();
    expect(composer.state.refusal).toBe('"Riff" was converted. There is no note there to change.');
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
    expect(composer.state.notice).toBe('"Riff" was converted, and the original file is still in the library.');
    expect(composer.doc.masterBars[0].isDoubleBar).toBeTrue();
  });
});
