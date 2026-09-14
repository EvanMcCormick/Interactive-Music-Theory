import type { ComposerService } from './composer.service';
import { DurationValue, DynamicValue, EntryMode } from '../models/composer.model';
import { beatsAt } from './beat-edits';
import { KeyBinding, KeyPress, bindingMatches, bindingMatchesSymbol, bindingMatchesTyped } from './composer-key-bindings';
import { selectionTargets } from './composer-selection';
import { toolStateOf } from './composer-tool-states';
import { fullBendPoints } from './composer-tool-defaults';

/**
 * Every tool the composer has, declared once: its label, group, glyph, keys and command.
 *
 * The palette draws its buttons from this table, their tooltips name the keys from it, the `?` sheet
 * lists it, and the keyboard handler looks a press up in it - so a key cannot drift from its button.
 * The keys are the design's shortcut table (design doc, "Shortcuts"), with the M2 plan's corrections:
 * `+` is longer, the macOS alternates, and Shift+R beside R.
 */

/** Where a tool sits: its palette group, or the shortcut sheet's section for a tool with no button. */
export type ToolGroup =
  | 'Tools'
  | 'Edit'
  | 'Navigation'
  | 'Playback'
  | 'Beats'
  | 'Duration'
  | 'Bar'
  | 'Tracks'
  | 'Accidentals'
  | 'Dynamics'
  | 'Articulation'
  | 'Techniques';

/** The palette's groups, in the design's order. */
export const PALETTE_GROUPS: readonly ToolGroup[] = ['Tools', 'Duration', 'Bar', 'Accidentals', 'Dynamics', 'Articulation', 'Techniques'];

/** A button face: a Bravura glyph by SMuFL code point, or short text where SMuFL has no symbol. */
export type ToolGlyph = { kind: 'smufl'; codePoint: number } | { kind: 'text'; text: string };

/** The tools that take a value, each opening a small popover anchored to its button. */
export type PopoverKind = 'timeSignature' | 'keySignature' | 'clef' | 'section' | 'alternateEnding' | 'tuplet' | 'tripletFeel';

/** What a command reaches beyond the service: the page's own controls. */
export interface ComposerToolHost {
  readonly composer: ComposerService;
  /** Opens the popover for a valued tool, anchored to that tool's palette button. */
  openPopover(kind: PopoverKind): void;
  toggleShortcutSheet(): void;
  /**
   * Closes an open popover, or the open shortcut sheet, and does nothing else - a modal takes Escape alone; with
   * neither open, back to Select and no range.
   */
  escape(): void;
  playPause(): void;
  playFromStart(): void;
  /** Asks the library to save, as its own Save button does. */
  requestSave(): void;
  /** Adds a track of the instrument the track strip has chosen. */
  addTrack(): void;
  /** A fret digit, which may be the second digit of a two-digit fret. See `FretDigitEntry`. */
  typeFretDigit(digit: number): void;
}

/**
 * What kind of control a tool is, so the page gives it the semantics it has:
 * - `toggle`: a press turns what it shows on, or off when every target has it - `aria-pressed`, `mixed` included.
 * - `radio`: one of a set of exclusive values - the note values, Select and Pen - pressed when it is the one in force.
 * - `popover`: opens a popover to choose a value. Never `aria-pressed`; its state only says a value is set.
 * - `action`: does something once - Fix bar, Insert bar, Respell, Natural, Rest, every key-only command. Never `aria-pressed`.
 */
export type ToolKind = 'toggle' | 'radio' | 'popover' | 'action';

export interface ComposerTool {
  id: string;
  /** What kind of control it is. See `ToolKind`. */
  kind: ToolKind;
  /**
   * Whether a held key's auto-repeat runs it again. Only moves - navigation, extending, semitone and string
   * moves - undo and redo, and `+` and `-`, where holding the key means doing it again. Anything else - a
   * toggle, a save, a fret digit, Delete - runs once per press: held, a toggle would flicker on and off,
   * a digit would write a run of notes, and Delete would add an undo step per repeat that changed nothing.
   */
  repeatable?: boolean;
  /** Whether it runs with the focus in a text field too: Ctrl+S, so the browser's own Save dialog never opens. */
  inTextFields?: boolean;
  /** Whether it leaves the press to the browser while text outside the score is selected: Ctrl+C and Ctrl+X. */
  yieldsToTextSelection?: boolean;
  /** The button's accessible name, and the start of its tooltip. */
  label: string;
  group: ToolGroup;
  glyph: ToolGlyph;
  /** Every press that runs it. Empty only for the tools `KEYLESS_TOOLS` names. */
  keys: readonly KeyBinding[];
  /** Whether the palette draws a button for it. */
  inPalette: boolean;
  /** Runs the command. `press` is the key that ran it, or null for a click. */
  run(host: ComposerToolHost, press: KeyPress | null): void;
}

/** The tools the design's shortcut table gives no key: the note values, which `+` and `-` step, and Select and Pen, which Q toggles. */
export const KEYLESS_TOOLS: readonly string[] = ['select', 'pen', 'whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirtySecond', 'sixtyFourth'];

/** The note values, longest first, as `+` and `-` step through them. */
export const DURATION_ORDER: readonly DurationValue[] = [1, 2, 4, 8, 16, 32, 64];

const key = (value: string, modifiers: Omit<KeyBinding, 'key' | 'code'> = {}): KeyBinding => ({ key: value, ...modifiers });
const code = (value: string, modifiers: Omit<KeyBinding, 'key' | 'code'>): KeyBinding => ({ code: value, ...modifiers });
const smufl = (codePoint: number): ToolGlyph => ({ kind: 'smufl', codePoint });
const text = (value: string): ToolGlyph => ({ kind: 'text', text: value });

/** Whether the tool `id`'s press would clear what every target has. */
function pressedNowOf(composer: ComposerService, id: string): boolean {
  const { doc, anchor, cursor } = composer.state;
  return toolStateOf(doc, anchor, cursor, id).pressed === true;
}

/**
 * Presses `+` (-1, longer) or `-` (+1, shorter): one step along `DURATION_ORDER` from the value the
 * selection's beats share, graces aside, keeping the dots they share - or, when they share none, from the
 * input duration and its dots. So `+` on eighths makes quarters whatever the palette last held.
 */
function steppedDuration(host: ComposerToolHost, steps: -1 | 1): void {
  const state = host.composer.state;
  const beats = beatsAt(state.doc, selectionTargets(state.doc, state.anchor, state.cursor)).filter(beat => beat.effects.grace === 'none');
  const first = beats[0];
  const sharedValue = first !== undefined && beats.every(beat => beat.duration === first.duration);
  const sharedDots = first !== undefined && beats.every(beat => beat.dots === first.dots);
  const from = sharedValue ? first.duration : state.inputDuration;
  const index = DURATION_ORDER.indexOf(from);
  const next = DURATION_ORDER[Math.max(0, Math.min(DURATION_ORDER.length - 1, (index < 0 ? 2 : index) + steps))];
  host.composer.applyDurationAtCursor(next, sharedDots ? first.dots : state.inputDots);
}

function durationTool(id: string, label: string, value: DurationValue, codePoint: number): ComposerTool {
  return {
    id, kind: 'radio', label, group: 'Duration', glyph: smufl(codePoint), keys: [], inPalette: true,
    run: host => host.composer.applyDurationAtCursor(value, 0)
  };
}

/** A dot tool: the selected beats' own values dotted, or undotted when every one already has `count`. */
function dotTool(id: string, label: string, count: number, keys: KeyBinding[], glyph: ToolGlyph): ComposerTool {
  return {
    id, kind: 'toggle', label, group: 'Duration', glyph, keys, inPalette: true,
    run: host => host.composer.applyDotsAtCursor(pressedNowOf(host.composer, id) ? 0 : count)
  };
}

function dynamicTool(value: DynamicValue, digit: number, codePoint: number): ComposerTool {
  return {
    id: value, kind: 'toggle', label: `Dynamic ${value}`, group: 'Dynamics', glyph: smufl(codePoint),
    keys: [code(`Digit${digit}`, { ctrl: true, shift: true })], inPalette: true,
    run: host => host.composer.setDynamics(pressedNowOf(host.composer, value) ? null : value)
  };
}

function accidentalTool(id: 'doubleFlat' | 'flat' | 'sharp' | 'doubleSharp', label: string, keys: KeyBinding[], codePoint: number): ComposerTool {
  return {
    id, kind: 'toggle', label, group: 'Accidentals', glyph: smufl(codePoint), keys, inPalette: true,
    run: host => host.composer.setAccidental(pressedNowOf(host.composer, id) ? 'auto' : id)
  };
}

function popoverTool(id: PopoverKind, label: string, group: ToolGroup, glyph: ToolGlyph, keys: KeyBinding[]): ComposerTool {
  return { id, kind: 'popover', label, group, glyph, keys, inPalette: true, run: host => host.openPopover(id) };
}

function modeTool(id: EntryMode, label: string, glyph: ToolGlyph): ComposerTool {
  return { id, kind: 'radio', label, group: 'Tools', glyph, keys: [], inPalette: true, run: host => host.composer.setEntryMode(id) };
}

/** The key-only commands whose auto-repeat runs them again, beside every navigation move. See `ComposerTool.repeatable`. */
const REPEATING: ReadonlySet<string> = new Set(['undo', 'redo', 'semitoneUp', 'semitoneDown', 'stringAbove', 'stringBelow', 'longer', 'shorter']);

/** A tool with no button, for the keyboard and the shortcut sheet. */
function keyTool(id: string, label: string, group: ToolGroup, keys: KeyBinding[], run: ComposerTool['run']): ComposerTool {
  return { id, kind: 'action', label, group, glyph: text(label), keys, inPalette: false, repeatable: group === 'Navigation' || REPEATING.has(id), run };
}

/** A palette tool that runs a service command: a toggle, unless it is said to be an action. */
function button(
  id: string,
  label: string,
  group: ToolGroup,
  glyph: ToolGlyph,
  keys: KeyBinding[],
  run: (composer: ComposerService) => void,
  kind: ToolKind = 'toggle'
): ComposerTool {
  return { id, kind, label, group, glyph, keys, inPalette: true, run: host => run(host.composer) };
}

export const COMPOSER_TOOLS: readonly ComposerTool[] = [
  // Tools
  modeTool('select', 'Select: a click on notation moves the caret', text('Select')),
  modeTool('pen', 'Pen: a click on notation writes that pitch', text('Pen')),
  keyTool('toggleEntryMode', 'Toggle Select / Pen', 'Tools', [key('q')], host =>
    host.composer.setEntryMode(host.composer.state.entryMode === 'select' ? 'pen' : 'select')
  ),
  keyTool('escape', 'Back to Select, clear the range', 'Tools', [key('Escape')], host => host.escape()),
  keyTool('shortcutSheet', 'Shortcut sheet', 'Tools', [key('?')], host => host.toggleShortcutSheet()),

  // Edit
  keyTool('undo', 'Undo', 'Edit', [code('KeyZ', { ctrl: true })], host => host.composer.undo()),
  keyTool('redo', 'Redo', 'Edit', [code('KeyZ', { ctrl: true, shift: true }), code('KeyY', { ctrl: true })], host => host.composer.redo()),
  { ...keyTool('cut', 'Cut', 'Edit', [code('KeyX', { ctrl: true })], host => host.composer.cut()), yieldsToTextSelection: true },
  { ...keyTool('copy', 'Copy', 'Edit', [code('KeyC', { ctrl: true })], host => host.composer.copy()), yieldsToTextSelection: true },
  keyTool('paste', 'Paste', 'Edit', [code('KeyV', { ctrl: true })], host => host.composer.paste()),
  keyTool('selectAll', 'Select all in track', 'Edit', [code('KeyA', { ctrl: true })], host => host.composer.selectAllInTrack()),
  { ...keyTool('save', 'Save', 'Edit', [code('KeyS', { ctrl: true })], host => host.requestSave()), inTextFields: true },

  // Navigation
  keyTool('previousBeat', 'Previous beat', 'Navigation', [key('ArrowLeft')], host => host.composer.moveCursor({ kind: 'beat', delta: -1 })),
  keyTool('nextBeat', 'Next beat', 'Navigation', [key('ArrowRight')], host => host.composer.moveCursor({ kind: 'beat', delta: 1 })),
  keyTool('previousString', 'Previous string', 'Navigation', [key('ArrowUp')], host => host.composer.moveCursor({ kind: 'string', delta: -1 })),
  keyTool('nextString', 'Next string', 'Navigation', [key('ArrowDown')], host => host.composer.moveCursor({ kind: 'string', delta: 1 })),
  keyTool('extendLeft', 'Extend the selection a beat left', 'Navigation', [key('ArrowLeft', { shift: true })], host =>
    host.composer.moveCursor({ kind: 'beat', delta: -1 }, true)
  ),
  keyTool('extendRight', 'Extend the selection a beat right', 'Navigation', [key('ArrowRight', { shift: true })], host =>
    host.composer.moveCursor({ kind: 'beat', delta: 1 }, true)
  ),
  keyTool('extendUp', 'Extend the selection to the track above', 'Navigation', [key('ArrowUp', { shift: true })], host =>
    host.composer.moveCursor({ kind: 'track', delta: -1 }, true)
  ),
  keyTool('extendDown', 'Extend the selection to the track below', 'Navigation', [key('ArrowDown', { shift: true })], host =>
    host.composer.moveCursor({ kind: 'track', delta: 1 }, true)
  ),
  keyTool('barStart', 'First beat of the bar', 'Navigation', [key('Home')], host => host.composer.moveCursor({ kind: 'barEdge', edge: 'first' })),
  keyTool('barEnd', 'Last beat of the bar', 'Navigation', [key('End')], host => host.composer.moveCursor({ kind: 'barEdge', edge: 'last' })),
  keyTool('previousBar', 'Previous bar', 'Navigation', [key('ArrowLeft', { ctrl: true })], host => host.composer.moveCursor({ kind: 'bar', delta: -1 })),
  keyTool('nextBar', 'Next bar', 'Navigation', [key('ArrowRight', { ctrl: true })], host => host.composer.moveCursor({ kind: 'bar', delta: 1 })),
  keyTool('firstBar', 'First bar', 'Navigation', [key('Home', { ctrl: true })], host => host.composer.moveCursor({ kind: 'scoreEdge', edge: 'first' })),
  keyTool('lastBar', 'Last bar', 'Navigation', [key('End', { ctrl: true })], host => host.composer.moveCursor({ kind: 'scoreEdge', edge: 'last' })),
  keyTool('previousTrack', 'Previous track', 'Navigation', [key('ArrowUp', { ctrl: true, shift: true })], host =>
    host.composer.moveCursor({ kind: 'track', delta: -1 })
  ),
  keyTool('nextTrack', 'Next track', 'Navigation', [key('ArrowDown', { ctrl: true, shift: true })], host =>
    host.composer.moveCursor({ kind: 'track', delta: 1 })
  ),

  // Playback
  keyTool('playPause', 'Play / pause', 'Playback', [key(' ')], host => host.playPause()),
  keyTool('playFromStart', 'Play from the start', 'Playback', [key(' ', { ctrl: true }), key(' ', { shift: true })], host => host.playFromStart()),

  // Beats
  keyTool('fret', 'Fret', 'Beats', ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit => key(digit)), (host, press) =>
    host.typeFretDigit(Number(press?.key ?? 0))
  ),
  keyTool('clearBeat', 'Clear beat to rest', 'Beats', [key('Delete'), key('Backspace')], host =>
    host.composer.state.anchor ? host.composer.clearSelectionToRests() : host.composer.deleteAtCursor()
  ),
  keyTool('insertBeat', 'Insert beat', 'Beats', [key('Insert'), key('Enter', { alt: true })], host => host.composer.insertBeat()),
  keyTool('deleteBeats', 'Delete beats', 'Beats', [key('Delete', { shift: true })], host => host.composer.deleteBeats()),

  // Duration
  durationTool('whole', 'Whole note', 1, 0xe1d2),
  durationTool('half', 'Half note', 2, 0xe1d3),
  durationTool('quarter', 'Quarter note', 4, 0xe1d5),
  durationTool('eighth', 'Eighth note', 8, 0xe1d7),
  durationTool('sixteenth', 'Sixteenth note', 16, 0xe1d9),
  durationTool('thirtySecond', 'Thirty-second note', 32, 0xe1db),
  durationTool('sixtyFourth', 'Sixty-fourth note', 64, 0xe1dd),
  keyTool('longer', 'Longer', 'Duration', [key('+'), key('=')], host => steppedDuration(host, -1)),
  keyTool('shorter', 'Shorter', 'Duration', [key('-')], host => steppedDuration(host, 1)),
  dotTool('dot', 'Dot', 1, [key('.')], smufl(0xe1e7)),
  dotTool('doubleDot', 'Double dot', 2, [code('Period', { alt: true })], text('..')),
  button('triplet', 'Triplet', 'Duration', smufl(0xe883), [key('/')], composer =>
    composer.setTuplet(pressedNowOf(composer, 'triplet') ? null : { numerator: 3, denominator: 2 })
  ),
  popoverTool('tuplet', 'Tuplet…', 'Duration', text('n:m'), [code('Slash', { alt: true })]),
  button('tie', 'Tie', 'Duration', text('‿'), [key('l')], composer => composer.toggleTie()),
  {
    id: 'rest', kind: 'action', label: 'Rest', group: 'Duration', glyph: smufl(0xe4e5), keys: [key('r'), key('r', { shift: true })], inPalette: true,
    run: host => (host.composer.state.anchor ? host.composer.clearSelectionToRests() : host.composer.setRestAtCursor())
  },

  // Bar
  popoverTool('timeSignature', 'Time signature…', 'Bar', smufl(0xe08a), [key('t', { shift: true })]),
  // Text, not a sharp: SMuFL has no key-signature symbol, and U+E262 is already the Sharp button's face.
  popoverTool('keySignature', 'Key signature…', 'Bar', text('Key'), [code('KeyK', { ctrl: true })]),
  popoverTool('clef', 'Clef…', 'Bar', smufl(0xe050), [key('k')]),
  button('repeatOpen', 'Repeat open', 'Bar', smufl(0xe040), [key('[')], composer => composer.toggleMasterBarFlag('isRepeatStart')),
  button('repeatClose', 'Repeat close', 'Bar', smufl(0xe041), [key(']')], composer => composer.toggleRepeatClose()),
  popoverTool('alternateEnding', 'Alternate ending…', 'Bar', text('1.'), [key('}')]),
  popoverTool('section', 'Section…', 'Bar', smufl(0xe047), [key('Insert', { shift: true }), key('Enter', { shift: true })]),
  button('doubleBar', 'Double bar', 'Bar', smufl(0xe031), [key('b', { shift: true })], composer => composer.toggleMasterBarFlag('isDoubleBar')),
  popoverTool('tripletFeel', 'Triplet feel…', 'Bar', text('3♪'), [code('Slash', { ctrl: true })]),
  button('freeTime', 'Free time', 'Bar', text('free'), [key('|')], composer => composer.toggleMasterBarFlag('isFreeTime')),
  button('fixBar', 'Fix bar', 'Bar', text('Fix'), [key('F4')], composer => composer.fixBar(), 'action'),
  button('insertBar', 'Insert bar', 'Bar', text('+bar'), [key('Insert', { ctrl: true }), key('Enter', { ctrl: true })], composer =>
    composer.insertBarsBeforeSelection(), 'action'
  ),
  button('deleteBar', 'Delete bar', 'Bar', text('−bar'), [key('Delete', { ctrl: true })], composer => composer.deleteSelectedBars(), 'action'),

  // Tracks
  keyTool('addTrack', 'Add track', 'Tracks', [key('Insert', { ctrl: true, shift: true }), key('Enter', { ctrl: true, shift: true })], host => host.addTrack()),
  keyTool('deleteTrack', 'Delete track', 'Tracks', [key('Backspace', { ctrl: true, shift: true })], host =>
    host.composer.removeTrack(host.composer.state.cursor.trackIndex)
  ),

  // Accidentals
  accidentalTool('doubleFlat', 'Double flat', [code('Minus', { alt: true, shift: true })], 0xe264),
  accidentalTool('flat', 'Flat', [code('Minus', { alt: true })], 0xe260),
  button('natural', 'Natural (clears a forced accidental)', 'Accidentals', smufl(0xe261), [code('Digit0', { alt: true })], composer =>
    composer.setAccidental('auto'), 'action'
  ),
  accidentalTool('sharp', 'Sharp', [code('Equal', { alt: true })], 0xe262),
  accidentalTool('doubleSharp', 'Double sharp', [code('Equal', { alt: true, shift: true })], 0xe263),
  button('respell', 'Respell', 'Accidentals', text('E♯/F'), [key('e')], composer => composer.respell(), 'action'),
  keyTool('semitoneDown', 'Semitone down', 'Accidentals', [key('ArrowDown', { alt: true })], host => host.composer.shiftSemitone(-1)),
  keyTool('semitoneUp', 'Semitone up', 'Accidentals', [key('ArrowUp', { alt: true })], host => host.composer.shiftSemitone(1)),
  keyTool('stringBelow', 'Note to the string below', 'Accidentals', [key('ArrowDown', { ctrl: true, alt: true })], host =>
    host.composer.moveNotesToString(1)
  ),
  keyTool('stringAbove', 'Note to the string above', 'Accidentals', [key('ArrowUp', { ctrl: true, alt: true })], host =>
    host.composer.moveNotesToString(-1)
  ),

  // Dynamics
  dynamicTool('ppp', 1, 0xe52a),
  dynamicTool('pp', 2, 0xe52b),
  dynamicTool('p', 3, 0xe520),
  dynamicTool('mp', 4, 0xe52c),
  dynamicTool('mf', 5, 0xe52d),
  dynamicTool('f', 6, 0xe522),
  dynamicTool('ff', 7, 0xe52f),
  dynamicTool('fff', 8, 0xe530),
  button('crescendo', 'Crescendo', 'Dynamics', smufl(0xe53e), [code('Comma', { ctrl: true, shift: true })], composer =>
    composer.toggleBeatEffect('crescendo', 'crescendo', 'none')
  ),
  button('decrescendo', 'Diminuendo', 'Dynamics', smufl(0xe53f), [code('Period', { ctrl: true, shift: true })], composer =>
    composer.toggleBeatEffect('crescendo', 'decrescendo', 'none')
  ),

  // Articulation
  button('accent', 'Accent', 'Articulation', smufl(0xe4a0), [key(';')], composer => composer.toggleNoteEffect('accent', 'normal', 'none')),
  button('heavyAccent', 'Heavy accent', 'Articulation', smufl(0xe4ac), [key(':')], composer => composer.toggleNoteEffect('accent', 'heavy', 'none')),
  button('staccato', 'Staccato', 'Articulation', smufl(0xe4a2), [key('!')], composer => composer.toggleNoteEffect('isStaccato', true, false)),
  button('tenuto', 'Tenuto', 'Articulation', smufl(0xe4a4), [key('_')], composer => composer.toggleNoteEffect('accent', 'tenuto', 'none')),
  button('fermata', 'Fermata', 'Articulation', smufl(0xe4c0), [key('f')], composer => composer.toggleFermata()),

  // Techniques
  button('hammerOn', 'Hammer-on / pull-off', 'Techniques', text('H'), [key('h')], composer => composer.toggleNoteEffect('isHammerPullOrigin', true, false)),
  button('legatoSlide', 'Legato slide', 'Techniques', text('sl.'), [key('s')], composer => composer.toggleNoteEffect('slide', 'legatoSlide', 'none')),
  button('shiftSlide', 'Shift slide', 'Techniques', text('sh.'), [key('s', { shift: true })], composer => composer.toggleNoteEffect('slide', 'shiftSlide', 'none')),
  button('bend', 'Bend (full)', 'Techniques', text('⤴'), [key('b')], composer => composer.toggleNoteEffect('bendPoints', fullBendPoints(), [])),
  button('vibrato', 'Vibrato', 'Techniques', smufl(0xeab2), [key('v')], composer => composer.toggleNoteEffect('vibrato', 'slight', 'none')),
  button('wideVibrato', 'Wide vibrato', 'Techniques', smufl(0xeab3), [key('v', { shift: true })], composer => composer.toggleNoteEffect('vibrato', 'wide', 'none')),
  button('palmMute', 'Palm mute', 'Techniques', text('P.M.'), [key('p')], composer => composer.toggleNoteEffect('isPalmMute', true, false)),
  button('letRing', 'Let ring', 'Techniques', text('let r.'), [key('i')], composer => composer.toggleNoteEffect('isLetRing', true, false)),
  button('naturalHarmonic', 'Natural harmonic', 'Techniques', smufl(0xe614), [key('y')], composer => composer.toggleNoteEffect('harmonic', 'natural', 'none')),
  button('artificialHarmonic', 'Artificial harmonic', 'Techniques', text('A.H.'), [key('y', { shift: true })], composer =>
    composer.toggleNoteEffect('harmonic', 'artificial', 'none')
  ),
  button('ghost', 'Ghost note', 'Techniques', text('( )'), [key('o')], composer => composer.toggleNoteEffect('isGhost', true, false)),
  button('dead', 'Dead note', 'Techniques', smufl(0xe0a9), [key('x')], composer => composer.toggleNoteEffect('isDead', true, false)),
  button('trill', 'Trill (whole step)', 'Techniques', smufl(0xe566), [key('n')], composer => composer.toggleTrill()),
  button('tap', 'Tap', 'Techniques', text('T'), [key(')')], composer => composer.toggleBeatEffect('tap', true, false)),
  button('leftHandTap', 'Left-hand tap', 'Techniques', text('LHT'), [key('(')], composer => composer.toggleNoteEffect('isLeftHandTapped', true, false)),
  button('slap', 'Slap', 'Techniques', text('S'), [key('$')], composer => composer.toggleBeatEffect('slap', true, false)),
  button('pop', 'Pop', 'Techniques', text('Pop'), [key('%')], composer => composer.toggleBeatEffect('pop', true, false)),
  button('graceBefore', 'Grace note before the beat', 'Techniques', smufl(0xe560), [key('g')], composer => composer.toggleGrace('beforeBeat')),
  button('graceOnBeat', 'Grace note on the beat', 'Techniques', smufl(0xe562), [key('g', { shift: true })], composer => composer.toggleGrace('onBeat')),
  button('pickDown', 'Pick stroke down', 'Techniques', smufl(0xe610), [key('d', { shift: true })], composer =>
    composer.toggleBeatEffect('pickStroke', 'down', 'none')
  ),
  button('pickUp', 'Pick stroke up', 'Techniques', smufl(0xe612), [key('u', { shift: true })], composer =>
    composer.toggleBeatEffect('pickStroke', 'up', 'none')
  ),
  button('fadeIn', 'Fade in', 'Techniques', text('<'), [key('<')], composer => composer.toggleBeatEffect('fadeIn', true, false))
];

/**
 * The tool `press` runs, or null. Three questions, each asked of the whole table before the next: a binding's own key
 * (`bindingMatches`); a Ctrl symbol typed on another key (`bindingMatchesSymbol`); a symbol typed through AltGr or
 * Option (`bindingMatchesTyped`). So an exact binding always wins: AZERTY's Ctrl+Shift on `Comma`, which types `.`, is
 * crescendo's, and an exact Alt binding beats a typed symbol.
 */
export function toolForPress(press: KeyPress, tools: readonly ComposerTool[] = COMPOSER_TOOLS): ComposerTool | null {
  for (const matches of [bindingMatches, bindingMatchesSymbol, bindingMatchesTyped]) {
    const tool = tools.find(entry => entry.keys.some(binding => matches(binding, press)));
    if (tool) return tool;
  }
  return null;
}
