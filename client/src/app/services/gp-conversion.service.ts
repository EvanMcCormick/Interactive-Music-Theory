import { ErrorHandler, Injectable, inject } from '@angular/core';
import * as alphaTab from '@coderline/alphatab';

import { ScoreDoc, TexDiagnostic } from '../models/composer.model';
import { AlphaTexService } from './alpha-tex.service';
import { ComposerGpService } from './composer-gp.service';
import { ComposerLibraryService } from './composer-library.service';
import { ComposerService } from './composer.service';
import { GpLibraryService } from './gp-library.service';
import { frettedDocOf } from './pitch-on-strings';
import { ScoreDocMapperService } from './score-doc-mapper.service';

/** What Convert did: made the composition - keeping the original's entry only when its delete failed - or refused. */
export type ConversionOutcome =
  | { kind: 'converted'; compositionId: string; originalKept: boolean }
  | { kind: 'refused'; reason: string };

/** alphaTab's diagnostic for a drum note whose name it does not know: what a kit alphaTex cannot name reads back as. */
const UNKNOWN_ARTICULATION = 209;

/**
 * Converts the `.gp` file on show into a composition: the prompt's Convert (the GP-composer design, Part 4).
 *
 * In order, and the order is the error handling:
 * 1. The document: `toDoc`, then `frettedDocOf`, both pure. Fretted here rather than inside `replaceDocument`, so the
 *    document is final before anything is written. A model the mapper cannot read refuses the conversion, as step 2 does.
 * 2. The composition is written, from the alphaTex every save writes - but that alphaTex is parsed back first, and a
 *    parse with no score refuses the conversion as a failed write does. A drum kit the file invents is the one thing known
 *    to fail it (design Part 3). **A failure here refuses the conversion**: the page stays in Original, the edit that asked
 *    is not applied, the `.gp` is untouched, and the reason names the track when the diagnostic does.
 * 3. The `.gp` entry is deleted: **the one irreversible step.** A failure leaves both rows, and says the original is still
 *    in the library - better than the reverse order, where a failed write after a delete would lose the file.
 * 4. The document replaces the page's as a new composition, clean. It is the one parsed back at step 2, not the one
 *    written: what the first save loses (a double bar, a voice of rests) is already gone from it, so the page shows what
 *    the library holds and "clean" is true by construction - reopening the entry gives this document. `replaceDocument`
 *    frets it again and, on a fretted document, drops nothing, so its `markClean` survives. `documentId` moves on, so the
 *    history starts empty (design decision 6), the library panel adopts the new entry (`markOpened`), and
 *    `ComposerGpService` leaves Original by itself, dropping the bytes - step 5.
 * 5. The edit that asked runs, as its own commit, so undo takes back the edit and stops at the converted score. The file
 *    is converted whatever the edit does, so the status line says so after it - after, since the edit's commit clears the
 *    status line: beside the edit's refusal; in place of an edit that threw, which is reported rather than thrown on, as
 *    the caller's prompt has nothing left to refuse; and with the original still in the library when its delete failed.
 */
@Injectable({ providedIn: 'root' })
export class GpConversionService {
  /** Where an edit that throws after the conversion is reported (step 5). */
  private readonly errors = inject(ErrorHandler);

  constructor(
    private readonly gp: ComposerGpService,
    private readonly composer: ComposerService,
    private readonly mapper: ScoreDocMapperService,
    private readonly tex: AlphaTexService,
    private readonly library: ComposerLibraryService,
    private readonly gpLibrary: GpLibraryService
  ) {}

  async convert(): Promise<ConversionOutcome> {
    const original = this.gp.original;
    if (!original) return { kind: 'refused', reason: 'There is no file to convert.' };
    // Taken now: leaving Original at step 4 drops it.
    const request = this.gp.request;

    // 1. The document. A file with no title takes its file name's, so the composition is not saved untitled - before the
    // export, so the document read back at step 2 keeps it.
    let written: ScoreDoc;
    try {
      written = frettedDocOf(this.mapper.toDoc(original.score)).doc;
    } catch (error) {
      return { kind: 'refused', reason: `The file could not be read as a composition, so it was not converted: ${messageOf(error)}` };
    }
    if (!written.title.trim()) written.title = original.fileName.replace(/\.[^.]+$/, '');

    // 2. The composition, proved to reopen before it is written - and the document reopening it gives, for step 4.
    let tex: string;
    try {
      tex = this.tex.export(this.mapper.toScore(written, new alphaTab.Settings()));
    } catch (error) {
      return { kind: 'refused', reason: `The file could not be written as a composition, so it was not converted: ${messageOf(error)}` };
    }
    const reread = this.tex.parse(tex);
    if (!reread.score) return { kind: 'refused', reason: unsavableReasonOf(tex, reread.diagnostics) };
    let doc: ScoreDoc;
    try {
      doc = frettedDocOf(this.mapper.toDoc(reread.score)).doc;
    } catch (error) {
      return { kind: 'refused', reason: `The composition would not open again once saved, so the file was not converted: ${messageOf(error)}` };
    }

    let compositionId: string;
    try {
      compositionId = await this.library.save({
        title: doc.title,
        artist: doc.artist,
        tex,
        tempo: doc.tempo,
        trackCount: doc.tracks.length,
        barCount: doc.masterBars.length
      });
    } catch (error) {
      return { kind: 'refused', reason: `The composition could not be saved, so the file was not converted: ${messageOf(error)}` };
    }

    // 3. The one step that cannot be taken back.
    let originalKept = false;
    try {
      await this.gpLibrary.deleteEntry(original.entryId);
    } catch {
      originalKept = true;
    }

    // 4. The composition, as a new one, clean; the library panel names its entry.
    this.composer.replaceDocument(doc, { newComposition: true, markClean: true });
    this.library.markOpened(compositionId);

    // 5. The edit that asked, on its own undo step; then what the conversion did, beside what the edit said.
    const converted = originalKept
      ? `"${doc.title}" was converted, and the original file is still in the library.`
      : `"${doc.title}" was converted.`;
    try {
      request?.run();
    } catch (error) {
      this.errors.handleError(error);
      this.composer.announce(`${converted} The edit could not be applied.`, true);
      return { kind: 'converted', compositionId, originalKept };
    }
    const { refusal, notice } = this.composer.state;
    if (refusal !== null) this.composer.announce(`${converted} ${refusal}`, true);
    else if (originalKept) this.composer.announce(notice === null ? converted : `${converted} ${notice}`);
    return { kind: 'converted', compositionId, originalKept };
  }
}

/** Why a composition whose alphaTex would not parse back is refused, naming the track the first error is in when it can. */
function unsavableReasonOf(tex: string, diagnostics: readonly TexDiagnostic[]): string {
  const error = diagnostics.find(diagnostic => diagnostic.severity === 'error') ?? diagnostics[0];
  const track = error ? trackAtLine(tex, error.line) : null;
  const where = track ? `The track "${track}"` : 'A track';
  if (error?.code === UNKNOWN_ARTICULATION) {
    return `${where} uses drums alphaTex cannot name, so the file was not converted: a composition saved with them would not open again.`;
  }
  return `${where} would not open again once saved, so the file was not converted${error ? `: ${error.message}` : '.'}`;
}

/** The name of the `\track` the 1-based `line` of `tex` is in, or null. */
function trackAtLine(tex: string, line: number): string | null {
  const lines = tex.split('\n').slice(0, line);
  for (let index = lines.length - 1; index >= 0; index--) {
    const named = /^\s*\\track\s*\(?\s*"([^"]*)"/.exec(lines[index]);
    if (named) return named[1];
  }
  return null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
