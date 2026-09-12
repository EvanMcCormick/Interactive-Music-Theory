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
  NoteLetter,
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
import {
  applySlide,
  fromBrushType,
  fromClef,
  fromDynamicValue,
  fromGraceType,
  fromHarmonicType,
  fromOttavia,
  fromTripletFeel,
  toBrushType,
  toClef,
  toDynamicValue,
  toGraceType,
  toHarmonicType,
  toOttavia,
  toTripletFeel
} from './alpha-tab-enum.bridge';
import { alterFor } from './note-spelling';
import { STEP_SEMITONES } from './staff-pitch';

/** Step index of each letter, C through B, as `SpelledNote.letter` numbers them. */
const LETTER_STEP: Record<NoteLetter, number> =
  { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/**
 * `LETTER_STEP` read the other way through `STEP_SEMITONES`, so a white pitch
 * class names its letter.
 */
const LETTER_BY_NATURAL: ReadonlyMap<number, NoteLetter> = new Map(
  (Object.entries(LETTER_STEP) as [NoteLetter, number][]).map(
    ([letter, step]): [number, NoteLetter] => [STEP_SEMITONES[step], letter]
  )
);

/**
 * The alteration each forcing mode carries, in semitones above the letter's
 * natural pitch.
 *
 * That is the musical sign, and it is the opposite of the displacement alphaTab
 * applies: a flat is an alteration of -1 and a displacement of +1. See
 * `accidentalModeFor`.
 *
 * `Default` is deliberately absent, which is what makes the reverse direction
 * honest. A note with no letter also carries `Default`, so reading `Default`
 * back can only mean "no letter was asked for". A natural letter therefore does
 * not survive the round trip, and does not need to: alphaTab puts a white pitch
 * class on its own letter under every key signature.
 *
 * **Why not `ForceNatural` for alter 0.** It is the one mode that would make
 * the round trip lossless - a natural letter would come back as itself rather
 * than as no letter - and it is still not worth taking. The enum documents it
 * as moving the note a line and applying a naturalize, but 1.8.0 does neither:
 * `AccidentalHelper.getNoteValue` has no case for it, and neither does
 * `ModelUtils.computeAccidental`, so it falls through and renders exactly as
 * `Default` does. Adopting it would buy a round-trip nicety on the strength of
 * a documented behaviour the bundle does not implement, and would go wrong in
 * whichever direction a later version resolved that contradiction - drawing a
 * ♮ on every natural degree the progression writes, or shifting the line. The
 * lossiness it would fix costs nothing, per the paragraph above.
 */
const ALTER_BY_MODE: ReadonlyMap<alphaTab.model.NoteAccidentalMode, number> = new Map([
  [alphaTab.model.NoteAccidentalMode.ForceDoubleFlat, -2],
  [alphaTab.model.NoteAccidentalMode.ForceFlat, -1],
  [alphaTab.model.NoteAccidentalMode.ForceSharp, 1],
  [alphaTab.model.NoteAccidentalMode.ForceDoubleSharp, 2]
]);

/** `ALTER_BY_MODE` read the other way, so the two directions cannot disagree. */
const MODE_BY_ALTER: ReadonlyMap<number, alphaTab.model.NoteAccidentalMode> = new Map(
  Array.from(ALTER_BY_MODE, ([mode, alter]): [number, alphaTab.model.NoteAccidentalMode] =>
    [alter, mode]
  )
);

/**
 * The accidental mode that makes alphaTab engrave `pitchClass` on `letter`.
 *
 * `AccidentalHelper.getNoteValue` displaces the note by exactly the forced
 * accidental and draws that value's line: the displaced value is the letter's
 * natural pitch, always a white key, so the key signature can never ambiguate
 * it. Past a double accidental there is no notation to ask for, so the letter
 * is dropped and alphaTab spells from the key signature - the same refusal
 * `spellAt` makes, one layer out. A natural asks for no forcing and takes the
 * same fallback, which draws the letter anyway.
 *
 * The alteration itself comes from `note-spelling.ts` rather than being worked
 * out here: it is the same ±6 normalisation `spellAt` runs, and the same
 * octave-boundary argument holds it up.
 */
function accidentalModeFor(
  letter: NoteLetter,
  pitchClass: number
): alphaTab.model.NoteAccidentalMode {
  const alter = alterFor(pitchClass, LETTER_STEP[letter]);
  return MODE_BY_ALTER.get(alter) ?? alphaTab.model.NoteAccidentalMode.Default;
}

/** The letter a forced accidental puts a pitch class on, or undefined if none is forced. */
function letterFor(
  mode: alphaTab.model.NoteAccidentalMode,
  pitchClass: number
): NoteLetter | undefined {
  const alter = ALTER_BY_MODE.get(mode);
  if (alter === undefined) return undefined;

  return LETTER_BY_NATURAL.get(((((pitchClass - alter) % 12) + 12) % 12));
}

/**
 * Converts between our editable ScoreDoc and alphaTab's runtime Score.
 *
 * ScoreDoc -> Score feeds `api.renderScore()` for engraving and playback, and
 * alphaTab's own AlphaTexExporter for the tex escape hatch and persistence.
 * Score -> ScoreDoc brings edited tex back in.
 *
 * Two alphaTab conventions are normalised here so the rest of the app can use
 * the ones musicians expect. Both are verified in the spec.
 *
 * OCTAVE: alphaTab stores octaves one higher than scientific pitch notation.
 * alphaTex `C4` (middle C, MIDI 60) is stored as octave 5, tone 0, because
 * realValue = octave * 12 + tone. ScoreDoc uses scientific notation.
 *
 * STRING NUMBERING: alphaTab numbers strings from the LOWEST pitch, so on a
 * 6-string guitar string 1 is the low E and string 6 is the high E. Standard
 * tab notation is the opposite - string 1 is the high E, the top line of the
 * tab staff. ScoreDoc uses the tab convention, where string 1 always
 * corresponds to StaffDoc.tuning[0], the highest-pitched string.
 */
@Injectable({ providedIn: 'root' })
export class ScoreDocMapperService {
  /** alphaTab octave = scientific octave + 1. */
  private static readonly OCTAVE_OFFSET = 1;

  /** Converts between tab string numbering and alphaTab's, in either direction. */
  private flipString(stringNumber: number, stringCount: number): number {
    return stringCount - stringNumber + 1;
  }

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
    masterBar.tripletFeel = toTripletFeel(doc.tripletFeel);
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

    const stringCount = doc.tuning.length;
    for (const barDoc of doc.bars) {
      staff.addBar(this.toBar(barDoc, stringCount));
    }
    return staff;
  }

  private toBar(doc: BarDoc, stringCount: number): alphaTab.model.Bar {
    const bar = new alphaTab.model.Bar();
    bar.clef = toClef(doc.clef);
    bar.clefOttava = toOttavia(doc.clefOttava);
    bar.keySignature = doc.keySignature.fifths as alphaTab.model.KeySignature;
    bar.keySignatureType =
      doc.keySignature.mode === 'minor'
        ? alphaTab.model.KeySignatureType.Minor
        : alphaTab.model.KeySignatureType.Major;

    doc.voices.forEach((voiceDoc, index) => {
      bar.addVoice(this.toVoice(voiceDoc, stringCount, index));
    });
    return bar;
  }

  /**
   * Maps one voice, and declines to draw an accompanying voice that says
   * nothing.
   *
   * A second voice made entirely of rests is a placeholder rather than a
   * musical statement, and it exists because a document may not carry voice 2
   * in some bars and not others: alphaTab's `Voice._chain` reads
   * `bar.nextBar.voices[this.index]` for the last beat of every voice and
   * dereferences it unchecked, so a bar with a second voice followed by one
   * without throws out of `Score.finish` before anything is drawn. The
   * ghost-note preview therefore gives *every* bar the extra voice, including
   * the bars that discarded nothing - and alphaTab duly drew a grey full-bar
   * rest under each of them.
   *
   * Marking those beats `isEmpty` is the renderer's answer to a document that
   * cannot omit them. `Bar.finish` puts a voice in `filledVoices` only when it
   * is not empty, and `Voice.finish` recomputes emptiness from its beats, so
   * the placeholder voice drops out of the glyphs entirely while remaining
   * present in the model for `_chain` to find. The bars that do carry ghosts
   * are untouched.
   *
   * Only for voices past the first. Voice 0 is added to `filledVoices`
   * unconditionally, so this could not hide it - but it would set
   * `Bar.isEmpty`, which alphaTab reads as "not even having rests" and uses to
   * stretch a beat across the whole bar during MIDI generation. A composer bar
   * the user has left as rests is not that, and must keep drawing its rests.
   */
  private toVoice(
    doc: VoiceDoc,
    stringCount: number,
    index: number
  ): alphaTab.model.Voice {
    const voice = new alphaTab.model.Voice();
    for (const beatDoc of doc.beats) {
      voice.addBeat(this.toBeat(beatDoc, stringCount));
    }

    if (index > 0 && doc.beats.length > 0 && doc.beats.every(beat => beat.isRest)) {
      for (const beat of voice.beats) beat.isEmpty = true;
    }
    return voice;
  }

  private toBeat(doc: BeatDoc, stringCount: number): alphaTab.model.Beat {
    const beat = new alphaTab.model.Beat();
    beat.duration = doc.duration as unknown as alphaTab.model.Duration;
    beat.dots = doc.dots;

    if (doc.tuplet) {
      beat.tupletNumerator = doc.tuplet.numerator;
      beat.tupletDenominator = doc.tuplet.denominator;
    }

    if (doc.dynamics !== null) {
      beat.dynamics = toDynamicValue(doc.dynamics);
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
    beat.brushType = toBrushType(doc.effects.brush);
    beat.graceType = toGraceType(doc.effects.grace);

    // An empty note list is how alphaTab represents a rest.
    if (!doc.isRest) {
      for (const noteDoc of doc.notes) {
        beat.addNote(this.toNote(noteDoc, stringCount));
      }
    }
    return beat;
  }

  private toNote(doc: NoteDoc, stringCount: number): alphaTab.model.Note {
    const note = new alphaTab.model.Note();

    if (doc.pitch.kind === 'fretted') {
      note.string = this.flipString(doc.pitch.string, stringCount);
      note.fret = doc.pitch.fret;
    } else {
      note.octave = doc.pitch.octave + ScoreDocMapperService.OCTAVE_OFFSET;
      note.tone = doc.pitch.noteValue;
    }

    note.isTieDestination = doc.isTied;
    // A letter decides the mode; `accidental` only speaks when there is no
    // letter. Note that `'explicit'` has always meant ForceSharp, which forces
    // a sharp in a flat key - a misnomer `letter` routes around for generated
    // notes and leaves in place for composer-entered ones. See the design doc.
    note.accidentalMode =
      doc.pitch.kind === 'pitched' && doc.pitch.letter !== undefined
        ? accidentalModeFor(doc.pitch.letter, doc.pitch.noteValue)
        : doc.accidental === 'explicit'
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
    note.harmonicType = toHarmonicType(doc.effects.harmonic);
    applySlide(note, doc.effects.slide);

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
      tripletFeel: fromTripletFeel(masterBar.tripletFeel),
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
      staves: track.staves.map(s => this.fromStaff(s)),
      // alphaTab's model has nowhere to carry a marker, so every track read
      // back out of it is an ordinary one. Stated rather than left off: a
      // missing field and an absent marker must not be two different states.
      generated: null
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
      bars: staff.bars.map(b => this.fromBar(b, staff.stringTuning.tunings.length))
    };
  }

  private fromBar(bar: alphaTab.model.Bar, stringCount: number): BarDoc {
    return {
      clef: fromClef(bar.clef),
      clefOttava: fromOttavia(bar.clefOttava),
      keySignature: {
        fifths: bar.keySignature as number,
        mode:
          bar.keySignatureType === alphaTab.model.KeySignatureType.Minor ? 'minor' : 'major'
      },
      voices: bar.voices.map(v => this.fromVoice(v, stringCount))
    };
  }

  private fromVoice(voice: alphaTab.model.Voice, stringCount: number): VoiceDoc {
    return { beats: voice.beats.map(b => this.fromBeat(b, stringCount)) };
  }

  private fromBeat(beat: alphaTab.model.Beat, stringCount: number): BeatDoc {
    const effects = createDefaultBeatEffects();
    effects.isLetRing = beat.isLetRing;
    effects.isPalmMute = beat.isPalmMute;
    effects.slap = beat.slap;
    effects.pop = beat.pop;
    effects.tap = beat.tap;
    effects.vibrato = beat.vibrato !== alphaTab.model.VibratoType.None;
    effects.brush = fromBrushType(beat.brushType);
    effects.grace = fromGraceType(beat.graceType);

    return {
      duration: (beat.duration as number) as DurationValue,
      dots: beat.dots,
      tuplet:
        beat.tupletNumerator > 1
          ? { numerator: beat.tupletNumerator, denominator: beat.tupletDenominator }
          : null,
      isRest: beat.notes.length === 0,
      notes: beat.notes.map(n => this.fromNote(n, stringCount)),
      dynamics: fromDynamicValue(beat.dynamics),
      lyrics: beat.lyrics && beat.lyrics.length > 0 ? beat.lyrics[0] : null,
      text: beat.text ?? null,
      effects
    };
  }

  private fromNote(note: alphaTab.model.Note, stringCount: number): NoteDoc {
    const effects = createDefaultNoteEffects();
    effects.isGhost = note.isGhost;
    effects.isDead = note.isDead;
    effects.isLetRing = note.isLetRing;
    effects.isPalmMute = note.isPalmMute;
    effects.isStaccato = note.isStaccato;
    effects.vibrato = note.vibrato !== alphaTab.model.VibratoType.None;
    effects.harmonic = fromHarmonicType(note.harmonicType);

    const pitch: NotePitch = note.isStringed
      ? {
          kind: 'fretted',
          string: this.flipString(note.string, stringCount),
          fret: note.fret
        }
      : {
          kind: 'pitched',
          noteValue: note.tone,
          octave: note.octave - ScoreDocMapperService.OCTAVE_OFFSET,
          letter: letterFor(note.accidentalMode, note.tone)
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
