import { COMPOSER_TOOLS } from './composer-tools';
import { ASKING_PAGE_COMMANDS, NEVER_CHANGES, changesDocument } from './composer-edit-intent';

/**
 * The ask-first predicate, over every command the composer has.
 *
 * The tool table is the one place a command is declared, so a tool added later cannot arrive without an answer:
 * `changesDocument` says yes unless the tool is named as one that never writes, and this spec checks every name
 * against the table.
 */
describe('changesDocument', () => {
  const ids = COMPOSER_TOOLS.map(tool => tool.id);

  it('answers for every tool in the table', () => {
    for (const id of ids) expect(typeof changesDocument(id)).toBe('boolean');
  });

  it('names only real tools as never changing the document', () => {
    expect([...NEVER_CHANGES].filter(id => !ids.includes(id))).toEqual([]);
  });

  it('asks for every palette tool whose command writes', () => {
    for (const id of ['fret', 'clearBeat', 'insertBeat', 'deleteBeats', 'rest', 'tie', 'triplet', 'accent', 'hammerOn', 'fermata', 'doubleBar', 'fixBar', 'insertBar', 'deleteBar', 'appendBar', 'addTrack', 'deleteTrack', 'respell', 'sharp', 'mf', 'quarter', 'longer', 'shorter', 'dot']) {
      expect(changesDocument(id)).withContext(id).toBe(true);
    }
  });

  it('asks for paste, cut and save', () => {
    for (const id of ['paste', 'cut', 'save']) expect(changesDocument(id)).withContext(id).toBe(true);
  });

  it('does not ask for Select, Pen, the shortcut sheet or Escape', () => {
    for (const id of ['select', 'pen', 'toggleEntryMode', 'escape', 'shortcutSheet']) {
      expect(changesDocument(id)).withContext(id).toBe(false);
    }
  });

  it('does not ask for any navigation move, copy or select all', () => {
    const navigation = COMPOSER_TOOLS.filter(tool => tool.group === 'Navigation').map(tool => tool.id);
    expect(navigation.length).toBeGreaterThan(10);
    for (const id of [...navigation, 'copy', 'selectAll']) expect(changesDocument(id)).withContext(id).toBe(false);
  });

  it('does not ask for playback', () => {
    for (const id of ['playPause', 'playFromStart']) expect(changesDocument(id)).withContext(id).toBe(false);
  });

  it('does not ask for opening a popover: choosing a value in one does', () => {
    for (const id of ['timeSignature', 'keySignature', 'clef', 'section', 'alternateEnding', 'tuplet', 'tripletFeel']) {
      expect(changesDocument(id)).withContext(id).toBe(false);
    }
    expect(changesDocument(ASKING_PAGE_COMMANDS.popoverValue)).toBe(true);
  });

  it('does not ask for undo or redo, which have no history to work on in Original', () => {
    for (const id of ['undo', 'redo']) expect(changesDocument(id)).withContext(id).toBe(false);
  });

  it('asks for an applied alphaTex draft, which is not a tool', () => {
    expect(changesDocument(ASKING_PAGE_COMMANDS.texApply)).toBe(true);
  });

  it('asks for a command it has never heard of, so a new tool cannot slip through', () => {
    expect(changesDocument('someToolAddedLater')).toBe(true);
  });
});
