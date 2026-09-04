import { Injectable } from '@angular/core';
import * as alphaTab from '@coderline/alphatab';
import {
  BarDoc,
  BeatDoc,
  ClefKind,
  DurationValue,
  DynamicValue,
  KeySignature,
  MasterBarDoc,
  NoteDoc,
  NotePitch,
  OttaviaKind,
  ScoreDoc,
  StaffDoc,
  TrackDoc,
  TripletFeelKind,
  VoiceDoc,
  createDefaultBeatEffects,
  createDefaultNoteEffects
} from '../models/composer.model';

/**
 * Converts between our editable ScoreDoc and alphaTab's runtime Score.
 *
 * ScoreDoc -> Score feeds `api.renderScore()` for engraving and playback, and
 * alphaTab's own AlphaTexExporter for the tex escape hatch and persistence.
 * Score -> ScoreDoc brings edited tex back in.
 *
 * OCTAVE CONVENTION: alphaTab stores octaves one higher than scientific pitch
 * notation. alphaTex `C4` (middle C, MIDI 60) is stored as octave 5, tone 0,
 * because realValue = octave * 12 + tone. ScoreDoc uses scientific notation, so
 * every conversion crosses this +1/-1 boundary. Verified in the spec.
 */
@Injectable({ providedIn: 'root' })
export class ScoreDocMapperService {
  /** alphaTab octave = scientific octave + 1. */
  private static readonly OCTAVE_OFFSET = 1;

  // -------------------------------------------------------------------------
  // ScoreDoc -> alphaTab Score
  // -------------------------------------------------------------------------

  toScore(doc: ScoreDoc, settings: alphaTab.Settings): alphaTab.model.Score {
    const score = new alphaTab.model.Score();
    score.title = doc.title;
    score.subTitle = doc.subTitle;
    score.artist = doc.artist;
    score.album = doc.album;

    // Score.tempo is a read-only getter derived from the first master bar's
    // tempo automation, so the initial tempo has to be written there.
    doc.masterBars.forEach((masterBarDoc, index) => {
      const initialTempo = index === 0 ? doc.tempo : null;
      score.addMasterBar(this.toMasterBar(masterBarDoc, score, initialTempo));
    });

    for (const trackDoc of doc.tracks) {
      score.addTrack(this.toTrack(trackDoc));
    }

    score.finish(settings);
    return score;
  }

  private toMasterBar(
    doc: MasterBarDoc,
    score: alphaTab.model.Score,
    initialTempo: number | null
  ): alphaTab.model.MasterBar {
    const masterBar = new alphaTab.model.MasterBar();

    // A null time signature inherits from the previous bar. alphaTab has no
    // inherit concept, so resolve it here against the bars already added.
    const resolved = doc.timeSignature ?? this.previousTimeSignature(score);
    masterBar.timeSignatureNumerator = resolved.numerator;
    masterBar.timeSignatureDenominator = resolved.denominator;
    masterBar.timeSignatureCommon = resolved.isCommon;

    masterBar.isRepeatStart = doc.isRepeatStart;
    masterBar.repeatCount = doc.repeatCount;
    masterBar.alternateEndings = doc.alternateEndings;
    masterBar.tripletFeel = this.toTripletFeel(doc.tripletFeel);
    masterBar.isFreeTime = doc.isFreeTime;

    if (doc.section) {
      const section = new alphaTab.model.Section();
      section.marker = doc.section.marker;
      section.text = doc.section.text;
      masterBar.section = section;
    }

    const tempo = doc.tempoAutomation ?? initialTempo;
    if (tempo !== null) {
      masterBar.tempoAutomations.push(
        alphaTab.model.Automation.buildTempoAutomation(false, 0, tempo, 60)
      );
    }

    return masterBar;
  }

  private previousTimeSignature(score: alphaTab.model.Score): {
    numerator: number;
    denominator: number;
    isCommon: boolean;
  } {
    const last = score.masterBars.length > 0
      ? score.masterBars[score.masterBars.length - 1]
      : null;
    return last
      ? {
          numerator: last.timeSignatureNumerator,
          denominator: last.timeSignatureDenominator,
          isCommon: last.timeSignatureCommon
        }
      : { numerator: 4, denominator: 4, isCommon: true };
  }

  private toTrack(doc: TrackDoc): alphaTab.model.Track {
    const track = new alphaTab.model.Track();
    track.name = doc.name;
    track.shortName = doc.shortName;
    track.color = alphaTab.model.Color.fromJson(doc.color) ?? track.color;

    track.playbackInfo.program = doc.playback.program;
    track.playbackInfo.bank = doc.playback.bank;
    track.playbackInfo.volume = doc.playback.volume;
    track.playbackInfo.balance = doc.playback.balance;
    track.playbackInfo.isMute = doc.playback.isMute;
    track.playbackInfo.isSolo = doc.playback.isSolo;

    for (const staffDoc of doc.staves) {
      track.addStaff(this.toStaff(staffDoc));
    }
    return track;
  }

  private toStaff(doc: StaffDoc): alphaTab.model.Staff {
    const staff = new alphaTab.model.Staff();
    staff.capo = doc.capo;
    staff.transpositionPitch = doc.transpose;
    staff.displayTranspositionPitch = doc.displayTranspose;
    staff.showStandardNotation = doc.showStandardNotation;
    staff.showTablature = doc.showTablature;
    staff.showSlash = doc.showSlash;
    staff.showNumbered = doc.showNumbered;

    if (doc.tuning.length > 0) {
      staff.stringTuning = new alphaTab.model.Tuning(
        doc.tuningLabel,
        doc.tuning.slice(),
        false
      );
    }

    for (const barDoc of doc.bars) {
      staff.addBar(this.toBar(barDoc));
    }
    return staff;
  }

  private toBar(doc: BarDoc): alphaTab.model.Bar {
    const bar = new alphaTab.model.Bar();
    bar.clef = this.toClef(doc.clef);
    bar.clefOttava = this.toOttavia(doc.clefOttava);
    bar.keySignature = doc.keySignature.fifths as alphaTab.model.KeySignature;
    bar.keySignatureType =
      doc.keySignature.mode === 'minor'
        ? alphaTab.model.KeySignatureType.Minor
        : alphaTab.model.KeySignatureType.Major;

    for (const voiceDoc of doc.voices) {
      bar.addVoice(this.toVoice(voiceDoc));
    }
    return bar;
  }

  private toVoice(doc: VoiceDoc): alphaTab.model.Voice {
    const voice = new alphaTab.model.Voice();
    for (const beatDoc of doc.beats) {
      voice.addBeat(this.toBeat(beatDoc));
    }
    return voice;
  }

  private toBeat(doc: BeatDoc): alphaTab.model.Beat {
    const beat = new alphaTab.model.Beat();
    beat.duration = doc.duration as unknown as alphaTab.model.Duration;
    beat.dots = doc.dots;

    if (doc.tuplet) {
      beat.tupletNumerator = doc.tuplet.numerator;
      beat.tupletDenominator = doc.tuplet.denominator;
    }

    if (doc.dynamics !== null) {
      beat.dynamics = this.toDynamicValue(doc.dynamics);
    }
    if (doc.lyrics !== null) {
      beat.lyrics = [doc.lyrics];
    }
    if (doc.text !== null) {
      beat.text = doc.text;
    }

    beat.isLetRing = doc.effects.isLetRing;
    beat.isPalmMute = doc.effects.isPalmMute;
    beat.slap = doc.effects.slap;
    beat.pop = doc.effects.pop;
    beat.tap = doc.effects.tap;
    beat.vibrato = doc.effects.vibrato
      ? alphaTab.model.VibratoType.Slight
      : alphaTab.model.VibratoType.None;
    beat.brushType = this.toBrushType(doc.effects.brush);
    beat.graceType = this.toGraceType(doc.effects.grace);

    // An empty note list is how alphaTab represents a rest.
    if (!doc.isRest) {
      for (const noteDoc of doc.notes) {
        beat.addNote(this.toNote(noteDoc));
      }
    }
    return beat;
  }

  private toNote(doc: NoteDoc): alphaTab.model.Note {
    const note = new alphaTab.model.Note();

    if (doc.pitch.kind === 'fretted') {
      note.string = doc.pitch.string;
      note.fret = doc.pitch.fret;
    } else {
      note.octave = doc.pitch.octave + ScoreDocMapperService.OCTAVE_OFFSET;
      note.tone = doc.pitch.noteValue;
    }

    note.isTieDestination = doc.isTied;
    note.accidentalMode =
      doc.accidental === 'explicit'
        ? alphaTab.model.NoteAccidentalMode.ForceSharp
        : alphaTab.model.NoteAccidentalMode.Default;

    note.isGhost = doc.effects.isGhost;
    note.isDead = doc.effects.isDead;
    note.isLetRing = doc.effects.isLetRing;
    note.isPalmMute = doc.effects.isPalmMute;
    note.isStaccato = doc.effects.isStaccato;
    note.vibrato = doc.effects.vibrato
      ? alphaTab.model.VibratoType.Slight
      : alphaTab.model.VibratoType.None;
    note.harmonicType = this.toHarmonicType(doc.effects.harmonic);
    this.applySlide(note, doc.effects.slide);

    return note;
  }

  // -------------------------------------------------------------------------
  // alphaTab Score -> ScoreDoc
  // -------------------------------------------------------------------------

  toDoc(score: alphaTab.model.Score): ScoreDoc {
    return {
      title: score.title ?? '',
      subTitle: score.subTitle ?? '',
      artist: score.artist ?? '',
      album: score.album ?? '',
      tempo: score.tempo,
      masterBars: score.masterBars.map((mb, i) => this.fromMasterBar(mb, i, score)),
      tracks: score.tracks.map(t => this.fromTrack(t))
    };
  }

  private fromMasterBar(
    masterBar: alphaTab.model.MasterBar,
    index: number,
    score: alphaTab.model.Score
  ): MasterBarDoc {
    const previous = index > 0 ? score.masterBars[index - 1] : null;
    const signatureChanged =
      !previous ||
      previous.timeSignatureNumerator !== masterBar.timeSignatureNumerator ||
      previous.timeSignatureDenominator !== masterBar.timeSignatureDenominator;

    return {
      timeSignature: signatureChanged
        ? {
            numerator: masterBar.timeSignatureNumerator,
            denominator: masterBar.timeSignatureDenominator,
            isCommon: masterBar.timeSignatureCommon
          }
        : null,
      tempoAutomation:
        masterBar.tempoAutomations.length > 0 ? masterBar.tempoAutomations[0].value : null,
      isRepeatStart: masterBar.isRepeatStart,
      repeatCount: masterBar.repeatCount,
      alternateEndings: masterBar.alternateEndings,
      tripletFeel: this.fromTripletFeel(masterBar.tripletFeel),
      section: masterBar.section
        ? { marker: masterBar.section.marker ?? '', text: masterBar.section.text ?? '' }
        : null,
      isDoubleBar: masterBar.isDoubleBar,
      isFreeTime: masterBar.isFreeTime
    };
  }

  private fromTrack(track: alphaTab.model.Track): TrackDoc {
    return {
      id: `track-${track.index}`,
      name: track.name ?? '',
      shortName: track.shortName ?? '',
      color: track.color.rgba,
      playback: {
        program: track.playbackInfo.program,
        bank: track.playbackInfo.bank,
        volume: track.playbackInfo.volume,
        balance: track.playbackInfo.balance,
        isMute: track.playbackInfo.isMute,
        isSolo: track.playbackInfo.isSolo
      },
      staves: track.staves.map(s => this.fromStaff(s))
    };
  }

  private fromStaff(staff: alphaTab.model.Staff): StaffDoc {
    return {
      tuning: staff.stringTuning.tunings.slice(),
      tuningLabel: staff.stringTuning.name ?? '',
      capo: staff.capo,
      transpose: staff.transpositionPitch,
      displayTranspose: staff.displayTranspositionPitch,
      showStandardNotation: staff.showStandardNotation,
      showTablature: staff.showTablature,
      showSlash: staff.showSlash,
      showNumbered: staff.showNumbered,
      bars: staff.bars.map(b => this.fromBar(b))
    };
  }

  private fromBar(bar: alphaTab.model.Bar): BarDoc {
    return {
      clef: this.fromClef(bar.clef),
      clefOttava: this.fromOttavia(bar.clefOttava),
      keySignature: {
        fifths: bar.keySignature as number,
        mode:
          bar.keySignatureType === alphaTab.model.KeySignatureType.Minor ? 'minor' : 'major'
      },
      voices: bar.voices.map(v => this.fromVoice(v))
    };
  }

  private fromVoice(voice: alphaTab.model.Voice): VoiceDoc {
    return { beats: voice.beats.map(b => this.fromBeat(b)) };
  }

  private fromBeat(beat: alphaTab.model.Beat): BeatDoc {
    const effects = createDefaultBeatEffects();
    effects.isLetRing = beat.isLetRing;
    effects.isPalmMute = beat.isPalmMute;
    effects.slap = beat.slap;
    effects.pop = beat.pop;
    effects.tap = beat.tap;
    effects.vibrato = beat.vibrato !== alphaTab.model.VibratoType.None;
    effects.brush = this.fromBrushType(beat.brushType);
    effects.grace = this.fromGraceType(beat.graceType);

    return {
      duration: (beat.duration as number) as DurationValue,
      dots: beat.dots,
      tuplet:
        beat.tupletNumerator > 1
          ? { numerator: beat.tupletNumerator, denominator: beat.tupletDenominator }
          : null,
      isRest: beat.notes.length === 0,
      notes: beat.notes.map(n => this.fromNote(n)),
      dynamics: this.fromDynamicValue(beat.dynamics),
      lyrics: beat.lyrics && beat.lyrics.length > 0 ? beat.lyrics[0] : null,
      text: beat.text ?? null,
      effects
    };
  }

  private fromNote(note: alphaTab.model.Note): NoteDoc {
    const effects = createDefaultNoteEffects();
    effects.isGhost = note.isGhost;
    effects.isDead = note.isDead;
    effects.isLetRing = note.isLetRing;
    effects.isPalmMute = note.isPalmMute;
    effects.isStaccato = note.isStaccato;
    effects.vibrato = note.vibrato !== alphaTab.model.VibratoType.None;
    effects.harmonic = this.fromHarmonicType(note.harmonicType);

    const pitch: NotePitch = note.isStringed
      ? { kind: 'fretted', string: note.string, fret: note.fret }
      : {
          kind: 'pitched',
          noteValue: note.tone,
          octave: note.octave - ScoreDocMapperService.OCTAVE_OFFSET
        };

    return {
      pitch,
      isTied: note.isTieDestination,
      accidental:
        note.accidentalMode === alphaTab.model.NoteAccidentalMode.Default
          ? 'auto'
          : 'explicit',
      effects
    };
  }

  // -------------------------------------------------------------------------
  // Enum bridges
  // -------------------------------------------------------------------------

  private toClef(kind: ClefKind): alphaTab.model.Clef {
    switch (kind) {
      case 'f4': return alphaTab.model.Clef.F4;
      case 'c3': return alphaTab.model.Clef.C3;
      case 'c4': return alphaTab.model.Clef.C4;
      case 'n': return alphaTab.model.Clef.Neutral;
      default: return alphaTab.model.Clef.G2;
    }
  }

  private fromClef(clef: alphaTab.model.Clef): ClefKind {
    switch (clef) {
      case alphaTab.model.Clef.F4: return 'f4';
      case alphaTab.model.Clef.C3: return 'c3';
      case alphaTab.model.Clef.C4: return 'c4';
      case alphaTab.model.Clef.Neutral: return 'n';
      default: return 'g2';
    }
  }

  private toOttavia(kind: OttaviaKind): alphaTab.model.Ottavia {
    switch (kind) {
      case '15ma': return alphaTab.model.Ottavia._15ma;
      case '8va': return alphaTab.model.Ottavia._8va;
      case '8vb': return alphaTab.model.Ottavia._8vb;
      case '15mb': return alphaTab.model.Ottavia._15mb;
      default: return alphaTab.model.Ottavia.Regular;
    }
  }

  private fromOttavia(ottavia: alphaTab.model.Ottavia): OttaviaKind {
    switch (ottavia) {
      case alphaTab.model.Ottavia._15ma: return '15ma';
      case alphaTab.model.Ottavia._8va: return '8va';
      case alphaTab.model.Ottavia._8vb: return '8vb';
      case alphaTab.model.Ottavia._15mb: return '15mb';
      default: return 'regular';
    }
  }

  private toTripletFeel(kind: TripletFeelKind): alphaTab.model.TripletFeel {
    switch (kind) {
      case 'triplet8th': return alphaTab.model.TripletFeel.Triplet8th;
      case 'triplet16th': return alphaTab.model.TripletFeel.Triplet16th;
      case 'dotted8th': return alphaTab.model.TripletFeel.Dotted8th;
      case 'dotted16th': return alphaTab.model.TripletFeel.Dotted16th;
      case 'scottish8th': return alphaTab.model.TripletFeel.Scottish8th;
      case 'scottish16th': return alphaTab.model.TripletFeel.Scottish16th;
      default: return alphaTab.model.TripletFeel.NoTripletFeel;
    }
  }

  private fromTripletFeel(feel: alphaTab.model.TripletFeel): TripletFeelKind {
    switch (feel) {
      case alphaTab.model.TripletFeel.Triplet8th: return 'triplet8th';
      case alphaTab.model.TripletFeel.Triplet16th: return 'triplet16th';
      case alphaTab.model.TripletFeel.Dotted8th: return 'dotted8th';
      case alphaTab.model.TripletFeel.Dotted16th: return 'dotted16th';
      case alphaTab.model.TripletFeel.Scottish8th: return 'scottish8th';
      case alphaTab.model.TripletFeel.Scottish16th: return 'scottish16th';
      default: return 'none';
    }
  }

  private toDynamicValue(value: DynamicValue): alphaTab.model.DynamicValue {
    switch (value) {
      case 'ppp': return alphaTab.model.DynamicValue.PPP;
      case 'pp': return alphaTab.model.DynamicValue.PP;
      case 'p': return alphaTab.model.DynamicValue.P;
      case 'mp': return alphaTab.model.DynamicValue.MP;
      case 'mf': return alphaTab.model.DynamicValue.MF;
      case 'ff': return alphaTab.model.DynamicValue.FF;
      case 'fff': return alphaTab.model.DynamicValue.FFF;
      default: return alphaTab.model.DynamicValue.F;
    }
  }

  private fromDynamicValue(value: alphaTab.model.DynamicValue): DynamicValue | null {
    switch (value) {
      case alphaTab.model.DynamicValue.PPP: return 'ppp';
      case alphaTab.model.DynamicValue.PP: return 'pp';
      case alphaTab.model.DynamicValue.P: return 'p';
      case alphaTab.model.DynamicValue.MP: return 'mp';
      case alphaTab.model.DynamicValue.MF: return 'mf';
      case alphaTab.model.DynamicValue.F: return 'f';
      case alphaTab.model.DynamicValue.FF: return 'ff';
      case alphaTab.model.DynamicValue.FFF: return 'fff';
      default: return null;
    }
  }

  private toBrushType(brush: string): alphaTab.model.BrushType {
    switch (brush) {
      case 'brushUp': return alphaTab.model.BrushType.BrushUp;
      case 'brushDown': return alphaTab.model.BrushType.BrushDown;
      case 'arpeggioUp': return alphaTab.model.BrushType.ArpeggioUp;
      case 'arpeggioDown': return alphaTab.model.BrushType.ArpeggioDown;
      default: return alphaTab.model.BrushType.None;
    }
  }

  private fromBrushType(brush: alphaTab.model.BrushType): BeatDoc['effects']['brush'] {
    switch (brush) {
      case alphaTab.model.BrushType.BrushUp: return 'brushUp';
      case alphaTab.model.BrushType.BrushDown: return 'brushDown';
      case alphaTab.model.BrushType.ArpeggioUp: return 'arpeggioUp';
      case alphaTab.model.BrushType.ArpeggioDown: return 'arpeggioDown';
      default: return 'none';
    }
  }

  private toGraceType(grace: string): alphaTab.model.GraceType {
    switch (grace) {
      case 'onBeat': return alphaTab.model.GraceType.OnBeat;
      case 'beforeBeat': return alphaTab.model.GraceType.BeforeBeat;
      default: return alphaTab.model.GraceType.None;
    }
  }

  private fromGraceType(grace: alphaTab.model.GraceType): BeatDoc['effects']['grace'] {
    switch (grace) {
      case alphaTab.model.GraceType.OnBeat: return 'onBeat';
      case alphaTab.model.GraceType.BeforeBeat: return 'beforeBeat';
      default: return 'none';
    }
  }

  private toHarmonicType(harmonic: string): alphaTab.model.HarmonicType {
    switch (harmonic) {
      case 'natural': return alphaTab.model.HarmonicType.Natural;
      case 'artificial': return alphaTab.model.HarmonicType.Artificial;
      case 'pinch': return alphaTab.model.HarmonicType.Pinch;
      case 'tap': return alphaTab.model.HarmonicType.Tap;
      case 'semi': return alphaTab.model.HarmonicType.Semi;
      default: return alphaTab.model.HarmonicType.None;
    }
  }

  private fromHarmonicType(
    harmonic: alphaTab.model.HarmonicType
  ): NoteDoc['effects']['harmonic'] {
    switch (harmonic) {
      case alphaTab.model.HarmonicType.Natural: return 'natural';
      case alphaTab.model.HarmonicType.Artificial: return 'artificial';
      case alphaTab.model.HarmonicType.Pinch: return 'pinch';
      case alphaTab.model.HarmonicType.Tap: return 'tap';
      case alphaTab.model.HarmonicType.Semi: return 'semi';
      default: return 'none';
    }
  }

  private applySlide(note: alphaTab.model.Note, slide: NoteDoc['effects']['slide']): void {
    switch (slide) {
      case 'shiftSlide':
        note.slideOutType = alphaTab.model.SlideOutType.Shift;
        break;
      case 'legatoSlide':
        note.slideOutType = alphaTab.model.SlideOutType.Legato;
        break;
      case 'slideOutUp':
        note.slideOutType = alphaTab.model.SlideOutType.OutUp;
        break;
      case 'slideInBelow':
        note.slideInType = alphaTab.model.SlideInType.IntoFromBelow;
        break;
      default:
        note.slideOutType = alphaTab.model.SlideOutType.None;
    }
  }
}

/** Reference key signatures, exposed for UI pickers. */
export const KEY_SIGNATURES: ReadonlyArray<{ label: string; value: KeySignature }> = [
  { label: 'C major / A minor', value: { fifths: 0, mode: 'major' } },
  { label: 'G major / E minor', value: { fifths: 1, mode: 'major' } },
  { label: 'D major / B minor', value: { fifths: 2, mode: 'major' } },
  { label: 'A major / F# minor', value: { fifths: 3, mode: 'major' } },
  { label: 'E major / C# minor', value: { fifths: 4, mode: 'major' } },
  { label: 'B major / G# minor', value: { fifths: 5, mode: 'major' } },
  { label: 'F# major / D# minor', value: { fifths: 6, mode: 'major' } },
  { label: 'F major / D minor', value: { fifths: -1, mode: 'major' } },
  { label: 'Bb major / G minor', value: { fifths: -2, mode: 'major' } },
  { label: 'Eb major / C minor', value: { fifths: -3, mode: 'major' } },
  { label: 'Ab major / F minor', value: { fifths: -4, mode: 'major' } },
  { label: 'Db major / Bb minor', value: { fifths: -5, mode: 'major' } },
  { label: 'Gb major / Eb minor', value: { fifths: -6, mode: 'major' } }
];
