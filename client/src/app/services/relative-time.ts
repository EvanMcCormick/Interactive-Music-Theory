/** Built once: a formatter is not free to construct, and a library page formats one per card each minute. */
const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

/**
 * How long ago `at` was, seen from `now` (both epoch milliseconds), in the words a card or a status line says it:
 * "just now", "5 minutes ago", "3 days ago", "2 months ago".
 *
 * Shared rather than written into the library page, because the sheet's save status says the same thing ("Saved · just
 * now", design decision 9) and the two should never disagree about what "just now" means.
 *
 * - **Under a minute is "just now"**, and so is a time ahead of `now`: another tab's clock, or this one corrected since
 *   the write. The thing has happened; "in 3 minutes" would be nonsense.
 * - **Elapsed time, rounded down, never the calendar.** `numeric: 'always'` keeps `Intl` from saying "yesterday" or
 *   "last week", which are calendar claims: 30 hours before one in the morning was the day before yesterday. "1 day
 *   ago" is true either way.
 * - **Weeks under a month, months under a year.** A month is counted as 30 days and a year as 365: the card is a
 *   reminder of roughly when, and the exact moment is on its tooltip.
 * - **English**, as every other word on the page is; the browser's locale would put one translated phrase in an
 *   English sentence.
 */
export function relativeTimeOf(at: number, now: number): string {
  const seconds = Math.floor((now - at) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return RELATIVE.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return RELATIVE.format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 7) return RELATIVE.format(-days, 'day');
  if (days < 30) return RELATIVE.format(-Math.floor(days / 7), 'week');
  if (days < 365) return RELATIVE.format(-Math.floor(days / 30), 'month');
  return RELATIVE.format(-Math.floor(days / 365), 'year');
}
