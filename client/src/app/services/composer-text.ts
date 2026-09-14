/**
 * What the composer's commands say in words: counts, and the outcomes Fix bar and paste announce in the status line.
 *
 * Kept apart from the commands that use them, so the status line - which counts the bars over their time signature -
 * reads its words from here rather than importing the bar and track commands for one helper.
 */

/** `count` and `noun`, plural unless the count is one: "1 bar", "3 beats". */
export function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** What Fix bar says it did: how many bars it fixed, and how many it appended when the carry ran off the end. */
export function fixBarNoticeOf(fixed: number, appended: number): string {
  return `Fixed ${countOf(fixed, 'bar')}${appended > 0 ? `, adding ${countOf(appended, 'bar')} at the end` : ''}.`;
}

/** What a paste says it did: how many beats it wrote, and how many bars it appended when it ran off the end. */
export function pasteNoticeOf(beats: number, appended: number): string {
  return `Pasted ${countOf(beats, 'beat')}${appended > 0 ? `, adding ${countOf(appended, 'bar')} at the end` : ''}.`;
}
