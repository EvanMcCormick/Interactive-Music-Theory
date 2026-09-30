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

/** Why the last track cannot be removed: said by the service, and on the track strip's Remove before it is pressed. */
export const LAST_TRACK_REFUSAL = 'A score needs at least one track.';

/** Why the last track shown cannot be hidden: said on the track strip's show / hide before it is pressed, and after. */
export const LAST_SHOWN_TRACK = 'At least one track is shown: show another before hiding this one.';

/** Why a hidden track's row does not take the caret: an edit there would write to a staff no one can see. */
export function hiddenTrackRefusalOf(name: string): string {
  return `Show ${name} to edit it.`;
}
