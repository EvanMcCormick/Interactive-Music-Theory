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
   * Standard MIDI bytes, generated from the score with no engraver involved.
   *
   * `AlphaTabApi.downloadMidi()` would do the same job, but only from the score
   * an api is *rendering* - which made MIDI the one export of three with a
   * precondition, and on `/progression` that precondition would read "the
   * notation panel must be open". `MidiFileGenerator` is the same machinery the
   * api calls, minus the api: it takes a `Score` and writes events through a
   * handler, and neither step asks for a layout.
   *
   * SMF type 1 rather than alphaTab's type 0 default, so each score track
   * arrives in other software as its own track instead of as channels merged
   * into one. `smf1Mode` matches what alphaTab passes on its own export path;
   * it drops the vendor rest events that only alphaSynth reads, at the
   * documented cost of multiple bends sharing a beat.
   */
  toMidi(score: alphaTab.model.Score, settings: alphaTab.Settings): Uint8Array {
    const file = new alphaTab.midi.MidiFile();
    file.format = alphaTab.midi.MidiFileFormat.MultiTrack;

    const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(file, true);
    new alphaTab.midi.MidiFileGenerator(score, settings, handler).generate();
    return file.toBinary();
  }

  /** Triggers a browser download of the score as a .mid file. */
  downloadMidiFile(
    score: alphaTab.model.Score,
    settings: alphaTab.Settings,
    fileName: string
  ): void {
    const bytes = this.toMidi(score, settings);
    // Copy into a plain ArrayBuffer for the same reason toGuitarPro does: the
    // returned view may sit in a larger buffer that Blob would otherwise keep.
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);

    this.downloadBlob(
      new Blob([buffer], { type: 'audio/midi' }),
      this.withExtension(fileName, 'mid')
    );
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
