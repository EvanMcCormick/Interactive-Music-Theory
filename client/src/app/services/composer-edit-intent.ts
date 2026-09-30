/**
 * Whether a command would change the document - the question the Original state asks before the first edit
 * converts a `.gp` file (design decision 4).
 *
 * Named for what it returns, per `CLAUDE.md`'s rule for pure derivations. Pure, and it imports nothing: the tool
 * table's own spec is what ties the names below to `COMPOSER_TOOLS`, so this module stays a list and a lookup.
 *
 * **The default is yes.** A tool added later is not in the list, so it asks - which costs one prompt the user can
 * cancel, where the other default would silently convert a file. The spec checks that every name here is a real
 * tool id, so the list cannot rot in the other direction.
 */

/**
 * The page's own commands, which are not in `COMPOSER_TOOLS` because they are not palette tools or key bindings:
 * applying the alphaTex draft, and choosing a value in a popover, whose button only opens it.
 */
export const ASKING_PAGE_COMMANDS = {
  texApply: 'page:texApply',
  popoverValue: 'page:popoverValue'
} as const;

/**
 * Every tool that never writes to the document. Grouped as design Part 4's table groups them.
 *
 * Undo and Redo are here, and they are the one pair that would change a document: in Original there is no history
 * to undo, both buttons are disabled, and a Ctrl+Z that opened the conversion prompt would be asking about an edit
 * that does not exist.
 */
export const NEVER_CHANGES: ReadonlySet<string> = new Set([
  // Select and Pen, and the page's own modes.
  'select',
  'pen',
  'toggleEntryMode',
  'escape',
  'shortcutSheet',
  // Reading the document, not writing it.
  'copy',
  'selectAll',
  'undo',
  'redo',
  // Every navigation move, and its Shift form.
  'previousBeat',
  'nextBeat',
  'previousString',
  'nextString',
  'extendLeft',
  'extendRight',
  'extendUp',
  'extendDown',
  'barStart',
  'barEnd',
  'previousBar',
  'nextBar',
  'firstBar',
  'lastBar',
  'previousTrack',
  'nextTrack',
  // Playback.
  'playPause',
  'playFromStart',
  // A popover's button only opens it. Choosing a value is `ASKING_PAGE_COMMANDS.popoverValue`.
  'timeSignature',
  'keySignature',
  'clef',
  'section',
  'alternateEnding',
  'tuplet',
  'tripletFeel'
]);

/** Whether the command `id` would change the document, and so must ask before it runs on a file in Original. */
export function changesDocument(id: string): boolean {
  return !NEVER_CHANGES.has(id);
}
