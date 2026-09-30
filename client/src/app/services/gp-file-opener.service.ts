import { Injectable } from '@angular/core';
import * as alphaTab from '@coderline/alphatab';

import { GpLibraryEntry } from '../models/alpha-tab.model';
import { ComposerGpService } from './composer-gp.service';
import { ComposerService } from './composer.service';
import { GpFileMetadata, GpLibraryService } from './gp-library.service';

/**
 * The extensions of a file alphaTab can read as Guitar Pro: one list, so the name test and the Import .gp… picker's
 * `accept` cannot come to disagree about what a Guitar Pro file is.
 */
export const GP_FILE_EXTENSIONS: readonly string[] = ['gp', 'gp3', 'gp4', 'gp5', 'gpx'];

/** `GP_FILE_EXTENSIONS` as a file input's `accept`: `.gp,.gp3,…`. */
export const GP_FILE_ACCEPT = GP_FILE_EXTENSIONS.map(extension => `.${extension}`).join(',');

const GP_FILE = new RegExp(`\\.(${GP_FILE_EXTENSIONS.join('|')})$`, 'i');

/** Whether `fileName` names a Guitar Pro file, by its extension. */
export function isGpFileName(fileName: string): boolean {
  return GP_FILE.test(fileName);
}

/** What a parsed file says about itself, for its library entry: its title, artist, album, tempo and track count. */
export function gpMetadataOf(score: alphaTab.model.Score): GpFileMetadata {
  return {
    title: score.title || undefined,
    artist: score.artist || undefined,
    album: score.album || undefined,
    tempo: score.tempo,
    trackCount: score.tracks.length
  };
}

/**
 * Every way a `.gp` file comes into the composer, and each opens it in the Original state (the GP-composer design,
 * Part 1's table): `?gp=<id>` from the gallery, a row of the Library drawer, Import .gp…, and a file dropped on the page.
 *
 * Each route parses the bytes before anything is written, and writes or corrects the file's `gp-library` entry before the
 * page enters Original (design decision 17): so Convert always has exactly one entry to replace, a file alphaTab cannot
 * read leaves nothing half-imported behind, and an entry the gallery added with invented metadata - "120 BPM", "0
 * tracks" - is corrected the first time it is opened, once the file is showing: the correction feeds the gallery's
 * cards, not the page. Unsaved work is asked about first, as every path that opens another composition asks
 * (`confirmDiscard`). What went wrong is said in the status line.
 *
 * One open runs at a time (`opening`): a double click on a row, or two files dropped in quick succession, would
 * otherwise ask twice, write twice, and show whichever finished last.
 */
@Injectable({ providedIn: 'root' })
export class GpFileOpener {
  /** Whether an open is under way. Another asked meanwhile is not run, and says nothing: the first is answering it. */
  private opening = false;

  constructor(
    private readonly gp: ComposerGpService,
    private readonly gpLibrary: GpLibraryService,
    private readonly composer: ComposerService
  ) {}

  /**
   * Opens the library's entry `id`. False when it did not - the entry gone, the library or the file unreadable, the user
   * kept their work, or another open was under way.
   */
  openEntry(id: string): Promise<boolean> {
    return this.oneAtATime(() => this.openEntryNow(id));
  }

  /** Imports `file` into the library and opens it. False when it did not, having said why - or another open was under way. */
  importFile(file: File): Promise<boolean> {
    return this.oneAtATime(() => this.importFileNow(file));
  }

  private async openEntryNow(id: string): Promise<boolean> {
    let entry: GpLibraryEntry | null;
    try {
      entry = await this.gpLibrary.getEntry(id);
    } catch (error) {
      // Not "no longer in the library": the entry may well be there, and the user would go looking for a file they have.
      return this.refuse(`The library could not be read: ${reasonOf(error)}`);
    }
    if (!entry) return this.refuse('That file is no longer in the library.');
    const score = scoreOf(entry.fileData);
    if (!score) return this.refuse(unreadable(entry.fileName));
    if (!this.composer.confirmDiscard('open this file')) return false;

    this.show(entry.id, entry.fileName, entry.fileData, score);
    // After the file is showing: the write, and the reload of every entry after it, feed the gallery's cards, not the page.
    void this.correctEntry(entry, score);
    return true;
  }

  private async importFileNow(file: File): Promise<boolean> {
    if (!isGpFileName(file.name)) return this.refuse(`"${file.name}" is not a Guitar Pro file.`);
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch (error) {
      // A file moved, deleted or locked since it was picked or dropped.
      return this.refuse(`"${file.name}" could not be read: ${reasonOf(error)}`);
    }
    const score = scoreOf(bytes);
    if (!score) return this.refuse(unreadable(file.name));
    if (!this.composer.confirmDiscard('open this file')) return false;

    let entry: GpLibraryEntry;
    try {
      entry = await this.gpLibrary.addBytes(bytes, file.name, gpMetadataOf(score));
    } catch (error) {
      return this.refuse(`"${file.name}" could not be added to the library: ${reasonOf(error)}`);
    }
    this.show(entry.id, file.name, bytes, score);
    return true;
  }

  /**
   * Opens the first Guitar Pro file of `files`, dropped on the page, and says what it left: the other Guitar Pro files,
   * since one file is open at a time, and apart from them the files that are not Guitar Pro files at all - which no
   * second drop would open either. The gallery, which lists rather than opens, takes all of the Guitar Pro files.
   */
  async importDropped(files: readonly File[]): Promise<void> {
    const gpFiles = files.filter(file => isGpFileName(file.name));
    if (gpFiles.length === 0) {
      this.refuse(files.length === 1 ? `"${files[0].name}" is not a Guitar Pro file.` : 'None of those files is a Guitar Pro file.');
      return;
    }
    if (!(await this.importFile(gpFiles[0]))) return;
    const left = gpFiles.length - 1;
    const notGp = files.length - gpFiles.length;
    const said = [`Opened "${gpFiles[0].name}".`];
    if (left > 0) said.push(`${left} other Guitar Pro file${left === 1 ? ' was' : 's were'} left: one file opens at a time.`);
    if (notGp > 0) said.push(notGp === 1 ? '1 file was not a Guitar Pro file.' : `${notGp} files were not Guitar Pro files.`);
    if (said.length > 1) this.composer.announce(said.join(' '));
  }

  /** Runs `open` unless another is under way, which answers for both. */
  private async oneAtATime(open: () => Promise<boolean>): Promise<boolean> {
    if (this.opening) return false;
    this.opening = true;
    try {
      return await open();
    } finally {
      this.opening = false;
    }
  }

  /**
   * Shows the file over a fresh page: the composition that was open is not what the page is about now, so the library
   * panel forgets its entry and a Save cannot write the file's conversion over it.
   */
  private show(entryId: string, fileName: string, bytes: ArrayBuffer, score: alphaTab.model.Score): void {
    this.composer.reset();
    this.gp.open({ entryId, fileName, bytes, score });
  }

  /** Writes what the parsed file says about itself over what its entry says, where they differ. */
  private async correctEntry(entry: GpLibraryEntry, score: alphaTab.model.Score): Promise<void> {
    const read = gpMetadataOf(score);
    const updates: Partial<GpLibraryEntry> = {};
    if (read.title && read.title !== entry.title) updates.title = read.title;
    if ((read.artist ?? '') !== (entry.artist ?? '')) updates.artist = read.artist ?? '';
    if ((read.album ?? '') !== (entry.album ?? '')) updates.album = read.album ?? '';
    if (read.tempo !== entry.tempo) updates.tempo = read.tempo;
    if (read.trackCount !== entry.trackCount) updates.trackCount = read.trackCount;
    if (Object.keys(updates).length === 0) return;
    // A correction that fails costs a stale card in the gallery, not the file: opening goes on.
    await this.gpLibrary.updateEntry(entry.id, updates).catch(() => undefined);
  }

  private refuse(message: string): false {
    this.composer.announce(message, true);
    return false;
  }
}

/** `bytes` read as a Guitar Pro file, or null when alphaTab cannot. */
function scoreOf(bytes: ArrayBuffer): alphaTab.model.Score | null {
  try {
    return alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(bytes), new alphaTab.Settings());
  } catch {
    return null;
  }
}

/** What `error` says went wrong, for the status line. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unreadable(fileName: string): string {
  return `"${fileName}" could not be read as a Guitar Pro file.`;
}
