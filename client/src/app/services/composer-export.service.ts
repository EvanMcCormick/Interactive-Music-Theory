import { Injectable } from '@angular/core';
import * as alphaTab from '@coderline/alphatab';

/**
 * Exports a composed score to files the rest of the world understands.
 *
 * All three formats come from alphaTab itself, so nothing here has to
 * understand a file format.
 */
@Injectable({ providedIn: 'root' })
export class ComposerExportService {
  /** Guitar Pro 7 bytes, openable in Guitar Pro and by the app's GP viewer. */
  toGuitarPro(score: alphaTab.model.Score, settings: alphaTab.Settings): Uint8Array {
    return new alphaTab.exporter.Gp7Exporter().export(score, settings);
  }

  /** Triggers a browser download of the score as a .gp file. */
  downloadGuitarPro(
    score: alphaTab.model.Score,
    settings: alphaTab.Settings,
    fileName: string
  ): void {
    const bytes = this.toGuitarPro(score, settings);
    // Copy into a plain ArrayBuffer: the exporter's view may sit in a larger
    // buffer, and Blob would otherwise capture the whole thing.
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);

    this.downloadBlob(
      new Blob([buffer], { type: 'application/gp' }),
      this.withExtension(fileName, 'gp')
    );
  }

  /** Triggers a browser download of the raw alphaTex source. */
  downloadAlphaTex(tex: string, fileName: string): void {
    this.downloadBlob(
      new Blob([tex], { type: 'text/plain;charset=utf-8' }),
      this.withExtension(fileName, 'alphatex')
    );
  }

  /**
   * Downloads a standard MIDI file. alphaTab generates this from the score it
   * currently has loaded, so the API must already be rendering the score.
   */
  downloadMidi(api: alphaTab.AlphaTabApi | null): boolean {
    if (!api) return false;
    api.downloadMidi();
    return true;
  }

  /** Turns a score title into a safe file name. */
  toFileName(title: string): string {
    const illegal = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
    const cleaned = Array.from(title.trim())
      // Drop characters Windows or POSIX reject, plus control characters.
      .filter(ch => !illegal.has(ch) && ch.charCodeAt(0) >= 32)
      .join('')
      .replace(/\s+/g, ' ')
      .slice(0, 80)
      .trim();
    return cleaned.length > 0 ? cleaned : 'Untitled';
  }

  private withExtension(fileName: string, extension: string): string {
    return fileName.toLowerCase().endsWith(`.${extension}`)
      ? fileName
      : `${fileName}.${extension}`;
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Revoke on the next tick so the download has started.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
