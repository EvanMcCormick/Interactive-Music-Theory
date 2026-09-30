import * as alphaTab from '@coderline/alphatab';

import { ScoreDoc } from '../models/composer.model';
import { fromDynamicValue } from './alpha-tab-enum.bridge';
import { PERCUSSION_CHANNEL, midiChannelsOf } from './midi-channels';
import { naturalHarmonicValueOf } from './natural-harmonics';
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
 * same fields the mapper reads and skips, and borrows the one rule the mapper derives a field by (a natural harmonic's
 * value, `naturalHarmonicValueOf`). When the model grows a field, its row comes out of `ITEMS` and its spec is deleted,
 * which is the audit trail. Three rows need more than the score: the notes no string reaches, which only running
 * `frettedDocOf` on the converted document can say (`converted`); the header and footer, drawn from the credits that
 * document keeps; and a drum kit alphaTex cannot carry, which is asked of alphaTab's own exporter and importer
 * (`alphaTexKeeps`).
 *
 * A row counts what is seen or heard, not what a field holds. alphaTab's real importers - `Gp3To5Importer` for GP3-5 and
 * `GpifParser` for GP6-8 - fill fields a file never chose: the initial tempo twice, a five-line lyrics array per beat, a
 * stylesheet object for a header they read, a per-track display flag for every track, the right bar line of a double
 * bar. Each row below says which habit it looks past and where the importer has it, so that "a file that converts whole
 * returns `[]`" holds for the files people open, not only for the alphaTex the specs start from.
 */

/** Which heading the prompt lists an item under: what the file loses now, or what the first save of it loses. */
export type LossGroup = 'conversion' | 'first save';

export type LossId =
  | 'chordDiagrams'
  | 'tremoloBar'
  | 'wah'
  | 'lyricLines'
  | 'tempoChanges'
  | 'tempoText'
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
  | 'doubleBars'
  | 'unmeasured';

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
  tempoText: { label: "Tempo markings' words", one: 'marking', many: 'markings', group: 'conversion', note: 'the BPM stays' },
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
  harmonicPitch: { label: 'The pitch of harmonics', one: 'note', many: 'notes', group: 'conversion', note: 'they sound and engrave at the pitch their fret gives' },
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
  midiChannels: {
    label: 'Tracks the file plays on the drum channel',
    one: 'track',
    many: 'tracks',
    group: 'conversion',
    note: 'they play as drums now, and as their own instrument after'
  },
  customStyles: { label: 'Custom colours and noteheads', one: 'element', many: 'elements', group: 'conversion' },
  restVoices: {
    label: 'A second voice of rests alone',
    one: 'bar',
    many: 'bars',
    // A conversion item: the rests go from the page as soon as it converts (`toVoice` marks them empty), before any
    // save - which then drops them too, since alphaTex writes only voices with notes.
    group: 'conversion',
    note: 'its rests are not drawn after conversion, nor saved'
  },
  unsavableKit: {
    label: 'Drums alphaTex cannot name',
    one: 'note',
    many: 'notes',
    group: 'first save',
    note: 'the save would not reopen, so converting refuses'
  },
  doubleBars: { label: 'Double bar lines', one: 'bar', many: 'bars', group: 'first save' },
  // Not a row the walk counts: `ComposerGpService.open` says it when the measuring itself threw, so a file alphaTab can
  // draw still opens, and the prompt says it does not know what converting would lose rather than that it would lose
  // nothing (`unmeasuredLoss`).
  unmeasured: {
    label: 'What converting would lose could not be measured',
    one: 'file',
    many: 'files',
    group: 'conversion',
    note: 'anything in the file may change; save the original first to keep it'
  }
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
 * What the prompt lists in place of `conversionLossOf` when measuring threw: one item, saying the loss is not known. Its
 * detail is the note alone - a count of one file, first in no bar, would say nothing the label does not.
 */
export function unmeasuredLoss(): LossItem[] {
  const text = ITEMS.unmeasured;
  return [{ id: 'unmeasured', group: text.group, label: text.label, detail: text.note ?? '', count: 1, firstBar: 0 }];
}

/**
 * Everything converting `score` would change, and everything its first save would, in the order the prompt lists them:
 * by first bar, then by count, most first. `converted` is the document Convert would make - `toDoc(score)` - and is read
 * for one row only, the notes `frettedDocOf` leaves out.
 */
export function conversionLossOf(score: alphaTab.model.Score, converted: ScoreDoc): LossItem[] {
  const tally = new Tally();
  scoreLossInto(tally, score, converted);
  score.masterBars.forEach((masterBar, index) => masterBarLossInto(tally, masterBar, index));

  // Only what is heard. A channel number is heard only as "drums or not": each track has its own channels before and
  // after (`consolidate` makes them unique on read, `midiChannelsOf` on conversion), and channel 9 plays a kit whatever
  // program the track names. So the one audible change is a track that is not a one-staff kit but that the file put on
  // channel 9, primary or secondary: alphaTab's `consolidate` leaves such a track there (`alphaTab.core.mjs` ~4324-4332,
  // it only steps a channel that is not 9), where it plays as drums, and conversion gives it a pitched channel. The
  // secondary channel is heard too - `MidiFileGenerator` plays a bent note on it (~48177, ~48263). `port` is not
  // compared: nothing but the importers, JSON serialisation and the GP7 exporter reads it (~19931, ~22563, ~38245,
  // ~78263), so it is neither seen nor heard.
  const channels = midiChannelsOf(score.tracks);
  score.tracks.forEach((track, index) => {
    const playback = track.playbackInfo;
    const drumsNow = playback.primaryChannel === PERCUSSION_CHANNEL || playback.secondaryChannel === PERCUSSION_CHANNEL;
    if (drumsNow && channels[index].primary !== PERCUSSION_CHANNEL) tally.add('midiChannels', null);
    if (styled(track.style)) tally.add('customStyles', null);
    // Line breaks are read by every page layout (`VerticalLayoutBase._needsLineBreak`, ~67261), whatever the settings.
    // A track's `systemsLayout` and `defaultSystemsLayout` are not: see `scoreLossInto`.
    if ((track.lineBreaks?.size ?? 0) > 0) tally.add('layout', null);
    for (const staff of track.staves) staffLossInto(tally, staff);
  });

  const fretted = frettedDocOf(converted);
  tally.add('unreachableNotes', fretted.firstDroppedBar, fretted.dropped);
  return tally.items();
}

/** A fresh score, for what alphaTab's own defaults are. */
const DEFAULTS = new alphaTab.model.Score();

/**
 * Whether an element's style changes anything drawn: a colour, or on a note a notehead of its own.
 *
 * Every style class is `ElementStyle`'s `colors` map and nothing else (`alphaTab.core.mjs` ~1771, and `BarStyle`,
 * `VoiceStyle`, `BeatStyle`, `TrackStyle`, `ScoreStyle` extend it bare, ~2025-12827) - except `NoteStyle`, which adds
 * `noteHead` and `noteHeadCenterOnStem` (~5599), and `ScoreStyle`, which adds the header and footer (~3549), read
 * under `layout` by `headerFooterChangesOf`. The object's presence is not a customisation: `getOrCreateHeaderFooterStyle`
 * creates `score.style` whenever an importer reads a header (~4271; GP5's `readPageSetup` ~19714-19748, the GPIF
 * stylesheet ~21179-21280), with no colour in it.
 */
function styled(style: alphaTab.model.ElementStyle<number> | null | undefined): boolean {
  if (!style) return false;
  if (style.colors.size > 0) return true;
  return style instanceof alphaTab.model.NoteStyle && (style.noteHead !== undefined || style.noteHeadCenterOnStem !== undefined);
}

function scoreLossInto(tally: Tally, score: alphaTab.model.Score, converted: ScoreDoc): void {
  // Not `tempoLabel`: that is bar 1's tempo automation's text, and `masterBarLossInto` counts every tempo's words.
  const credits = [score.copyright, score.music, score.words, score.tab, score.notices, score.instructions];
  tally.add('credits', null, credits.filter(field => (field ?? '') !== '').length);
  if (styled(score.style)) tally.add('customStyles', null);
  if (score.backingTrack) tally.add('syncPoints', null);

  // Not compared: the systems layout - `defaultSystemsLayout` and `systemsLayout`, on the score and on each track - and
  // each bar's and master bar's `displayScale` and `displayWidth`. alphaTab reads the systems layout only in
  // `ModelUtils.getSystemLayout` (~4675), which only the Parchment layout calls, or the Page layout when
  // `display.systemsLayoutMode` is `UseModelLayout` (~67289, ~67309). It reads a bar's scale only through
  // `StaffSystem.getBarDisplayScale` (~65774), in `_scaleToWidth` under `shouldApplyBarScale` (~67173-67192) - true for
  // Parchment, and for Page only under `UseModelLayout` (~67294, ~67311) - and a bar's width only in
  // `HorizontalScreenLayout._scaleBars` (~66844-66848). Every caller of `AlphaTabService.initializeApi` asks for the Page
  // layout, and none sets `systemsLayoutMode`, so none of these is drawn before conversion or after. GP6-8 files carry a
  // systems layout (`GpifParser` ~21767, ~22053) and can carry bar scales (~23299, ~23315), so counting them reported
  // files that convert whole.
  tally.add('layout', null, stylesheetChangesOf(score) + headerFooterChangesOf(score, converted));
}

/**
 * The stylesheet settings about chord diagrams, left out of `layout`: the model has no chords, so a converted score has
 * no diagram for them to place, and the `chordDiagrams` row already names the diagrams themselves. The in-score setting
 * draws a beat's chord (~58493), the other two the list above the score (~66544-66547).
 */
const CHORD_DIAGRAM_SETTINGS = new Set<string>(['globalDisplayChordDiagramsOnTop', 'perTrackChordDiagramsOnTop', 'globalDisplayChordDiagramsInScore']);

/**
 * How many of a score's stylesheet settings draw something other than alphaTab's defaults.
 *
 * `perTrackDisplayTuning` maps a track index to a flag that narrows `globalDisplayTuning`, and GP5 writes one entry for
 * every track (~19911-19914). The tuning is drawn for a track when the global is on, the track's entry is not `false`,
 * and one of its staves draws a tuning at all - not percussion, stringed, tuned, showing tablature
 * (`ScoreLayout._createScoreInfoGlyphs` ~66505-66513). So an entry is a change only when it hides a tuning that would be
 * drawn: an entry equal to the global, one under a global that is off (the global's own row), or one on a track with no
 * tuning to draw changes nothing. `perTrackMultiBarRest` is a set of the tracks that draw multi-bar rests on their own
 * (~4168-4169); every entry in it is a change from the default of none.
 */
function stylesheetChangesOf(score: alphaTab.model.Score): number {
  const sheet = score.stylesheet;
  const perTrack = new Set<string>(['perTrackDisplayTuning', 'perTrackMultiBarRest', ...CHORD_DIAGRAM_SETTINGS]);
  const own = sheet as unknown as Record<string, unknown>;
  const defaults = DEFAULTS.stylesheet as unknown as Record<string, unknown>;
  const changed = Object.keys(defaults).filter(key => !perTrack.has(key) && own[key] !== defaults[key]).length;

  const drawsTuning = (index: number): boolean =>
    score.tracks[index]?.staves.some(staff => !staff.isPercussion && staff.isStringed && staff.tuning.length > 0 && staff.showTablature) ?? false;
  const hiddenTunings = sheet.globalDisplayTuning
    ? [...(sheet.perTrackDisplayTuning ?? new Map<number, boolean>())].filter(([index, shown]) => !shown && drawsTuning(index)).length
    : 0;
  return changed + hiddenTunings + (sheet.perTrackMultiBarRest?.size ?? 0);
}

/**
 * How many header and footer lines the file draws differently from alphaTab's defaults, on what conversion keeps.
 *
 * A converted score has no `score.style`, so alphaTab draws each line from `ScoreStyle.defaultHeaderAndFooter`. The
 * file's own entries are compared with those line by line, as `ScoreLayout._createHeaderFooterGlyph` draws them
 * (`alphaTab.core.mjs` ~66438-66475): hidden, or the template's text with its placeholders filled, and the alignment of
 * a line that draws. The placeholders are filled from the converted document, not the file: the credits it drops
 * (copyright, words, music, tabber) are the `credits` row's, and a template about them draws nothing after conversion
 * whatever it says. Without that, GP5's own defaults - "Copyright %COPYRIGHT%", "Words & Music by %WORDSMUSIC%", which
 * `readPageSetup` reads into every file (~19714-19748) - would have reported every GP5 file.
 */
function headerFooterChangesOf(score: alphaTab.model.Score, converted: ScoreDoc): number {
  const own = score.style?.headerAndFooter;
  if (!own || own.size === 0) return 0;
  const kept = new alphaTab.model.Score();
  kept.title = converted.title;
  kept.subTitle = converted.subTitle;
  kept.artist = converted.artist;
  kept.album = converted.album;

  const defaults = alphaTab.model.ScoreStyle.defaultHeaderAndFooter;
  let changed = 0;
  for (const element of own.keys()) {
    const text = headerLineOf(own, element, kept);
    const alignment = own.get(element)?.textAlign !== defaults.get(element)?.textAlign;
    if (text !== headerLineOf(defaults, element, kept) || (text !== '' && alignment)) changed++;
  }
  return changed;
}

/** The text a header or footer line draws from `styles`, as the renderer picks it: the entry, else the default. */
function headerLineOf(
  styles: ReadonlyMap<alphaTab.model.ScoreSubElement, alphaTab.model.HeaderFooterStyle>,
  element: alphaTab.model.ScoreSubElement,
  score: alphaTab.model.Score
): string {
  const style = styles.get(element) ?? alphaTab.model.ScoreStyle.defaultHeaderAndFooter.get(element);
  if (!style) return '';
  // A style's hide flag is honoured only for the lines that have no notation element of their own - the tabber and the
  // second copyright line. The other eight (`ScoreLayout.headerElements`, `footerElements` ~66424-66437) are shown or
  // hidden by `settings.notation.isNotationElementVisible`, which replaces the flag outright (~66465-66468) and is on for
  // all of them unless the app says otherwise (`NotationSettings.defaultElements` ~1449-1451); the app sets no notation
  // elements. So a file that hides its title still draws it, before conversion and after. `isVisible` left undefined
  // means shown.
  const { Transcriber, Words, Music, WordsAndMusic, Copyright, CopyrightSecondLine } = alphaTab.model.ScoreSubElement;
  const flagged = element === Transcriber || element === CopyrightSecondLine;
  if (flagged && style.isVisible === false) return '';
  // The renderer's special cases (~66440-66458): words and music on one line when they are the same person, on two when
  // not; and the second copyright line only under a first.
  const samePerson = score.words === score.music;
  if (((element === Words || element === Music) && samePerson) || (element === WordsAndMusic && !samePerson)) return '';
  if (element === CopyrightSecondLine && headerLineOf(styles, Copyright, score) === '') return '';
  return style.buildText(score);
}

function masterBarLossInto(tally: Tally, masterBar: alphaTab.model.MasterBar, index: number): void {
  tally.add('directions', index, masterBar.directions?.size ?? 0);
  tally.add('syncPoints', index, masterBar.syncPoints?.length ?? 0);
  if (masterBar.isAnacrusis) tally.add('pickupBars', index);
  if (masterBar.beamingRules) tally.add('beaming', index);
  if (masterBar.isDoubleBar) tally.add('doubleBars', index);

  // The model keeps one BPM per bar, at its start: `toDoc` reads the first automation of every bar after the first, and
  // bar 1's is the score's tempo. Every other automation goes, and so does a first one that starts mid-bar.
  //
  // Two automations at one place with one value are one tempo, and are counted once: GP3-5 puts the file's initial
  // tempo on bar 1 as it reads the bar (`Gp3To5Importer.readMasterBar` ~19778-19779) and again once the score is read
  // (`readScore` ~19628-19633). `isLinear` is not a reshaping: GP5 sets it on every mix-table tempo change (~20551), and
  // nothing reads it but JSON serialisation and the GP7 exporter (~36994, ~78107) - alphaTab plays it as a step.
  //
  // A tempo marking's words are drawn before its BPM (`BarTempoGlyph` ~64126-64131, visible automations only, ~64169),
  // and the model has no words for a tempo - `toMasterBar` rebuilds each automation without them - so each visible one
  // with words is `tempoText`'s: the BPM stays, which is why it is not a tempo change.
  const automations = masterBar.tempoAutomations;
  const sameTempo = (a: alphaTab.model.Automation, b: alphaTab.model.Automation): boolean =>
    a.ratioPosition === b.ratioPosition && a.value === b.value;
  const distinct = automations.filter((automation, at) => automations.findIndex(other => sameTempo(automation, other)) === at);
  const [first] = distinct;
  const reshaped = first !== undefined && first.ratioPosition > 0 ? 1 : 0;
  const worded = distinct.filter(tempo =>
    automations.some(automation => sameTempo(tempo, automation) && automation.isVisible && (automation.text ?? '') !== '')
  ).length;
  tally.add('tempoChanges', index, Math.max(0, distinct.length - 1) + reshaped);
  tally.add('tempoText', index, worded);
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
  // Both importers set a double bar's right bar line to `LightLight` explicitly (`Gp3To5Importer.readBar` ~20039-20040,
  // `GpifParser` ~24003-24004). The mapper keeps `isDoubleBar` and leaves the bar line `Automatic`, which
  // `Bar._automaticToActualType` (~2218-2234) draws as `LightLight` only for a double bar that is not a repeat end, not
  // the last bar and not in free time - each of those it draws as its own line first. There, and only there, the
  // explicit `LightLight` is drawn the same after conversion.
  const style = alphaTab.model.BarLineStyle;
  const master = bar.masterBar;
  const automaticDouble = master.isDoubleBar && !master.isRepeatEnd && master.nextMasterBar !== null && !master.isFreeTime;
  const doubleBarLine = automaticDouble && bar.barLineRight === style.LightLight;
  if (bar.barLineLeft !== style.Automatic || (bar.barLineRight !== style.Automatic && !doubleBarLine)) tally.add('barLines', at);
  if (styled(bar.style)) tally.add('customStyles', at);

  bar.voices.forEach((voice, index) => {
    if (styled(voice.style)) tally.add('customStyles', at);
    // Changed by the conversion and dropped by the save: `toVoice` marks a rest-only voice past the first empty, so its
    // rests are not drawn, and alphaTex writes none of its beats. An empty voice - a file's placeholder - has nothing to
    // lose. Both flags are `Voice.finish`'s own, which a parsed score has run.
    if (index > 0 && !voice.isEmpty && voice.isRestOnly) tally.add('restVoices', at);
    for (const beat of voice.beats) beatLossInto(tally, beat, at);
  });
}

function beatLossInto(tally: Tally, beat: alphaTab.model.Beat, at: number): void {
  const model = alphaTab.model;
  if (beat.hasWhammyBar) tally.add('tremoloBar', at);
  if (beat.wahPedal !== model.WahPedal.None) tally.add('wah', at);
  // The model keeps line 1. GP files size every lyric beat's array to the file's line count - five in GP3-5 - and fill
  // it with '' (`Track.applyLyrics` ~12957-12959), so only a later line with text is lost.
  if (beat.lyrics?.slice(1).some(line => (line ?? '') !== '')) tally.add('lyricLines', at);
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
  if (styled(beat.style)) tally.add('customStyles', at);
  for (const note of beat.notes) noteLossInto(tally, note, at);
}

function noteLossInto(tally: Tally, note: alphaTab.model.Note, at: number): void {
  const model = alphaTab.model;
  if (note.ornament !== model.NoteOrnament.None) tally.add('ornaments', at);
  if (note.harmonicType === model.HarmonicType.Feedback) tally.add('feedbackHarmonics', at);
  else if (harmonicPitchChanges(note)) tally.add('harmonicPitch', at);
  // Not `isContinuedBend`: `Note.finish` sets it from the tie and the bend (~6331-6332), both of which the mapper keeps.
  if (note.bendStyle !== model.BendStyle.Default) tally.add('bendStyle', at);
  if (note.isSlurDestination) tally.add('slurs', at);
  if (!note.isVisible || note.durationPercent !== 1) tally.add('hiddenNotes', at);
  if (note.accidentalMode === model.NoteAccidentalMode.ForceNatural || note.accidentalMode === model.NoteAccidentalMode.ForceNone) {
    tally.add('forcedNaturals', at);
  }
  if (unnamedSlide(note)) tally.add('unnamedSlides', at);
  if (styled(note.style)) tally.add('customStyles', at);
  if (note.isPercussion && !alphaTexKeeps(note)) tally.add('unsavableKit', at);
}

/**
 * Whether conversion changes the pitch `note`'s harmonic sounds at, or the number its tab draws.
 *
 * alphaTab adds `harmonicPitch` to a stringed note's pitch, or for a natural harmonic sounds `harmonicPitch` above the
 * open string (`Note.calculateRealValue` ~6056-6063), and `harmonicPitch` is read from `harmonicValue` alone (~6078).
 * The model keeps the harmonic's type and not its value, so what conversion gives the note is what the mapper derives:
 * a natural harmonic the value of its fret, as alphaTex's `nh` does (`naturalHarmonicValueOf`), and any other harmonic
 * none - no pitch of its own. For the other harmonics the pitch is compared, not the value: an artificial one with a
 * value that adds nothing converts whole. A natural harmonic's value is also drawn - the tab writes `<value>` in place
 * of the fret (`NoteNumberGlyph.doLayout` ~74040-74056) - so its value is compared too: `<11.5>` becomes `<12>`, though
 * both sound the octave. A GP5 natural harmonic, valued from its fret by the importer (~20789), converts whole. A
 * pitched note has no `harmonicPitch` (it needs a string), so it has nothing to change.
 */
function harmonicPitchChanges(note: alphaTab.model.Note): boolean {
  if (note.harmonicType === alphaTab.model.HarmonicType.None || !note.isStringed) return false;
  if (note.harmonicType !== alphaTab.model.HarmonicType.Natural) return note.harmonicPitch !== 0;
  // The value decides the pitch, so comparing the value covers both.
  return note.harmonicValue !== naturalHarmonicValueOf(note.fret);
}

/**
 * Whether `automation`, on `beat`, survives the conversion: a tempo automation, which `tempoChanges` counts; or one on a
 * track's first beat that says what the track already says.
 *
 * `Beat.finish` puts an instrument automation on a track's first beat from its own program (`alphaTab.core.mjs` ~7765),
 * which `toScore`'s finish puts back, since the program is `PlaybackInfoDoc.program`. On a drum track that automation
 * carries the program from before `Track.finish` zeroed it, and channel 9 plays no program, so it is kept whatever it
 * says. A GP5 mix table on bar 1 puts a volume and a balance there too (`Gp3To5Importer.readMixTableChange`
 * ~20525-20540), usually the track's own; one that equals `PlaybackInfoDoc.volume`, `balance` or `bank` changes nothing
 * the converted track does not start with. (alphaTab 1.8 gives `AutomationType.Bank` the value of `SyncPoint`, 4 -
 * harmless here, since sync points live on the master bar, not a beat.)
 */
function keptAutomation(beat: alphaTab.model.Beat, automation: alphaTab.model.Automation): boolean {
  const type = alphaTab.model.AutomationType;
  if (automation.type === type.Tempo) return true;
  const staff = beat.voice.bar.staff;
  const first = beat.index === 0 && beat.voice.index === 0 && beat.voice.bar.index === 0 && staff.index === 0;
  if (!first) return false;
  const playback = staff.track.playbackInfo;
  switch (automation.type) {
    case type.Instrument:
      return staff.isPercussion || automation.value === playback.program;
    case type.Volume:
      return automation.value === playback.volume;
    case type.Balance:
      return automation.value === playback.balance;
    case type.Bank:
      return automation.value === playback.bank;
    default:
      return false;
  }
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

/**
 * What a drum is, as far as drawing and playing it go. A technique symbol's placement is left out when there is no
 * symbol to place: the renderer reads the placement only to put the symbol somewhere (`alphaTab.core.mjs` ~70334-70336,
 * ~72095-72125, where `None` draws nothing), so a kick whose file places its missing symbol other than the table does is
 * not a different drum.
 */
function articulationKeyOf(articulation: alphaTab.model.InstrumentArticulation): string {
  const symbol = articulation.techniqueSymbol;
  return [
    articulation.elementType,
    articulation.id,
    articulation.staffLine,
    articulation.noteHeadDefault,
    articulation.noteHeadHalf,
    articulation.noteHeadWhole,
    symbol,
    symbol === alphaTab.model.MusicFontSymbol.None ? '' : articulation.techniqueSymbolPlacement,
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

  // All of it in the `try`: an articulation alphaTab cannot finish or write is one alphaTex cannot keep, and it must
  // not throw out of `conversionLossOf` - the prompt would have nothing to show.
  try {
    score.finish(settings);
    const tex = new alphaTab.exporter.AlphaTexExporter().exportToString(score, settings);
    const importer = new alphaTab.importer.AlphaTexImporter();
    importer.logErrors = false;
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
