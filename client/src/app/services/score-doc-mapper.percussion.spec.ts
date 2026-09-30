import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTexService } from './alpha-tex.service';
import { PERCUSSION_CHANNEL } from './midi-channels';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { NoteDoc, ScoreDoc, createDefaultBar, createDefaultMasterBar, createDefaultPlaybackInfo } from '../models/composer.model';

/**
 * A drum track, both ways through the mapper and through the alphaTex a save writes.
 *
 * alphaTab keeps a drum note in one number (`Note.percussionArticulation`), a kit in one list
 * (`Track.percussionArticulations`) and a drum staff in one flag (`Staff.isPercussion`). The number is an index into the
 * list when it is below the list's length and an id in alphaTab's own table otherwise, and the two shapes come from
 * different importers - a GP7 file declares its kit, a gp3-gp5 file declares none - so both are built here, and the mapper
 * must not care which. There is no `.gp` fixture in the repo; the first shape is built from alphaTex, which the composer
 * already wraps, and the second straight from `alphaTab.model`, as the design's Part 7 says.
 */
describe('ScoreDocMapperService percussion', () => {
  let mapper: ScoreDocMapperService;
  let tex: AlphaTexService;
  let settings: alphaTab.Settings;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mapper = TestBed.inject(ScoreDocMapperService);
    tex = TestBed.inject(AlphaTexService);
    settings = new alphaTab.Settings();
  });

  /** A kit declared by the file: kick and closed hi-hat together, then a snare, then a half rest. */
  function declaredKit(): alphaTab.model.Score {
    const { score } = tex.parse(
      ['\\track "Drums" {instrument percussion}', '\\articulation defaults', '("Kick (hit)" "Hi-Hat (closed)").4 "Snare (hit)".4 r.2 |'].join('\n')
    );
    if (!score) throw new Error('the kit did not parse');
    return score;
  }

  /** A gp3-gp5 drum track: no kit list, and each note carrying an id from alphaTab's own table. */
  function kitById(ids: readonly number[], lineCount = 5): alphaTab.model.Score {
    const score = new alphaTab.model.Score();
    score.addMasterBar(new alphaTab.model.MasterBar());
    const track = new alphaTab.model.Track();
    const staff = new alphaTab.model.Staff();
    staff.isPercussion = true;
    staff.standardNotationLineCount = lineCount;
    track.addStaff(staff);
    score.addTrack(track);
    const bar = new alphaTab.model.Bar();
    staff.addBar(bar);
    const voice = new alphaTab.model.Voice();
    bar.addVoice(voice);
    for (const id of ids) {
      const beat = new alphaTab.model.Beat();
      beat.duration = alphaTab.model.Duration.Quarter;
      const note = new alphaTab.model.Note();
      note.percussionArticulation = id;
      beat.addNote(note);
      voice.addBeat(beat);
    }
    score.finish(settings);
    return score;
  }

  const hits = (doc: ScoreDoc): NoteDoc['pitch'][][] =>
    doc.tracks[0].staves[0].bars[0].voices[0].beats.map(beat => beat.notes.map(note => note.pitch));

  const notesOf = (score: alphaTab.model.Score): alphaTab.model.Note[] =>
    score.tracks[0].staves[0].bars[0].voices[0].beats.flatMap(beat => beat.notes);

  it('reads a drum note as percussion, not as the pitch alphaTab leaves at -1', () => {
    const doc = mapper.toDoc(declaredKit());

    expect(hits(doc)).toEqual([
      [
        { kind: 'percussion', articulation: 0 },
        { kind: 'percussion', articulation: 1 }
      ],
      [{ kind: 'percussion', articulation: 2 }],
      []
    ]);
  });

  it("copies a declared kit field by field, in the file's order", () => {
    const score = declaredKit();
    const doc = mapper.toDoc(score);

    expect(doc.tracks[0].percussionArticulations).toEqual(
      score.tracks[0].percussionArticulations.map(articulation => ({
        id: articulation.id,
        elementType: articulation.elementType,
        staffLine: articulation.staffLine,
        noteHeadDefault: articulation.noteHeadDefault,
        noteHeadHalf: articulation.noteHeadHalf,
        noteHeadWhole: articulation.noteHeadWhole,
        techniqueSymbol: articulation.techniqueSymbol,
        techniqueSymbolPlacement: articulation.techniqueSymbolPlacement,
        outputMidiNumber: articulation.outputMidiNumber
      }))
    );
    expect(doc.tracks[0].percussionArticulations.map(articulation => `${articulation.elementType}.${articulation.id}`)).toEqual([
      'Acoustic Kick Drum.35',
      'Charley.42',
      'Snare.38'
    ]);
  });

  it('reads the staff as percussion, with its line count and no tuning', () => {
    const staff = mapper.toDoc(declaredKit()).tracks[0].staves[0];

    expect(staff.isPercussion).toBeTrue();
    expect(staff.lineCount).toBe(5);
    expect(staff.tuning).toEqual([]);
    expect(staff.showTablature).toBeFalse();
  });

  it('writes a declared kit back as it was read: the numbers, the list, the flag and the clef', () => {
    const read = declaredKit();
    const written = mapper.toScore(mapper.toDoc(read), settings);

    const track = written.tracks[0];
    expect(track.percussionArticulations.map(articulation => articulation.uniqueId)).toEqual(
      read.tracks[0].percussionArticulations.map(articulation => articulation.uniqueId)
    );
    expect(notesOf(written).map(note => note.percussionArticulation)).toEqual([0, 1, 2]);
    expect(notesOf(written).every(note => note.isPercussion && !note.isStringed && !note.isPiano)).toBeTrue();
    expect(track.staves[0].isPercussion).toBeTrue();
    expect(track.staves[0].standardNotationLineCount).toBe(5);
    expect(track.staves[0].bars[0].clef).toBe(read.tracks[0].staves[0].bars[0].clef);
  });

  it('puts a drum track on channel 9 with program 0, which is what makes it sound as a kit', () => {
    const written = mapper.toScore(mapper.toDoc(declaredKit()), settings);

    const playback = written.tracks[0].playbackInfo;
    expect(playback.primaryChannel).toBe(PERCUSSION_CHANNEL);
    expect(playback.secondaryChannel).toBe(PERCUSSION_CHANNEL);
    expect(playback.program).toBe(0);
  });

  it('reads and writes a kit with no list, whose notes are ids in alphaTab\'s own table', () => {
    const read = kitById([38, 42, 36]);
    const doc = mapper.toDoc(read);

    expect(doc.tracks[0].percussionArticulations).toEqual([]);
    expect(hits(doc)).toEqual([
      [{ kind: 'percussion', articulation: 38 }],
      [{ kind: 'percussion', articulation: 42 }],
      [{ kind: 'percussion', articulation: 36 }]
    ]);

    const written = mapper.toScore(doc, settings);
    expect(written.tracks[0].percussionArticulations.length).toBe(0);
    expect(notesOf(written).map(note => note.percussionArticulation)).toEqual([38, 42, 36]);
    expect(notesOf(written).every(note => note.isPercussion)).toBeTrue();
    expect(written.tracks[0].playbackInfo.primaryChannel).toBe(PERCUSSION_CHANNEL);
  });

  it('keeps a line count other than five', () => {
    const doc = mapper.toDoc(kitById([56], 1));

    expect(doc.tracks[0].staves[0].lineCount).toBe(1);
    expect(mapper.toScore(doc, settings).tracks[0].staves[0].standardNotationLineCount).toBe(1);
  });

  it('ties two hits of one drum, since alphaTab chains a percussion note by its articulation', () => {
    const doc = mapper.toDoc(kitById([38, 38]));
    doc.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0].isTied = true;

    const [first, second] = notesOf(mapper.toScore(doc, settings));
    expect(second.isTieDestination).toBeTrue();
    expect(second.tieOrigin).toBe(first);
  });

  describe('MIDI channels', () => {
    /** A one-staff track of `program`, pitched or a kit, with one empty bar. */
    function trackDoc(id: string, program: number, isPercussion: boolean): ScoreDoc['tracks'][number] {
      return {
        id,
        name: id,
        shortName: id,
        color: '#2c3e50',
        playback: createDefaultPlaybackInfo(program),
        staves: [
          {
            tuning: [],
            tuningLabel: '',
            capo: 0,
            transpose: 0,
            displayTranspose: 0,
            showStandardNotation: true,
            showTablature: false,
            showSlash: false,
            showNumbered: false,
            isPercussion,
            lineCount: 5,
            bars: [createDefaultBar(false)]
          }
        ],
        generated: null,
        percussionArticulations: []
      };
    }

    it('gives every pitched track channels of its own and never 9, as the importers do', () => {
      const doc: ScoreDoc = {
        title: '',
        subTitle: '',
        artist: '',
        album: '',
        tempo: 120,
        masterBars: [createDefaultMasterBar()],
        tracks: [trackDoc('gtr', 25, false), trackDoc('drums', 0, true), trackDoc('bass', 33, false), trackDoc('pno', 0, false)]
      };

      const channels = mapper.toScore(doc, settings).tracks.map(track => [track.playbackInfo.primaryChannel, track.playbackInfo.secondaryChannel]);

      expect(channels).toEqual([
        [0, 1],
        [9, 9],
        [2, 3],
        [4, 5]
      ]);
    });
  });

  describe('through alphaTex', () => {
    it('saves a kit and reads it back unchanged, and a second save is byte-identical', () => {
      const doc = mapper.toDoc(declaredKit());
      const saved = tex.export(mapper.toScore(doc, settings));
      const { score: reloaded } = tex.parse(saved);
      if (!reloaded) throw new Error('the saved kit did not parse');

      const again = mapper.toDoc(reloaded);
      expect(hits(again)).toEqual(hits(doc));
      expect(again.tracks[0].percussionArticulations).toEqual(doc.tracks[0].percussionArticulations);
      expect(again.tracks[0].staves[0].isPercussion).toBeTrue();
      expect(again.tracks[0].staves[0].lineCount).toBe(5);
      expect(reloaded.tracks[0].playbackInfo.primaryChannel).toBe(PERCUSSION_CHANNEL);
      expect(tex.export(mapper.toScore(again, settings))).toBe(saved);
    });

    /**
     * The one hole in it, pinned so it cannot be designed away: the exporter writes `\articulation defaults` and never
     * the track's own list, and names each note from alphaTab's table, so an articulation the table has no name for is
     * written `"unknown"` - and reading that back throws, so the whole composition fails to open. The conversion parses
     * its own alphaTex back before it deletes the `.gp` for exactly this reason (design Part 3 and Part 4).
     */
    it('writes an articulation the file invents as "unknown", which does not parse back', () => {
      const doc = mapper.toDoc(declaredKit());
      doc.tracks[0].percussionArticulations.push({
        id: 999,
        elementType: 'Mystery',
        staffLine: 5,
        noteHeadDefault: 0,
        noteHeadHalf: 0,
        noteHeadWhole: 0,
        techniqueSymbol: -1,
        techniqueSymbolPlacement: 1,
        outputMidiNumber: 77
      });
      doc.tracks[0].staves[0].bars[0].voices[0].beats[1].notes = [
        { ...doc.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0], pitch: { kind: 'percussion', articulation: 3 } }
      ];

      const saved = tex.export(mapper.toScore(doc, settings));
      expect(saved).toContain('"unknown"');

      const reloaded = tex.parse(saved);
      expect(reloaded.score).toBeNull();
      expect(reloaded.diagnostics.map(diagnostic => diagnostic.code)).toContain(209);
    });
  });
});
