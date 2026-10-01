import { relativeTimeOf } from './relative-time';

/**
 * How long ago something happened, as the library's cards say it ("Edited 5 minutes ago") and the sheet's save status
 * will ("Saved · just now"). Fixed instants on both sides, so nothing here depends on when it runs.
 */
describe('relativeTimeOf', () => {
  const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it('says "just now" for anything under a minute ago', () => {
    expect(relativeTimeOf(NOW, NOW)).toBe('just now');
    expect(relativeTimeOf(NOW - 59 * SECOND, NOW)).toBe('just now');
  });

  it('says "just now" for a time ahead of the clock, rather than "in 3 minutes"', () => {
    // Another tab's clock, or this one corrected since the write: the thing has happened, so it happened just now.
    expect(relativeTimeOf(NOW + 3 * MINUTE, NOW)).toBe('just now');
  });

  it('counts minutes, then hours, then days, rounding down', () => {
    expect(relativeTimeOf(NOW - MINUTE, NOW)).toBe('1 minute ago');
    expect(relativeTimeOf(NOW - 59 * MINUTE - 59 * SECOND, NOW)).toBe('59 minutes ago');
    expect(relativeTimeOf(NOW - HOUR, NOW)).toBe('1 hour ago');
    expect(relativeTimeOf(NOW - 23 * HOUR, NOW)).toBe('23 hours ago');
    expect(relativeTimeOf(NOW - DAY, NOW)).toBe('1 day ago');
    expect(relativeTimeOf(NOW - 6 * DAY, NOW)).toBe('6 days ago');
  });

  it('counts weeks under a month, months under a year, and years after that', () => {
    expect(relativeTimeOf(NOW - 7 * DAY, NOW)).toBe('1 week ago');
    expect(relativeTimeOf(NOW - 29 * DAY, NOW)).toBe('4 weeks ago');
    expect(relativeTimeOf(NOW - 30 * DAY, NOW)).toBe('1 month ago');
    expect(relativeTimeOf(NOW - 364 * DAY, NOW)).toBe('12 months ago');
    expect(relativeTimeOf(NOW - 365 * DAY, NOW)).toBe('1 year ago');
    expect(relativeTimeOf(NOW - 3 * 365 * DAY, NOW)).toBe('3 years ago');
  });

  it('never says "yesterday": 30 hours ago at one in the morning was the day before that', () => {
    expect(relativeTimeOf(NOW - 30 * HOUR, NOW)).toBe('1 day ago');
  });
});
