/**
 * The transport's seek readout: a time in milliseconds as minutes and seconds, `1:05`, rounded down to the second as a
 * player's clock is. Past the hour the minutes keep counting, `61:05`, with no hours field: a score runs minutes, and a
 * readout that changes shape at the hour would jog the transport's width for a case that does not come up. A time that
 * is not a finite number - alphaTab's before a score has played - reads `0:00` rather than `NaN:NaN`. Named for what it
 * returns, per `CLAUDE.md`.
 */
export function clockTimeOf(ms: number): string {
  const totalSeconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * The speed the transport offers, as percentages of the score's own tempo: the viewer's range, 25 to 200, but in steps
 * of 5 where the viewer's slider moved by 1.
 */
export const SPEED_RANGE = { min: 25, max: 200, step: 5 } as const;
