import { BeatDoc, DurationValue, Tuplet, createDefaultNoteEffects, createRestBeat } from '../models/composer.model';

/** The tuplets a written beat names by its numerator. */
const TUPLETS: Readonly<Record<string, Tuplet>> = {
  '3': { numerator: 3, denominator: 2 },
  '5': { numerator: 5, denominator: 4 },
  '6': { numerator: 6, denominator: 4 },
  '7': { numerator: 7, denominator: 4 }
};

/**
 * Beats from a spec's shorthand, one space-separated token each: `n` for a note on string 1 or `r` for a rest, then
 * its value, any dots, and `t3`, `t5`, `t6` or `t7` for a 3:2, 5:4, 6:4 or 7:4 tuplet - `n8.`, `r4t3`. `g` is a
 * note before the beat and `o` one on it, an eighth unless a value follows - `g8t3` is a grace carrying a triplet,
 * which only a loaded file can have. For specs, so a voice reads the way a bar is written.
 */
export function writtenBeats(written: string): BeatDoc[] {
  return written.split(' ').filter(Boolean).map(token => {
    const match = /^([nrgo])(\d+)?(\.*)(?:t(\d))?$/.exec(token);
    const tuplet = match?.[4] === undefined ? null : TUPLETS[match[4]];
    if (!match || tuplet === undefined) throw new Error(`Not a written beat: ${token}`);
    const [, kind, value, dots] = match;
    const beat: BeatDoc = { ...createRestBeat(Number(value ?? 8) as DurationValue), dots: dots.length, tuplet: tuplet ? { ...tuplet } : null };
    if (kind !== 'r') {
      beat.isRest = false;
      beat.notes = [{ pitch: { kind: 'fretted', string: 1, fret: 0 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
    }
    if (kind === 'g') beat.effects.grace = 'beforeBeat';
    if (kind === 'o') beat.effects.grace = 'onBeat';
    return beat;
  });
}

/** `beats` written back in `writtenBeats`' shorthand, a grace as `g` or `o` with its value only when it carries a tuplet. */
export function writtenOf(beats: readonly BeatDoc[]): string {
  return beats
    .map(beat => {
      const tuplet = beat.tuplet ? `t${beat.tuplet.numerator}` : '';
      if (beat.effects.grace !== 'none') return `${beat.effects.grace === 'onBeat' ? 'o' : 'g'}${tuplet ? `${beat.duration}${tuplet}` : ''}`;
      return `${beat.isRest ? 'r' : 'n'}${beat.duration}${'.'.repeat(beat.dots)}${tuplet}`;
    })
    .join(' ');
}
