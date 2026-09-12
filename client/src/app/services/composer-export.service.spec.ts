import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerExportService } from './composer-export.service';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import {
  BeatDoc,
  ScoreDoc,
  STANDARD_GUITAR_TUNING,
  createDefaultBeatEffects,
  createDefaultMasterBar,
  createDefaultNoteEffects,
  createDefaultPlaybackInfo
} from '../models/composer.model';

function quarterNote(noteValue: number, octave: number): BeatDoc {
  return {
    duration: 4,
    dots: 0,
    tuplet: null,
    isRest: false,
    notes: [
      {
        pitch: { kind: 'pitched', noteValue, octave },
        isTied: false,
        accidental: 'auto',
        effects: createDefaultNoteEffects()
      }
    ],
    dynamics: null,
    lyrics: null,
    text: null,
    effects: createDefaultBeatEffects()
  };
}

/** Two tracks, one bar, so the header's track count has something to disagree with. */
function twoTrackDoc(): ScoreDoc {
  const bar = (beats: BeatDoc[]) => ({
    clef: 'g2' as const,
    clefOttava: 'regular' as const,
    keySignature: { fifths: 0, mode: 'major' as const },
    voices: [{ beats }]
  });

  return {
    title: 'Two Tracks',
    subTitle: '',
    artist: 'Spec',
    album: '',
    tempo: 100,
    masterBars: [createDefaultMasterBar()],
    tracks: [
      {
        id: 't1',
        name: 'Piano',
        shortName: 'Pno',
        color: '#3498db',
        playback: createDefaultPlaybackInfo(0),
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
            bars: [
              bar([quarterNote(0, 4), quarterNote(4, 4), quarterNote(7, 4), quarterNote(0, 5)])
            ]
          }
        ],
        generated: null
      },
      {
        id: 't2',
        name: 'Guitar',
        shortName: 'Gtr',
        color: '#e74c3c',
        playback: createDefaultPlaybackInfo(25),
        staves: [
          {
            tuning: STANDARD_GUITAR_TUNING.slice(),
            tuningLabel: 'Guitar Standard Tuning',
            capo: 0,
            transpose: 0,
            displayTranspose: 0,
            showStandardNotation: true,
            showTablature: true,
            showSlash: false,
            showNumbered: false,
            bars: [
              bar([quarterNote(0, 3), quarterNote(3, 3), quarterNote(7, 3), quarterNote(0, 4)])
            ]
          }
        ],
        generated: null
      }
    ]
  };
}

/** The 16-bit big-endian track count that lives at offset 10 of an MThd chunk. */
function headerTrackCount(bytes: Uint8Array): number {
  return (bytes[10] << 8) | bytes[11];
}

describe('ComposerExportService MIDI', () => {
  let exporter: ComposerExportService;
  let mapper: ScoreDocMapperService;
  let settings: alphaTab.Settings;
  let score: alphaTab.model.Score;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    exporter = TestBed.inject(ComposerExportService);
    mapper = TestBed.inject(ScoreDocMapperService);
    settings = new alphaTab.Settings();
    score = mapper.toScore(twoTrackDoc(), settings);
  });

  it('writes a standard MIDI header', () => {
    const bytes = exporter.toMidi(score, settings);

    // "MThd". Past the header the bytes are alphaTab's business, not ours.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x4d, 0x54, 0x68, 0x64]);
  });

  it('writes one MIDI track per score track', () => {
    expect(score.tracks.length).toBe(2);

    expect(headerTrackCount(exporter.toMidi(score, settings))).toBe(2);
  });

  it('needs no rendering api', () => {
    // The point of the change. The old downloadMidi(api) delegated to a
    // *rendering* alphaTab instance, so one export of three had a precondition
    // the other two did not - on /progression, "the notation panel is open".
    expect((exporter as unknown as Record<string, unknown>)['downloadMidi']).toBeUndefined();

    // No AlphaTabApi exists anywhere in this spec, and generation still works.
    expect(exporter.toMidi(score, settings).length).toBeGreaterThan(14);
  });

  it('downloads the MIDI as a .mid file', () => {
    const click = spyOn(HTMLAnchorElement.prototype, 'click');
    let captured: Blob | null = null;
    spyOn(URL, 'createObjectURL').and.callFake((blob: Blob | MediaSource) => {
      captured = blob as Blob;
      return 'blob:spec';
    });
    spyOn(URL, 'revokeObjectURL');

    exporter.downloadMidiFile(score, settings, 'Two Tracks');

    const anchor = click.calls.mostRecent().object as HTMLAnchorElement;
    expect(anchor.download).toBe('Two Tracks.mid');
    expect((captured as unknown as Blob).type).toBe('audio/midi');
  });
});
