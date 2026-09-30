import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTexService } from './alpha-tex.service';
import { LossId, conversionLossOf } from './gp-conversion-loss';
import { ScoreDocMapperService } from './score-doc-mapper.service';

/**
 * One spec per row of the loss checker: a score with that feature and no other, asserting the item, its count and its
 * first bar. There is no `.gp` fixture in the repo (the GP-composer design, Part 7), so each score is parsed from alphaTex
 * - a guitar track of two bars, a clean conversion - and the feature is set on alphaTab's model after, where a reader of
 * a real file would find it.
 */
describe('conversionLossOf', () => {
  let tex: AlphaTexService;
  let mapper: ScoreDocMapperService;
  const model = alphaTab.model;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    tex = TestBed.inject(AlphaTexService);
    mapper = TestBed.inject(ScoreDocMapperService);
  });

  /** Two bars of four quarters on the G string, which convert whole. */
  function guitar(): alphaTab.model.Score {
    const { score } = tex.parse(['\\track "Guitar"', '3.3.4 3.3.4 3.3.4 3.3.4 | 5.3.4 5.3.4 5.3.4 5.3.4 |'].join('\n'));
    if (!score) throw new Error('the base score did not parse');
    return score;
  }

  const staffOf = (score: alphaTab.model.Score): alphaTab.model.Staff => score.tracks[0].staves[0];
  /** Beat `beat` of bar `bar` - bar 1, the second, unless said otherwise, so a first bar of 2 proves the bar is read. */
  const beatOf = (score: alphaTab.model.Score, beat = 0, bar = 1): alphaTab.model.Beat => staffOf(score).bars[bar].voices[0].beats[beat];
  const noteOf = (score: alphaTab.model.Score, beat = 0, bar = 1): alphaTab.model.Note => beatOf(score, beat, bar).notes[0];

  const lossOf = (score: alphaTab.model.Score) => conversionLossOf(score, mapper.toDoc(score));
  const itemOf = (score: alphaTab.model.Score, id: LossId) => lossOf(score).find(item => item.id === id);

  it('reports nothing for a file that converts whole', () => {
    expect(lossOf(guitar())).toEqual([]);
  });

  /** A case: what to set, what it reports, and the count and first bar it reports it with. */
  interface Case {
    id: LossId;
    set: (score: alphaTab.model.Score) => void;
    count?: number;
    firstBar?: number;
  }

  const cases: Case[] = [
    {
      id: 'chordDiagrams',
      set: score => {
        staffOf(score).addChord('c1', new model.Chord());
        staffOf(score).addChord('c2', new model.Chord());
        beatOf(score).chordId = 'c1';
      },
      count: 2
    },
    {
      id: 'tremoloBar',
      set: score => {
        const beat = beatOf(score);
        beat.whammyBarType = model.WhammyType.Dive;
        beat.addWhammyBarPoint(new model.BendPoint(0, 0));
        beat.addWhammyBarPoint(new model.BendPoint(60, -4));
      }
    },
    { id: 'wah', set: score => (beatOf(score).wahPedal = model.WahPedal.Open) },
    { id: 'lyricLines', set: score => (beatOf(score).lyrics = ['one', 'two']) },
    {
      id: 'tempoChanges',
      set: score => {
        score.masterBars[1].tempoAutomations.push(model.Automation.buildTempoAutomation(false, 0, 90, 0));
        score.masterBars[1].tempoAutomations.push(model.Automation.buildTempoAutomation(false, 0.5, 100, 0));
      }
    },
    { id: 'tempoChanges', set: score => score.masterBars[1].tempoAutomations.push(model.Automation.buildTempoAutomation(false, 0.5, 100, 0)) },
    { id: 'unnamedSlides', set: score => (noteOf(score).slideOutType = model.SlideOutType.OutDown) },
    { id: 'unnamedSlides', set: score => (noteOf(score).slideInType = model.SlideInType.IntoFromAbove) },
    {
      id: 'unnamedSlides',
      set: score => {
        noteOf(score).slideInType = model.SlideInType.IntoFromBelow;
        noteOf(score).slideOutType = model.SlideOutType.OutUp;
      }
    },
    { id: 'directions', set: score => (score.masterBars[1].directions = new Set([model.Direction.JumpDaCapo, model.Direction.TargetFine])), count: 2 },
    {
      id: 'syncPoints',
      set: score => {
        const point = new model.Automation();
        point.type = model.AutomationType.SyncPoint;
        score.masterBars[1].syncPoints = [point];
      }
    },
    { id: 'layout', set: score => (score.stylesheet.hideDynamics = true), firstBar: 0 },
    { id: 'layout', set: score => (score.masterBars[1].displayWidth = 300) },
    { id: 'fades', set: score => (beatOf(score).fade = model.FadeType.FadeOut) },
    { id: 'fades', set: score => (beatOf(score).fade = model.FadeType.VolumeSwell) },
    { id: 'tremoloPicking', set: score => (beatOf(score).tremoloPicking = new model.TremoloPickingEffect()) },
    { id: 'ornaments', set: score => (noteOf(score).ornament = model.NoteOrnament.Turn) },
    { id: 'sustainPedals', set: score => staffOf(score).bars[1].sustainPedals.push(new model.SustainPedalMarker()) },
    { id: 'simile', set: score => (staffOf(score).bars[1].simileMark = model.SimileMark.Simple) },
    {
      id: 'barre',
      set: score => {
        beatOf(score).barreShape = model.BarreShape.Full;
        beatOf(score).barreFret = 5;
      }
    },
    { id: 'rasgueado', set: score => (beatOf(score).rasgueado = model.Rasgueado.Ii) },
    { id: 'golpe', set: score => (beatOf(score).golpe = model.GolpeType.Thumb) },
    { id: 'beatOttava', set: score => (beatOf(score).ottava = model.Ottavia._8va) },
    { id: 'slashedBeats', set: score => (beatOf(score).slashed = true) },
    { id: 'otherDynamics', set: score => (beatOf(score).dynamics = model.DynamicValue.SFZ) },
    { id: 'bendGraces', set: score => (beatOf(score).graceType = model.GraceType.BendGrace) },
    {
      id: 'harmonicPitch',
      set: score => {
        noteOf(score).harmonicType = model.HarmonicType.Artificial;
        noteOf(score).harmonicValue = 12;
      }
    },
    { id: 'feedbackHarmonics', set: score => (noteOf(score).harmonicType = model.HarmonicType.Feedback) },
    { id: 'bendStyle', set: score => (noteOf(score).bendStyle = model.BendStyle.Gradual) },
    { id: 'bendStyle', set: score => (noteOf(score).isContinuedBend = true) },
    { id: 'slurs', set: score => (beatOf(score).isLegatoOrigin = true) },
    { id: 'slurs', set: score => (noteOf(score).isSlurDestination = true) },
    { id: 'hiddenNotes', set: score => (noteOf(score).isVisible = false) },
    { id: 'hiddenNotes', set: score => (noteOf(score).durationPercent = 0.5) },
    {
      id: 'beatAutomations',
      set: score => {
        const volume = new model.Automation();
        volume.type = model.AutomationType.Volume;
        beatOf(score).automations.push(volume);
      }
    },
    { id: 'pickupBars', set: score => (score.masterBars[0].isAnacrusis = true), firstBar: 1 },
    { id: 'barLines', set: score => (staffOf(score).bars[1].barLineRight = model.BarLineStyle.Heavy) },
    { id: 'beaming', set: score => (beatOf(score).invertBeamDirection = true) },
    { id: 'beaming', set: score => (beatOf(score).beamingMode = model.BeatBeamingMode.ForceMergeWithNext) },
    {
      id: 'brushSpeed',
      set: score => {
        beatOf(score).brushType = model.BrushType.BrushDown;
        beatOf(score).brushDuration = 120;
      }
    },
    { id: 'forcedNaturals', set: score => (noteOf(score).accidentalMode = model.NoteAccidentalMode.ForceNatural) },
    { id: 'forcedNaturals', set: score => (noteOf(score).accidentalMode = model.NoteAccidentalMode.ForceNone) },
    {
      // A pitched C0 on a guitar staff: `frettedDocOf` finds no string that reaches it.
      id: 'unreachableNotes',
      set: score => {
        const low = new model.Note();
        low.octave = 1;
        low.tone = 0;
        beatOf(score, 1).addNote(low);
      }
    },
    {
      id: 'credits',
      set: score => {
        score.copyright = '2026';
        score.words = 'Someone';
      },
      count: 2,
      firstBar: 0
    },
    { id: 'midiChannels', set: score => (score.tracks[0].playbackInfo.primaryChannel = 5), firstBar: 0 },
    { id: 'customStyles', set: score => (noteOf(score).style = new model.NoteStyle()) },
    { id: 'doubleBars', set: score => (score.masterBars[1].isDoubleBar = true) }
  ];

  for (const { id, set, count = 1, firstBar = 2 } of cases) {
    it(`reports ${id}, with its count and first bar`, () => {
      const score = guitar();
      set(score);

      const loss = lossOf(score);
      expect(loss.map(item => item.id)).withContext('only the item set').toEqual([id]);
      expect(loss[0].count).toBe(count);
      expect(loss[0].firstBar).toBe(firstBar);
    });
  }

  it('says the count and the first bar in the detail, and lists the first save under its own group', () => {
    const score = guitar();
    beatOf(score, 0).wahPedal = model.WahPedal.Open;
    beatOf(score, 2).wahPedal = model.WahPedal.Closed;
    score.masterBars[1].isDoubleBar = true;

    const loss = lossOf(score);
    expect(itemOf(score, 'wah')).toEqual({ id: 'wah', group: 'conversion', label: 'Wah', detail: '2 beats, first in bar 2', count: 2, firstBar: 2 });
    expect(loss.find(item => item.id === 'doubleBars')?.group).toBe('first save');
  });

  it('lists items by first bar, then by count, most first', () => {
    const score = guitar();
    score.copyright = '2026';
    beatOf(score, 0).wahPedal = model.WahPedal.Open;
    beatOf(score, 0, 0).golpe = model.GolpeType.Thumb;
    beatOf(score, 1).rasgueado = model.Rasgueado.Ii;
    beatOf(score, 2).rasgueado = model.Rasgueado.Ii;

    expect(lossOf(score).map(item => item.id)).toEqual(['credits', 'golpe', 'rasgueado', 'wah']);
  });

  it('does not report per-note dynamics, which alphaTab copies from the beat on every finish', () => {
    const score = guitar();
    noteOf(score).dynamics = model.DynamicValue.PP;
    score.finish(new alphaTab.Settings());

    expect(lossOf(score)).toEqual([]);
  });

  it('does not report multiple voices, which convert whole, and does report a second voice of rests alone as a save item', () => {
    const score = guitar();
    for (const bar of staffOf(score).bars) {
      const voice = new model.Voice();
      bar.addVoice(voice);
      for (let index = 0; index < 4; index++) {
        const beat = new model.Beat();
        beat.duration = model.Duration.Quarter;
        // Bar 1's second voice has notes; bar 2's is rests alone.
        if (bar.index === 0) {
          const note = new model.Note();
          note.fret = 0;
          note.string = 1;
          beat.addNote(note);
        }
        voice.addBeat(beat);
      }
    }
    score.finish(new alphaTab.Settings());

    const loss = lossOf(score);
    expect(loss.map(item => item.id)).toEqual(['restVoices']);
    expect(loss[0]).toEqual(jasmine.objectContaining({ group: 'first save', count: 1, firstBar: 2 }));
  });

  describe('drums', () => {
    function kit(extra: alphaTab.model.InstrumentArticulation | null = null): alphaTab.model.Score {
      const { score } = tex.parse(['\\track "Drums" {instrument percussion}', '\\articulation defaults', '"Kick (hit)".4 "Snare (hit)".4 r.2 |'].join('\n'));
      if (!score) throw new Error('the kit did not parse');
      if (extra) {
        score.tracks[0].percussionArticulations.push(extra);
        score.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0].percussionArticulation = score.tracks[0].percussionArticulations.length - 1;
      }
      return score;
    }

    it('reports nothing for a standard kit, which alphaTex names and reads back as itself', () => {
      expect(lossOf(kit())).toEqual([]);
    });

    it('reports a drum alphaTex has no name for as a save item, since the save would not reopen', () => {
      const head = model.MusicFontSymbol.NoteheadBlack;
      const loss = lossOf(kit(new model.InstrumentArticulation('Mystery', 5, 77, head, head, head, model.MusicFontSymbol.None, undefined, 999)));

      expect(loss.map(item => item.id)).toEqual(['unsavableKit']);
      expect(loss[0]).toEqual(jasmine.objectContaining({ group: 'first save', count: 1, firstBar: 1 }));
    });

    it('reports a standard drum the file draws or plays differently, which the reload would take from the table', () => {
      const snare = kit().tracks[0].percussionArticulations.find(articulation => articulation.id === 38);
      if (!snare) throw new Error('no snare');
      const moved = new model.InstrumentArticulation(snare.elementType, snare.staffLine + 2, snare.outputMidiNumber, snare.noteHeadDefault, snare.noteHeadHalf, snare.noteHeadWhole, snare.techniqueSymbol, snare.techniqueSymbolPlacement, snare.id);

      expect(lossOf(kit(moved)).map(item => item.id)).toEqual(['unsavableKit']);
    });
  });
});
