/**
 * The transport's seek readout: a time in milliseconds as minutes and seconds, `1:05`, rounded down to the second as a
 * player's clock is. Named for what it returns, per `CLAUDE.md`.
 */
export function clockTimeOf(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** The speed the transport offers, as percentages of the score's own tempo: the viewer's range, 25 to 200. */
export const SPEED_RANGE = { min: 25, max: 200, step: 5 } as const;
