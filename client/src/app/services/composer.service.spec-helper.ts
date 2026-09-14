import { ComposerService } from './composer.service';
import { writtenBeats } from './written-beats.spec-helper';
import { BeatDoc, ComposerState } from '../models/composer.model';

/** Helpers the `composer.service.*.spec.ts` files of M2's commands share. */

/** The service's current state. */
export function stateOf(service: ComposerService): ComposerState {
  let latest: ComposerState | undefined;
  service.getState().subscribe(value => (latest = value)).unsubscribe();
  if (!latest) throw new Error('no state');
  return latest;
}

/** Writes `fret` on tab string `string` at bar `barIndex`, beat `beatIndex`, leaving the caret there. */
export function writeFret(service: ComposerService, barIndex: number, beatIndex: number, fret: number, string = 1): void {
  service.setCursor({ barIndex, beatIndex, stringIndex: string - 1 });
  service.setNoteAtCursor({ kind: 'fretted', string, fret }, false);
}

/** The first track's beats in bar `barIndex`. */
export function beatsIn(service: ComposerService, barIndex = 0): BeatDoc[] {
  return service.doc.tracks[0].staves[0].bars[barIndex].voices[0].beats;
}

/** Replaces the document with one whose first bar is `written` (`writtenBeats`). */
export function withFirstBar(service: ComposerService, written: string): void {
  const doc = ComposerService.createEmptyScore();
  doc.tracks[0].staves[0].bars[0].voices[0].beats = writtenBeats(written);
  service.replaceDocument(doc);
}
