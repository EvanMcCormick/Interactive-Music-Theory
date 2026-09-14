import { TestBed } from '@angular/core/testing';

import { ComposerService } from './composer.service';
import { BROWSER_RESERVED, KeyPress, bindingMatches, bindingSignatureOf } from './composer-key-bindings';
import { TOOLS_WITH_STATE } from './composer-tool-states';
import { COMPOSER_TOOLS, ComposerTool, ComposerToolHost, KEYLESS_TOOLS, PALETTE_GROUPS, toolForPress } from './composer-tools';

const press = (init: Partial<KeyPress>): KeyPress => ({
  key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init
});
const tool = (id: string): ComposerTool => {
  const found = COMPOSER_TOOLS.find(entry => entry.id === id);
  if (!found) throw new Error(`no tool ${id}`);
  return found;
};

/**
 * The design's tool-table spec: every tool has a command, a glyph or text, a label and a group, and a
 * shortcut no other tool uses - macOS alternates included - that the browser does not keep.
 */
describe('COMPOSER_TOOLS', () => {
  it('names every tool once', () => {
    const ids = COMPOSER_TOOLS.map(entry => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every tool a label, a group, a glyph or text, and a command', () => {
    for (const entry of COMPOSER_TOOLS) {
      expect(entry.label.trim()).withContext(entry.id).not.toBe('');
      expect(entry.group).withContext(entry.id).toBeTruthy();
      const glyph = entry.glyph;
      expect(glyph.kind === 'smufl' ? glyph.codePoint >= 0xe000 && glyph.codePoint <= 0xf8ff : glyph.text.trim() !== '')
        .withContext(entry.id).toBeTrue();
      expect(typeof entry.run).withContext(entry.id).toBe('function');
    }
  });

  it('uses no binding twice, macOS alternates included', () => {
    const seen = new Map<string, string>();
    for (const entry of COMPOSER_TOOLS) {
      for (const binding of entry.keys) {
        const signature = bindingSignatureOf(binding);
        expect(seen.get(signature)).withContext(`${entry.id} and ${seen.get(signature)} both use ${signature}`).toBeUndefined();
        seen.set(signature, entry.id);
      }
    }
  });

  it('binds nothing the browser keeps', () => {
    const reserved = new Set(BROWSER_RESERVED.map(bindingSignatureOf));
    for (const entry of COMPOSER_TOOLS) {
      for (const binding of entry.keys) {
        expect(reserved.has(bindingSignatureOf(binding))).withContext(`${entry.id}: ${bindingSignatureOf(binding)}`).toBeFalse();
      }
    }
  });

  it('writes Ctrl and Alt combinations by physical key, and nothing else that way', () => {
    const named = /^(Arrow|Home|End|Insert|Delete|Backspace|Enter|Escape|F[0-9]| $)/;
    for (const entry of COMPOSER_TOOLS) {
      for (const binding of entry.keys) {
        const held = !!binding.ctrl || !!binding.alt;
        if (binding.code !== undefined) expect(held).withContext(entry.id).toBeTrue();
        else if (held) expect(named.test(binding.key ?? '')).withContext(`${entry.id}: ${binding.key}`).toBeTrue();
      }
    }
  });

  it('gives every tool a key except those the design gives none', () => {
    const keyless = COMPOSER_TOOLS.filter(entry => entry.keys.length === 0).map(entry => entry.id);

    expect(keyless.sort()).toEqual([...KEYLESS_TOOLS].sort());
  });

  it('gives every palette button a state, Select and Pen included, and puts it in a palette group', () => {
    for (const entry of COMPOSER_TOOLS.filter(candidate => candidate.inPalette)) {
      expect(PALETTE_GROUPS).withContext(entry.id).toContain(entry.group);
      expect(TOOLS_WITH_STATE).withContext(entry.id).toContain(entry.id);
    }
  });

  it('says what kind of button each tool is, so only toggles and radios are drawn pressed', () => {
    const kindOf = (id: string): string | undefined => tool(id).kind;
    for (const entry of COMPOSER_TOOLS) {
      expect(['toggle', 'radio', 'popover', 'action']).withContext(entry.id).toContain(entry.kind ?? 'none');
    }
    expect(['select', 'pen', 'whole', 'quarter', 'sixtyFourth'].map(kindOf)).toEqual(['radio', 'radio', 'radio', 'radio', 'radio']);
    expect(['timeSignature', 'keySignature', 'clef', 'section', 'alternateEnding', 'tuplet', 'tripletFeel'].map(kindOf))
      .toEqual(Array(7).fill('popover'));
    expect(['fixBar', 'insertBar', 'deleteBar', 'natural', 'respell', 'rest', 'undo', 'fret'].map(kindOf)).toEqual(Array(8).fill('action'));
    expect(['vibrato', 'fermata', 'sharp', 'repeatOpen', 'dot', 'triplet', 'tie', 'mf'].map(kindOf)).toEqual(Array(8).fill('toggle'));
  });

  it('gives no two palette buttons the same face', () => {
    const faces = COMPOSER_TOOLS.filter(entry => entry.inPalette).map(entry =>
      entry.glyph.kind === 'smufl' ? `smufl:${entry.glyph.codePoint.toString(16)}` : `text:${entry.glyph.text}`
    );

    expect(faces.filter((face, index) => faces.indexOf(face) !== index)).toEqual([]);
  });

  it('lets a held key repeat only a move, undo and redo, and a step of duration', () => {
    const navigation = COMPOSER_TOOLS.filter(entry => entry.group === 'Navigation').map(entry => entry.id);
    const repeatable = COMPOSER_TOOLS.filter(entry => entry.repeatable).map(entry => entry.id);

    expect(repeatable.sort()).toEqual(
      [...navigation, 'undo', 'redo', 'semitoneUp', 'semitoneDown', 'stringAbove', 'stringBelow', 'longer', 'shorter'].sort()
    );
  });

  it('offers the macOS alternates', () => {
    const labels = (id: string): number => tool(id).keys.length;

    for (const id of ['insertBeat', 'section', 'insertBar', 'addTrack', 'playFromStart']) {
      expect(labels(id)).withContext(id).toBe(2);
    }
  });
});

describe('toolForPress', () => {
  const id = (init: Partial<KeyPress>): string | null => toolForPress(press(init))?.id ?? null;

  it('finds the tool a press means, by the design\'s table', () => {
    expect(id({ key: 'r', code: 'KeyR' })).toBe('rest');
    expect(id({ key: 'R', code: 'KeyR', shiftKey: true })).toBe('rest');
    expect(id({ key: '+', code: 'Equal', shiftKey: true })).toBe('longer');
    expect(id({ key: '=', code: 'Equal' })).toBe('longer');
    expect(id({ key: '-', code: 'Minus' })).toBe('shorter');
    expect(id({ key: 'ArrowRight', ctrlKey: true })).toBe('nextBar');
    expect(id({ key: 'ArrowRight', shiftKey: true })).toBe('extendRight');
    expect(id({ key: 'Enter', altKey: true })).toBe('insertBeat');
    expect(id({ key: ' ', shiftKey: true })).toBe('playFromStart');
    expect(id({ key: '7', code: 'Digit7' })).toBe('fret');
  });

  it('matches Ctrl with a letter by the letter typed, so undo, redo and select all survive QWERTZ and AZERTY', () => {
    // A German keyboard types z on the key a US one calls KeyY, and y on KeyZ; French types a on KeyQ.
    expect(id({ key: 'z', code: 'KeyY', ctrlKey: true })).toBe('undo');
    expect(id({ key: 'y', code: 'KeyZ', ctrlKey: true })).toBe('redo');
    expect(id({ key: 'a', code: 'KeyQ', ctrlKey: true })).toBe('selectAll');
    expect(id({ key: 'q', code: 'KeyA', ctrlKey: true })).toBeNull();
  });

  it('lets a typed letter beat a physical-key match, so Dvorak Ctrl+Z is undo and nothing else', () => {
    // Dvorak types z on the key a US keyboard calls Slash, where Triplet feel's Ctrl+/ is bound.
    const dvorakCtrlZ = press({ key: 'z', code: 'Slash', ctrlKey: true });
    const matching = COMPOSER_TOOLS.filter(entry => entry.keys.some(binding => bindingMatches(binding, dvorakCtrlZ))).map(entry => entry.id);

    expect(matching).toEqual(['undo']);
    expect(id({ key: '/', code: 'Slash', ctrlKey: true })).toBe('tripletFeel');
  });

  it('falls back to the physical key for a letter when the layout typed no Latin letter', () => {
    expect(id({ key: 'к', code: 'KeyR' })).toBe('rest');
    expect(id({ key: 'я', code: 'KeyZ', ctrlKey: true })).toBe('undo');
  });

  it('prefers an exact binding to a symbol typed through Alt', () => {
    expect(id({ key: '/', code: 'Slash', altKey: true })).toBe('tuplet');
    expect(id({ key: '}', code: 'Digit0', ctrlKey: true, altKey: true })).toBe('alternateEnding');
  });

  it('finds nothing for a press the browser or the table does not give the composer', () => {
    expect(id({ key: '1', code: 'Digit1', ctrlKey: true })).toBeNull();
    expect(id({ key: '1', code: 'Digit1', altKey: true })).toBeNull();
    expect(id({ key: 'z', code: 'KeyZ', ctrlKey: true, altKey: true })).toBeNull();
  });
});

describe('COMPOSER_TOOLS commands', () => {
  let composer: ComposerService;
  let host: jasmine.SpyObj<Omit<ComposerToolHost, 'composer'>> & { composer: ComposerService };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    composer = TestBed.inject(ComposerService);
    host = {
      composer,
      ...jasmine.createSpyObj('host', ['openPopover', 'toggleShortcutSheet', 'escape', 'playPause', 'playFromStart', 'requestSave', 'addTrack', 'typeFretDigit'])
    };
  });

  const run = (id: string, key = ''): void => tool(id).run(host, press({ key }));
  const firstBeat = () => composer.doc.tracks[0].staves[0].bars[0].voices[0].beats[0];

  it('makes the selection longer with + and shorter with -', () => {
    run('shorter');
    expect(firstBeat().duration).toBe(8);

    composer.setCursor({ beatIndex: 0 });
    run('longer');
    run('longer');
    expect(firstBeat().duration).toBe(2);
  });

  it('dots the selected beat at its own value, not the input duration', () => {
    composer.applyDurationAtCursor(2, 0);
    composer.setInputDuration(4, 0);
    composer.setCursor({ beatIndex: 0 });

    run('dot');

    expect([firstBeat().duration, firstBeat().dots]).toEqual([2, 1]);
  });

  it('steps + from the value the selection shares, and from the input duration when it shares none', () => {
    // Two quarters made eighths: with the rests that fill after them, the range is three eighths.
    composer.setCursor({ beatIndex: 0 });
    composer.extendSelectionTo({ beatIndex: 1 });
    composer.applyDurationAtCursor(8, 0);
    composer.setInputDuration(4, 0);

    run('longer');
    expect(firstBeat().duration).toBe(4);

    // A half and a quarter share no value, so + steps from the input duration, an eighth, to a quarter.
    composer.reset();
    composer.applyDurationAtCursor(2, 0);
    composer.setInputDuration(8, 0);
    composer.setCursor({ beatIndex: 0 });
    composer.extendSelectionTo({ beatIndex: 1 });
    run('longer');
    expect(composer.doc.tracks[0].staves[0].bars[0].voices[0].beats.slice(0, 2).map(beat => beat.duration)).toEqual([4, 4]);
  });

  it('dots the selection, and takes the dot off when every beat has one', () => {
    run('dot');
    expect(firstBeat().dots).toBe(1);

    run('dot');
    expect(firstBeat().dots).toBe(0);
  });

  it('forces a flat, and a second press returns the note to auto', () => {
    // String 3 (G, 55) at fret 3 is B flat.
    composer.setCursor({ stringIndex: 2 });
    composer.setNoteAtCursor({ kind: 'fretted', string: 3, fret: 3 }, false);

    run('flat');
    expect(firstBeat().notes[0].accidental).toBe('flat');

    run('flat');
    expect(firstBeat().notes[0].accidental).toBe('auto');
  });

  it('toggles Select and Pen with Q', () => {
    run('toggleEntryMode');
    expect(composer.state.entryMode).toBe('pen');

    run('toggleEntryMode');
    expect(composer.state.entryMode).toBe('select');
  });

  it('rests a range without moving on, and the caret\'s beat with the input duration otherwise', () => {
    composer.setCursor({ beatIndex: 0 });
    composer.extendSelectionTo({ beatIndex: 1 });
    run('rest');
    expect(composer.state.cursor.beatIndex).toBe(1);

    composer.setCursor({ beatIndex: 0 });
    run('rest');
    expect(composer.state.cursor.beatIndex).toBe(1);
  });

  it('hands a digit to the fret entry, and a popover tool to the page', () => {
    run('fret', '7');
    expect(host.typeFretDigit).toHaveBeenCalledWith(7);

    run('timeSignature');
    expect(host.openPopover).toHaveBeenCalledWith('timeSignature');
  });
});
