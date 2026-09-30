import * as alphaTab from '@coderline/alphatab';

import { ScoreDoc } from '../models/composer.model';
import { fromDynamicValue } from './alpha-tab-enum.bridge';
import { midiChannelsOf } from './midi-channels';
import { frettedDocOf } from './pitch-on-strings';

/**
 * What converting a `.gp` file into a composition would change, read from the file itself.
 *
 * Conversion is one call to `ScoreDocMapperService.toDoc` and one to `frettedDocOf` after it (the GP-composer design,
 * Part 4), so a gap in either is what the conversion prompt has to name. This walks the alphaTab `Score` once - master
 * bars, then each track's staves, bars, voices, beats and notes - and returns only what the file has, with counts and
 * the first bar, so the prompt can say "Chord diagrams: 3, first in bar 5" rather than a warning that says the same about
 * every file. A file that converts whole returns `[]`.
 *
 * Per-note dynamics are not an item, though the model marks a dynamic on the beat alone: `Beat.finish` copies the
 * beat's dynamic onto each of its notes (`alphaTab.core.mjs` ~7811), so a parsed score has none of its own to lose.
 *
 * Named for what it returns, per `CLAUDE.md`. It never calls the mapper - the mapper is what it is about - but reads the
 * same fields the mapper reads and skips. When the model grows a field, its row comes out of `ITEMS` and its spec is
 * deleted, which is the audit trail. Two rows need more than the score: the notes no string reaches, which only running
 * `frettedDocOf` on the converted document can say (`converted`), and a drum kit alphaTex cannot carry, which is asked of
 * alphaTab's own exporter and importer (`alphaTexKeeps`).
 */

/** Which heading the prompt lists an item under: what the file loses now, or what the first save of it loses. */
export type LossGroup = 'conversion' | 'first save';

export type LossId =
  | 'chordDiagrams'
  | 'tremoloBar'
  | 'wah'
  | 'lyricLines'
  | 'tempoChanges'
  | 'unnamedSlides'
  | 'directions'
  | 'syncPoints'
  | 'layout'
  | 'fades'
  | 'tremoloPicking'
  | 'ornaments'
  | 'sustainPedals'
  | 'simile'
  | 'barre'
  | 'rasgueado'
  | 'golpe'
  | 'beatOttava'
  | 'slashedBeats'
  | 'otherDynamics'
  | 'bendGraces'
  | 'harmonicPitch'
  | 'feedbackHarmonics'
  | 'bendStyle'
  | 'slurs'
  | 'hiddenNotes'
  | 'beatAutomations'
  | 'pickupBars'
  | 'barLines'
  | 'beaming'
  | 'brushSpeed'
  | 'forcedNaturals'
  | 'unreachableNotes'
  | 'credits'
  | 'midiChannels'
  | 'customStyles'
  | 'restVoices'
  | 'unsavableKit'
  | 'doubleBars';

export interface LossItem {
  id: LossId;
  group: LossGroup;
  /** What the prompt names: "Chord diagrams". */
  label: string;
  /** How many and where: "3 diagrams, first in bar 5". */
  detail: string;
  count: number;
  /** 1-based; 0 where the item is not on a bar - the stylesheet, the credits, the channels. */
  firstBar: number;
}

/** How each item is named, counted and grouped. `one` and `many` are the counted thing, singular and plural. */
const ITEMS: Readonly<Record<LossId, { label: string; one: string; many: string; group: LossGroup; note?: string }>> = {
  chordDiagrams: { label: 'Chord diagrams', one: 'diagram', many: 'diagrams', group: 'conversion' },
  tremoloBar: { label: 'Tremolo bar', one: 'beat', many: 'beats', group: 'conversion' },
  wah: { label: 'Wah', one: 'beat', many: 'beats', group: 'conversion' },
  lyricLines: { label: 'Lyric lines past the first', one: 'beat', many: 'beats', group: 'conversion' },
  tempoChanges: { label: 'Tempo changes within a bar', one: 'change', many: 'changes', group: 'conversion' },
  unnamedSlides: { label: 'Slides out downwards, pick slides and slides in from above', one: 'note', many: 'notes', group: 'conversion' },
  directions: { label: 'Directions: D.C., D.S., Coda, Fine', one: 'marking', many: 'markings', group: 'conversion' },
  syncPoints: { label: 'Backing-track sync points', one: 'sync point', many: 'sync points', group: 'conversion' },
  layout: { label: 'Page layout and stylesheet', one: 'setting', many: 'settings', group: 'conversion', note: 'the layout goes back to the default' },
  fades: { label: 'Fade-outs and volume swells', one: 'beat', many: 'beats', group: 'conversion' },
  tremoloPicking: { label: 'Tremolo picking', one: 'beat', many: 'beats', group: 'conversion' },
  ornaments: { label: 'Ornaments: turns and mordents', one: 'note', many: 'notes', group: 'conversion' },
  sustainPedals: { label: 'Sustain pedal', one: 'marking', many: 'markings', group: 'conversion' },
  simile: { label: 'Simile marks', one: 'bar', many: 'bars', group: 'conversion' },
  barre: { label: 'Barré', one: 'beat', many: 'beats', group: 'conversion' },
  rasgueado: { label: 'Rasgueado', one: 'beat', many: 'beats', group: 'conversion' },
  golpe: { label: 'Golpe', one: 'beat', many: 'beats', group: 'conversion' },
  beatOttava: { label: 'Ottava on a beat', one: 'beat', many: 'beats', group: 'conversion', note: "only a bar's clef keeps an ottava" },
  slashedBeats: { label: 'Slash beats and dead slaps', one: 'beat', many: 'beats', group: 'conversion' },
  otherDynamics: { label: 'Dynamics other than ppp to fff', one: 'beat', many: 'beats', group: 'conversion', note: 'they play forte' },
  bendGraces: { label: 'Bend grace notes', one: 'beat', many: 'beats', group: 'conversion', note: 'they become full beats' },
  harmonicPitch: { label: 'The pitch of harmonics', one: 'note', many: 'notes', group: 'conversion', note: 'they sound and engrave at the fretted pitch' },
  feedbackHarmonics: { label: 'Feedback harmonics', one: 'note', many: 'notes', group: 'conversion' },
  bendStyle: { label: 'Gradual, fast and continued bends', one: 'note', many: 'notes', group: 'conversion' },
  slurs: { label: 'Slurs', one: 'slur', many: 'slurs', group: 'conversion' },
  hiddenNotes: { label: 'Invisible and shortened notes', one: 'note', many: 'notes', group: 'conversion' },
  beatAutomations: { label: 'Instrument, volume and balance changes', one: 'change', many: 'changes', group: 'conversion' },
  pickupBars: { label: 'Pickup bars', one: 'bar', many: 'bars', group: 'conversion', note: 'each becomes a full bar' },
  barLines: { label: 'Bar line styles', one: 'bar', many: 'bars', group: 'conversion' },
  beaming: { label: 'Beaming', one: 'place', many: 'places', group: 'conversion' },
  brushSpeed: { label: 'Strum speed', one: 'beat', many: 'beats', group: 'conversion', note: 'the direction stays' },
  forcedNaturals: { label: 'Forced naturals and hidden accidentals', one: 'note', many: 'notes', group: 'conversion' },
  unreachableNotes: { label: "Notes no string reaches", one: 'note', many: 'notes', group: 'conversion', note: 'they are left out' },
  credits: { label: 'Credits: copyright, music, words, notices', one: 'field', many: 'fields', group: 'conversion' },
  midiChannels: { label: 'MIDI channels', one: 'track', many: 'tracks', group: 'conversion', note: 'each track is given its own' },
  customStyles: { label: 'Custom colours and noteheads', one: 'element', many: 'elements', group: 'conversion' },
  restVoices: { label: 'A second voice of rests alone', one: 'bar', many: 'bars', group: 'first save', note: 'saving writes only voices with notes' },
  unsavableKit: {
    label: 'Drums alphaTex cannot name',
    one: 'note',
    many: 'notes',
    group: 'first save',
    note: 'the save would not reopen, so converting refuses'
  },
  doubleBars: { label: 'Double bar lines', one: 'bar', many: 'bars', group: 'first save' }
};

/** A running count of each item, and the first bar it was met in. */
class Tally {
  private readonly counts = new Map<LossId, { count: number; firstBar: number }>();

  /** Counts `count` of `id` in the bar at `barIndex` (0-based), or on no bar at all when it is null. */
  add(id: LossId, barIndex: number | null, count = 1): void {
    if (count <= 0) return;
    const bar = barIndex === null ? 0 : barIndex + 1;
    const seen = this.counts.get(id);
    this.counts.set(id, {
      count: (seen?.count ?? 0) + count,
      firstBar: seen === undefined ? bar : Math.min(seen.firstBar, bar)
    });
  }

  items(): LossItem[] {
    return [...this.counts]
      .map(([id, { count, firstBar }]) => {
        const text = ITEMS[id];
        const counted = `${count} ${count === 1 ? text.one : text.many}`;
        const where = firstBar > 0 ? `${counted}, first in bar ${firstBar}` : counted;
        return { id, group: text.group, label: text.label, detail: text.note ? `${where}; ${text.note}` : where, count, firstBar };
      })
      .sort((a, b) => a.firstBar - b.firstBar || b.count - a.count);
  }
}

/**
 * Everything converting `score` would change, and everything its first save would, in the order the prompt lists them:
 * by first bar, then by count, most first. `converted` is the document Convert would make - `toDoc(score)` - and is read
 * for one row only, the notes `frettedDocOf` leaves out.
 */
export function conversionLossOf(score: alphaTab.model.Score, converted: ScoreDoc): LossItem[] {
  const tally = new Tally();
  scoreLossInto(tally, score);
  score.masterBars.forEach((masterBar, index) => masterBarLossInto(tally, masterBar, index));

  const channels = midiChannelsOf(score.tracks);
  score.tracks.forEach((track, index) => {
    const playback = track.playbackInfo;
    const expected = channels[index];
    if (playback.primaryChannel !== expected.primary || playback.secondaryChannel !== expected.secondary || playback.port !== 1) {
      tally.add('midiChannels', null);
    }
    if (track.style) tally.add('customStyles', null);
    if (track.systemsLayout.length > 0 || (track.lineBreaks?.size ?? 0) > 0) tally.add('layout', null);
    for (const staff of track.staves) staffLossInto(tally, staff);
  });

  const fretted = frettedDocOf(converted);
  tally.add('unreachableNotes', fretted.firstDroppedBar, fretted.dropped);
  return tally.items();
}

/** A fresh score, for what alphaTab's own defaults are. */
const DEFAULTS = new alphaTab.model.Score();

function scoreLossInto(tally: Tally, score: alphaTab.model.Score): void {
  const credits = [score.copyright, score.music, score.words, score.tab, score.notices, score.instructions, score.tempoLabel];
  tally.add('credits', null, credits.filter(field => (field ?? '') !== '').length);
  if (score.style) tally.add('customStyles', null);
  if (score.backingTrack) tally.add('syncPoints', null);

  const sheet = score.stylesheet as unknown as Record<string, unknown>;
  const defaults = DEFAULTS.stylesheet as unknown as Record<string, unknown>;
  const changed = Object.keys(defaults).filter(key => !sameSetting(sheet[key], defaults[key])).length;
  const systems = score.defaultSystemsLayout !== DEFAULTS.defaultSystemsLayout || score.systemsLayout.length > 0 ? 1 : 0;
  tally.add('layout', null, changed + systems);
}

/** Whether a stylesheet setting is its default: equal, or both empty collections. */
function sameSetting(value: unknown, fallback: unknown): boolean {
  const size = (entry: unknown): number | null => (entry instanceof Map || entry instanceof Set ? entry.size : null);
  if (size(value) !== null || size(fallback) !== null) return (size(value) ?? 0) === (size(fallback) ?? 0);
  return value === fallback;
}

function masterBarLossInto(tally: Tally, masterBar: alphaTab.model.MasterBar, index: number): void {
  tally.add('directions', index, masterBar.directions?.size ?? 0);
  tally.add('syncPoints', index, masterBar.syncPoints?.length ?? 0);
  if (masterBar.isAnacrusis) tally.add('pickupBars', index);
  if (masterBar.beamingRules) tally.add('beaming', index);
  if (masterBar.displayScale !== 1 || masterBar.displayWidth !== -1) tally.add('layout', index);
  if (masterBar.isDoubleBar) tally.add('doubleBars', index);

  // The model keeps one BPM per bar, at its start: `toDoc` reads the first automation of every bar after the first, and
  // bar 1's is the score's tempo. Every other automation goes, and so does a first one that starts mid-bar or ramps.
  const automations = masterBar.tempoAutomations;
  const [first] = automations;
  const reshaped = first !== undefined && (first.ratioPosition > 0 || first.isLinear) ? 1 : 0;
  tally.add('tempoChanges', index, Math.max(0, automations.length - 1) + reshaped);
}

function staffLossInto(tally: Tally, staff: alphaTab.model.Staff): void {
  const diagrams = staff.chords?.size ?? 0;
  if (diagrams > 0) {
    const firstUse = staff.bars.find(bar => bar.voices.some(voice => voice.beats.some(beat => beat.chordId !== null)));
    tally.add('chordDiagrams', firstUse?.index ?? null, diagrams);
  }
  for (const bar of staff.bars) barLossInto(tally, bar);
}

function barLossInto(tally: Tally, bar: alphaTab.model.Bar): void {
  const at = bar.index;
  tally.add('sustainPedals', at, bar.sustainPedals.length);
  if (bar.simileMark !== alphaTab.model.SimileMark.None) tally.add('simile', at);
  if (bar.barLineLeft !== alphaTab.model.BarLineStyle.Automatic || bar.barLineRight !== alphaTab.model.BarLineStyle.Automatic) {
    tally.add('barLines', at);
  }
  if (bar.displayScale !== 1 || bar.displayWidth !== -1) tally.add('layout', at);
  if (bar.style) tally.add('customStyles', at);

  bar.voices.forEach((voice, index) => {
    if (voice.style) tally.add('customStyles', at);
    // Kept by the conversion and dropped by the save: `toVoice` draws a rest-only voice past the first as empty, so
    // alphaTex writes none of its beats. An empty voice - a file's placeholder - has nothing to lose. Both flags are
    // `Voice.finish`'s own, which a parsed score has run.
    if (index > 0 && !voice.isEmpty && voice.isRestOnly) tally.add('restVoices', at);
    for (const beat of voice.beats) beatLossInto(tally, beat, at);
  });
}

function beatLossInto(tally: Tally, beat: alphaTab.model.Beat, at: number): void {
  const model = alphaTab.model;
  if (beat.hasWhammyBar) tally.add('tremoloBar', at);
  if (beat.wahPedal !== model.WahPedal.None) tally.add('wah', at);
  if ((beat.lyrics?.length ?? 0) > 1) tally.add('lyricLines', at);
  if (beat.fade === model.FadeType.FadeOut || beat.fade === model.FadeType.VolumeSwell) tally.add('fades', at);
  if (beat.isTremolo) tally.add('tremoloPicking', at);
  if (beat.barreShape !== model.BarreShape.None) tally.add('barre', at);
  if (beat.rasgueado !== model.Rasgueado.None) tally.add('rasgueado', at);
  if (beat.golpe !== model.GolpeType.None) tally.add('golpe', at);
  if (beat.ottava !== model.Ottavia.Regular) tally.add('beatOttava', at);
  if (beat.slashed || beat.deadSlapped) tally.add('slashedBeats', at);
  if (beat.isLegatoOrigin) tally.add('slurs', at);
  tally.add('beatAutomations', at, beat.automations.filter(automation => !keptAutomation(beat, automation)).length);
  if (beat.beamingMode !== model.BeatBeamingMode.Auto || beat.invertBeamDirection || beat.preferredBeamDirection !== null) {
    tally.add('beaming', at);
  }
  if (beat.brushType !== model.BrushType.None && beat.brushDuration !== 0) tally.add('brushSpeed', at);
  if (beat.graceType === model.GraceType.BendGrace) tally.add('bendGraces', at);
  if (!beat.isRest && fromDynamicValue(beat.dynamics) === null) tally.add('otherDynamics', at);
  if (beat.style) tally.add('customStyles', at);
  for (const note of beat.notes) noteLossInto(tally, note, at);
}

function noteLossInto(tally: Tally, note: alphaTab.model.Note, at: number): void {
  const model = alphaTab.model;
  if (note.ornament !== model.NoteOrnament.None) tally.add('ornaments', at);
  if (note.harmonicType === model.HarmonicType.Feedback) tally.add('feedbackHarmonics', at);
  else if (note.harmonicType !== model.HarmonicType.None && note.harmonicValue !== 0) tally.add('harmonicPitch', at);
  if (note.bendStyle !== model.BendStyle.Default || note.isContinuedBend) tally.add('bendStyle', at);
  if (note.isSlurDestination) tally.add('slurs', at);
  if (!note.isVisible || note.durationPercent !== 1) tally.add('hiddenNotes', at);
  if (note.accidentalMode === model.NoteAccidentalMode.ForceNatural || note.accidentalMode === model.NoteAccidentalMode.ForceNone) {
    tally.add('forcedNaturals', at);
  }
  if (unnamedSlide(note)) tally.add('unnamedSlides', at);
  if (note.style) tally.add('customStyles', at);
  if (note.isPercussion && !alphaTexKeeps(note)) tally.add('unsavableKit', at);
}

/**
 * Whether `automation`, on `beat`, survives the conversion: a tempo automation, which `tempoChanges` counts; or the
 * instrument automation `Beat.finish` puts on a track's first beat from its own program (`alphaTab.core.mjs` ~7765),
 * which `toScore`'s finish puts back, since the program is `PlaybackInfoDoc.program`. On a drum track that automation
 * carries the program from before `Track.finish` zeroed it, and channel 9 plays no program, so it is kept whatever it says.
 */
function keptAutomation(beat: alphaTab.model.Beat, automation: alphaTab.model.Automation): boolean {
  const type = alphaTab.model.AutomationType;
  if (automation.type === type.Tempo) return true;
  const staff = beat.voice.bar.staff;
  const first = beat.index === 0 && beat.voice.index === 0 && beat.voice.bar.index === 0 && staff.index === 0;
  if (!first || automation.type !== type.Instrument) return false;
  return staff.isPercussion || automation.value === staff.track.playbackInfo.program;
}

/**
 * Whether `slideOf` (`alpha-tab-enum.bridge.ts`) drops the slide: it names a shift, a legato slide, a slide out upwards
 * and a slide in from below, and reads the slide in only when there is no slide out.
 */
function unnamedSlide(note: alphaTab.model.Note): boolean {
  const out = alphaTab.model.SlideOutType;
  const into = alphaTab.model.SlideInType;
  if (note.slideOutType === out.OutDown || note.slideOutType === out.PickSlideDown || note.slideOutType === out.PickSlideUp) return true;
  if (note.slideInType === into.IntoFromAbove) return true;
  return note.slideInType !== into.None && note.slideOutType !== out.None;
}

/** What alphaTex does with a drum, by the articulation it names: kept, or not. Asked once per distinct articulation. */
const KEPT_BY_ALPHATEX = new Map<string, boolean>();

/**
 * Whether the alphaTex a save writes carries `note`'s drum back as itself.
 *
 * alphaTex names a drum from alphaTab's own table and never writes the track's kit, so the save keeps a drum only when
 * the table has one of the same `uniqueId` - `elementType.id` - and the same staff line, noteheads, symbol and MIDI key,
 * since the reload takes all of those from the table. A drum the table has no name for is written `"unknown"`, and the
 * reload throws (design Part 3). alphaTab's table is internal to it, so rather than copy the table this asks alphaTab: a
 * one-note score of that drum is written and read back, and the drum it reads compared with the one it wrote.
 */
function alphaTexKeeps(note: alphaTab.model.Note): boolean {
  const kit = note.beat.voice.bar.staff.track.percussionArticulations;
  const own = note.percussionArticulation < kit.length ? kit[note.percussionArticulation] : null;
  const key = own ? articulationKeyOf(own) : `id:${note.percussionArticulation}`;
  let kept = KEPT_BY_ALPHATEX.get(key);
  if (kept === undefined) {
    kept = roundTripKeeps(own, note.percussionArticulation);
    KEPT_BY_ALPHATEX.set(key, kept);
  }
  return kept;
}

function articulationKeyOf(articulation: alphaTab.model.InstrumentArticulation): string {
  return [
    articulation.elementType,
    articulation.id,
    articulation.staffLine,
    articulation.noteHeadDefault,
    articulation.noteHeadHalf,
    articulation.noteHeadWhole,
    articulation.techniqueSymbol,
    articulation.techniqueSymbolPlacement,
    articulation.outputMidiNumber
  ].join('|');
}

/** Writes one drum - `own`, a track's articulation, or the id `id` in alphaTab's table - as alphaTex, reads it back, and compares. */
function roundTripKeeps(own: alphaTab.model.InstrumentArticulation | null, id: number): boolean {
  const settings = new alphaTab.Settings();
  const score = new alphaTab.model.Score();
  score.addMasterBar(new alphaTab.model.MasterBar());
  const track = new alphaTab.model.Track();
  const staff = new alphaTab.model.Staff();
  staff.isPercussion = true;
  track.addStaff(staff);
  score.addTrack(track);
  if (own) track.percussionArticulations.push(own);
  const bar = new alphaTab.model.Bar();
  staff.addBar(bar);
  const voice = new alphaTab.model.Voice();
  bar.addVoice(voice);
  const beat = new alphaTab.model.Beat();
  voice.addBeat(beat);
  const drum = new alphaTab.model.Note();
  drum.percussionArticulation = own ? 0 : id;
  beat.addNote(drum);
  score.finish(settings);

  const tex = new alphaTab.exporter.AlphaTexExporter().exportToString(score, settings);
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.logErrors = false;
  try {
    importer.initFromString(tex, settings);
    const read = importer.readScore();
    const readTrack = read.tracks[0];
    const readNote = readTrack?.staves[0]?.bars[0]?.voices[0]?.beats[0]?.notes[0];
    if (!readTrack || !readNote) return false;
    const readOwn = readNote.percussionArticulation < readTrack.percussionArticulations.length ? readTrack.percussionArticulations[readNote.percussionArticulation] : null;
    if (!own) return readOwn !== null && readOwn.id === id;
    return readOwn !== null && articulationKeyOf(readOwn) === articulationKeyOf(own);
  } catch {
    return false;
  }
}
