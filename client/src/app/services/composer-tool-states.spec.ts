import { ComposerService } from './composer.service';
import { toolStateOf, toolStates } from './composer-tool-states';
import { EditCursor, NoteDoc, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

const at = (barIndex: number, beatIndex: number, trackIndex = 0, stringIndex: number | null = 0): EditCursor =>
  ({ trackIndex, staffIndex: 0, barIndex, voiceIndex: 0, beatIndex, stringIndex });

/** Puts a note on tab string `string` at bar `bar`, beat `beat` of track 0, and returns it. */
function put(doc: ScoreDoc, bar: number, beat: number, string = 1, fret = 3): NoteDoc {
  const target = doc.tracks[0].staves[0].bars[bar].voices[0].beats[beat];
  const note: NoteDoc = { pitch: { kind: 'fretted', string, fret }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() };
  target.isRest = false;
  target.notes.push(note);
  return note;
}

describe('toolStates', () => {
  it('shows a note effect as on, mixed or off across a range', () => {
    const doc = ComposerService.createEmptyScore();
    put(doc, 0, 0).effects.isPalmMute = true;
    put(doc, 0, 1);

    expect(toolStateOf(doc, at(0, 0), at(0, 0), 'palmMute').pressed).toBeTrue();
    expect(toolStateOf(doc, at(0, 0), at(0, 1), 'palmMute').pressed).toBe('mixed');
    expect(toolStateOf(doc, null, at(0, 1), 'palmMute').pressed).toBeFalse();
  });

  it('reads a tied note\'s vibrato from the note it is tied from, and says why a press there is refused', () => {
    const doc = ComposerService.createEmptyScore();
    put(doc, 0, 0).effects.vibrato = 'slight';
    put(doc, 0, 1).isTied = true;

    const state = toolStateOf(doc, null, at(0, 1), 'vibrato');

    expect(state.pressed).toBeTrue();
    expect(state.refusal).toMatch(/tied from/i);
  });

  it('explains a hammer-on with nothing to land on before it is pressed', () => {
    const doc = ComposerService.createEmptyScore();
    put(doc, 0, 0);

    expect(toolStateOf(doc, null, at(0, 0), 'hammerOn').refusal).toMatch(/land/i);
  });

  it('shows the selection\'s duration and dots, and refuses them on a grace', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[0].voices[0].beats[1].dots = 1;

    expect(toolStateOf(doc, at(0, 0), at(0, 1), 'quarter').pressed).toBeTrue();
    expect(toolStateOf(doc, at(0, 0), at(0, 1), 'dot').pressed).toBe('mixed');

    doc.tracks[0].staves[0].bars[0].voices[0].beats[0].effects.grace = 'beforeBeat';
    expect(toolStateOf(doc, null, at(0, 0), 'quarter').refusal).toMatch(/grace/i);
  });

  it('shows a fermata that is on another track at the position', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    doc.tracks[1].staves[0].bars[0].voices[0].beats[2].effects.fermata = { type: 'medium', length: 1 };

    expect(toolStateOf(doc, null, at(0, 2), 'fermata').pressed).toBe('mixed');
  });

  it('refuses a fermata on a grace alone, which has no bar position', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[0].voices[0].beats[0].effects.grace = 'beforeBeat';

    expect(toolStateOf(doc, null, at(0, 0), 'fermata').refusal).toMatch(/grace note has no bar position/i);
    expect(toolStateOf(doc, null, at(0, 1), 'fermata').refusal).toBeNull();
  });

  it('refuses note tools on a generated track, by the same reason the command gives', () => {
    const doc = ComposerService.createEmptyScore();
    put(doc, 0, 0);
    doc.tracks[0].generated = { progressionId: 'p', progressionName: 'Verse', source: { kind: 'revision', revision: 1 } };

    expect(toolStateOf(doc, null, at(0, 0), 'ghost').refusal).toMatch(/progression/i);
    expect(toolStateOf(doc, null, at(0, 0), 'fixBar').refusal).toMatch(/progression/i);
  });

  it('refuses Fix bar when no selected bar is over, and not when one is', () => {
    const doc = ComposerService.createEmptyScore();
    expect(toolStateOf(doc, null, at(0, 0), 'fixBar').refusal).toMatch(/over/i);

    doc.tracks[0].staves[0].bars[0].voices[0].beats[0].duration = 1;
    expect(toolStateOf(doc, null, at(0, 0), 'fixBar').refusal).toBeNull();
  });

  it('refuses deleting every bar', () => {
    const doc = ComposerService.createEmptyScore();

    expect(toolStateOf(doc, at(0, 0), at(3, 0), 'deleteBar').refusal).toMatch(/at least one bar/i);
    expect(toolStateOf(doc, null, at(3, 0), 'deleteBar').refusal).toBeNull();
  });

  it('never shows Natural pressed, since it only clears', () => {
    const doc = ComposerService.createEmptyScore();
    put(doc, 0, 0);

    expect(toolStateOf(doc, null, at(0, 0), 'natural').pressed).toBeFalse();
  });

  it('answers every tool it knows at once, and idle for one it does not', () => {
    const doc = ComposerService.createEmptyScore();
    const states = toolStates(doc, null, at(0, 0));

    expect(states.get('quarter')?.pressed).toBeTrue();
    expect(toolStateOf(doc, null, at(0, 0), 'no-such-tool')).toEqual({ pressed: false, refusal: null });
  });
});
