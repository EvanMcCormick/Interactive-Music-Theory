import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  Scale,
  ScaleCategory,
  FretNote,
  Tunings,
  Instrument,
  MusicTheoryState,
  Chord,
  ChordCategory,
  MusicTheoryCategory,
  MusicTheoryItem
} from '../models/music-theory.model';

@Injectable({
  providedIn: 'root'
})
export class MusicTheoryService {
  // Chromatic scales
  private chromaticScaleWithBoth = [
    'C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'
  ];
  
  private chromaticScaleWithSharps = [
    'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'
  ];
  
  private chromaticScaleWithFlats = [
    'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'
  ];
  
  // Nashville number system
  private nashvilleNumbers = ['1', 'b2', '2', 'b3', '3', '4', '#4/b5', '5', 'b6', '6', 'b7', '7'];
  
  // Keys that traditionally use flats
  private flatKeys = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];

  // Chord categories
  private chordCategories: ChordCategory[] = [
    {
      id: 'triads',
      name: 'Triads',
      chords: [
        { id: 'major', name: 'Major', intervals: [0, 4, 7], symbol: '' },
        { id: 'minor', name: 'Minor', intervals: [0, 3, 7], symbol: 'm' },
        { id: 'diminished', name: 'Diminished', intervals: [0, 3, 6], symbol: 'dim' },
        { id: 'augmented', name: 'Augmented', intervals: [0, 4, 8], symbol: 'aug' },
        { id: 'sus2', name: 'Suspended 2nd', intervals: [0, 2, 7], symbol: 'sus2' },
        { id: 'sus4', name: 'Suspended 4th', intervals: [0, 5, 7], symbol: 'sus4' }
      ]
    },
    {
      id: 'seventh',
      name: 'Seventh Chords',
      chords: [
        { id: 'major7', name: 'Major 7th', intervals: [0, 4, 7, 11], symbol: 'maj7' },
        { id: 'dominant7', name: 'Dominant 7th', intervals: [0, 4, 7, 10], symbol: '7' },
        { id: 'minor7', name: 'Minor 7th', intervals: [0, 3, 7, 10], symbol: 'm7' },
        { id: 'minorMajor7', name: 'Minor Major 7th', intervals: [0, 3, 7, 11], symbol: 'mMaj7' },
        { id: 'diminished7', name: 'Diminished 7th', intervals: [0, 3, 6, 9], symbol: 'dim7' },
        { id: 'halfDiminished7', name: 'Half Diminished 7th', intervals: [0, 3, 6, 10], symbol: 'm7b5' },
        { id: 'augmented7', name: 'Augmented 7th', intervals: [0, 4, 8, 10], symbol: '7#5' },
        { id: 'augmentedMajor7', name: 'Augmented Major 7th', intervals: [0, 4, 8, 11], symbol: 'maj7#5' }
      ]
    },
    {
      id: 'extended',
      name: 'Extended Chords',
      chords: [
        { id: 'major9', name: 'Major 9th', intervals: [0, 4, 7, 11, 14], symbol: 'maj9' },
        { id: 'dominant9', name: 'Dominant 9th', intervals: [0, 4, 7, 10, 14], symbol: '9' },
        { id: 'minor9', name: 'Minor 9th', intervals: [0, 3, 7, 10, 14], symbol: 'm9' },
        { id: 'major11', name: 'Major 11th', intervals: [0, 4, 7, 11, 14, 17], symbol: 'maj11' },
        { id: 'dominant11', name: 'Dominant 11th', intervals: [0, 4, 7, 10, 14, 17], symbol: '11' },
        { id: 'minor11', name: 'Minor 11th', intervals: [0, 3, 7, 10, 14, 17], symbol: 'm11' },
        { id: 'major13', name: 'Major 13th', intervals: [0, 4, 7, 11, 14, 17, 21], symbol: 'maj13' },
        { id: 'dominant13', name: 'Dominant 13th', intervals: [0, 4, 7, 10, 14, 17, 21], symbol: '13' },
        { id: 'minor13', name: 'Minor 13th', intervals: [0, 3, 7, 10, 14, 17, 21], symbol: 'm13' }
      ]
    },
    {
      id: 'alterations',
      name: 'Altered Chords',
      chords: [
        { id: '7b9', name: '7th flat 9', intervals: [0, 4, 7, 10, 13], symbol: '7b9' },
        { id: '7sharp9', name: '7th sharp 9', intervals: [0, 4, 7, 10, 15], symbol: '7#9' },
        { id: '7b5', name: '7th flat 5', intervals: [0, 4, 6, 10], symbol: '7b5' },
        { id: '7sharp5', name: '7th sharp 5', intervals: [0, 4, 8, 10], symbol: '7#5' },
        { id: 'add9', name: 'Add 9', intervals: [0, 4, 7, 14], symbol: 'add9' },
        { id: 'minor_add9', name: 'Minor Add 9', intervals: [0, 3, 7, 14], symbol: 'madd9' },
        { id: '6', name: '6th', intervals: [0, 4, 7, 9], symbol: '6' },
        { id: 'minor6', name: 'Minor 6th', intervals: [0, 3, 7, 9], symbol: 'm6' }
      ]
    }
  ];

  // Unified categories (scales and chords combined)
  private unifiedCategories: MusicTheoryCategory[] = [];

  // Scale categories
  private scaleCategories: ScaleCategory[] = [
    {
      id: 'fretboardNotes',
      name: 'Fretboard Notes',
      scales: [
        { id: 'allNotesSharp', name: 'All Notes (Sharps)', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], preferSharps: true },
        { id: 'allNotesFlat', name: 'All Notes (Flats)', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], preferSharps: false },
        { id: 'naturalNotes', name: 'Natural Notes (No Sharps/Flats)', intervals: [0, 2, 4, 5, 7, 9, 11], preferSharps: true },
        { id: 'sharps', name: 'Sharp Notes', intervals: [1, 3, 6, 8, 10], preferSharps: true },
        { id: 'flats', name: 'Flat Notes', intervals: [1, 3, 6, 8, 10], preferSharps: false }
      ]
    },
    {
      id: 'diatonicModes',
      name: 'Diatonic Modes',
      scales: [
        { id: 'ionian', name: 'Ionian (Major)', intervals: [0, 2, 4, 5, 7, 9, 11], preferSharps: true },
        { id: 'dorian', name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10], preferSharps: false },
        { id: 'phrygian', name: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10], preferSharps: false },
        { id: 'lydian', name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11], preferSharps: true },
        { id: 'mixolydian', name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10], preferSharps: true },
        { id: 'aeolian', name: 'Aeolian (Natural Minor)', intervals: [0, 2, 3, 5, 7, 8, 10], preferSharps: false },
        { id: 'locrian', name: 'Locrian', intervals: [0, 1, 3, 5, 6, 8, 10], preferSharps: false }
      ]
    },
    {
      id: 'pentatonicScales',
      name: 'Pentatonic Scales',
      scales: [
        { id: 'majorPentatonic', name: 'Major Pentatonic', intervals: [0, 2, 4, 7, 9], preferSharps: true },
        { id: 'minorPentatonic', name: 'Minor Pentatonic', intervals: [0, 3, 5, 7, 10], preferSharps: false }
      ]
    },
    {
      id: 'bluesScales',
      name: 'Blues Scales',
      scales: [
        { id: 'majorBlues', name: 'Major Blues', intervals: [0, 2, 3, 4, 7, 9], preferSharps: true },
        { id: 'minorBlues', name: 'Minor Blues', intervals: [0, 3, 5, 6, 7, 10], preferSharps: false }
      ]
    },
    {
      id: 'otherScales',
      name: 'Other Scales',
      scales: [
        { id: 'harmonicMinor', name: 'Harmonic Minor', intervals: [0, 2, 3, 5, 7, 8, 11], preferSharps: false },
        { id: 'melodicMinor', name: 'Melodic Minor', intervals: [0, 2, 3, 5, 7, 9, 11], preferSharps: false },
        { id: 'wholeTone', name: 'Whole Tone', intervals: [0, 2, 4, 6, 8, 10], preferSharps: true },
        { id: 'diminished', name: 'Diminished (H-W)', intervals: [0, 1, 3, 4, 6, 7, 9, 10], preferSharps: false },
        { id: 'augmented', name: 'Augmented', intervals: [0, 3, 4, 7, 8, 11], preferSharps: true }
      ]
    },
    {
      id: 'exoticScales',
      name: 'Exotic & World Scales',
      scales: [
        { id: 'hungarianMinor', name: 'Hungarian Minor', intervals: [0, 2, 3, 6, 7, 8, 11], preferSharps: false },
        { id: 'hungarianMajor', name: 'Hungarian Major', intervals: [0, 3, 4, 6, 7, 9, 10], preferSharps: true },
        { id: 'doubleHarmonic', name: 'Double Harmonic (Byzantine)', intervals: [0, 1, 4, 5, 7, 8, 11], preferSharps: false },
        { id: 'phrygianDominant', name: 'Phrygian Dominant', intervals: [0, 1, 4, 5, 7, 8, 10], preferSharps: false },
        { id: 'neapolitanMinor', name: 'Neapolitan Minor', intervals: [0, 1, 3, 5, 7, 8, 11], preferSharps: false },
        { id: 'neapolitanMajor', name: 'Neapolitan Major', intervals: [0, 1, 3, 5, 7, 9, 11], preferSharps: false },
        { id: 'enigmatic', name: 'Enigmatic', intervals: [0, 1, 4, 6, 8, 10, 11], preferSharps: true },
        { id: 'persian', name: 'Persian', intervals: [0, 1, 4, 5, 6, 8, 11], preferSharps: false },
        { id: 'arabic', name: 'Arabic (Major Locrian)', intervals: [0, 2, 4, 5, 6, 8, 10], preferSharps: false },
        { id: 'japanese', name: 'Japanese (Hirajoshi)', intervals: [0, 2, 3, 7, 8], preferSharps: false },
        { id: 'inSen', name: 'In-Sen', intervals: [0, 1, 5, 7, 10], preferSharps: false },
        { id: 'iwato', name: 'Iwato', intervals: [0, 1, 5, 6, 10], preferSharps: false }
      ]
    },
    {
      id: 'melodicMinorModes',
      name: 'Melodic Minor Modes',
      scales: [
        { id: 'melodicMinorMode1', name: 'Melodic Minor', intervals: [0, 2, 3, 5, 7, 9, 11], preferSharps: false },
        { id: 'dorianB2', name: 'Dorian ♭2 (Phrygian #6)', intervals: [0, 1, 3, 5, 7, 9, 10], preferSharps: false },
        { id: 'lydianAugmented', name: 'Lydian Augmented', intervals: [0, 2, 4, 6, 8, 9, 11], preferSharps: true },
        { id: 'lydianDominant', name: 'Lydian Dominant', intervals: [0, 2, 4, 6, 7, 9, 10], preferSharps: true },
        { id: 'mixolydianB6', name: 'Mixolydian ♭6', intervals: [0, 2, 4, 5, 7, 8, 10], preferSharps: true },
        { id: 'locrianNat2', name: 'Locrian ♮2 (Half-Diminished)', intervals: [0, 2, 3, 5, 6, 8, 10], preferSharps: false },
        { id: 'superLocrian', name: 'Super Locrian (Altered)', intervals: [0, 1, 3, 4, 6, 8, 10], preferSharps: false }
      ]
    },
    {
      id: 'harmonicMinorModes',
      name: 'Harmonic Minor Modes',
      scales: [
        { id: 'harmonicMinorMode1', name: 'Harmonic Minor', intervals: [0, 2, 3, 5, 7, 8, 11], preferSharps: false },
        { id: 'locrianNat6', name: 'Locrian ♮6', intervals: [0, 1, 3, 5, 6, 9, 10], preferSharps: false },
        { id: 'ionianAugmented', name: 'Ionian Augmented', intervals: [0, 2, 4, 5, 8, 9, 11], preferSharps: true },
        { id: 'dorianSharp4', name: 'Dorian #4 (Romanian)', intervals: [0, 2, 3, 6, 7, 9, 10], preferSharps: false },
        { id: 'phrygianDominantMode', name: 'Phrygian Dominant', intervals: [0, 1, 4, 5, 7, 8, 10], preferSharps: false },
        { id: 'lydianSharp2', name: 'Lydian #2', intervals: [0, 3, 4, 6, 7, 9, 11], preferSharps: true },
        { id: 'ultraLocrian', name: 'Ultra Locrian', intervals: [0, 1, 3, 4, 6, 8, 9], preferSharps: false }
      ]
    },
    {
      id: 'bebopScales',
      name: 'Bebop Scales',
      scales: [
        { id: 'bebopDominant', name: 'Bebop Dominant', intervals: [0, 2, 4, 5, 7, 9, 10, 11], preferSharps: true },
        { id: 'bebopMajor', name: 'Bebop Major', intervals: [0, 2, 4, 5, 7, 8, 9, 11], preferSharps: true },
        { id: 'bebopMinor', name: 'Bebop Minor', intervals: [0, 2, 3, 5, 7, 8, 9, 10], preferSharps: false },
        { id: 'bebopDorian', name: 'Bebop Dorian', intervals: [0, 2, 3, 4, 5, 7, 9, 10], preferSharps: false }
      ]
    }
  ];

  // Instruments definition
  private instruments: Instrument[] = [
    {
      id: 'guitar',
      name: 'Guitar',
      defaultTuning: 'standardGuitar',
      supportedStringCounts: [6, 7, 8]
    },
    {
      id: 'bassGuitar',
      name: 'Bass Guitar',
      defaultTuning: 'standard',
      supportedStringCounts: [4, 5, 6]
    },
    {
      id: 'piano',
      name: 'Piano/Keyboard',
      defaultTuning: 'standard88',
      supportedStringCounts: [88, 61, 49, 37, 25] // 88-key, 61-key, 49-key, 37-key, 25-key keyboards
    }
  ];
  // Bass guitar tunings (Standard bass: E2-A2-D3-G3 for audio playback)
  private bassTunings: Tunings = {    'standard': {
      name: 'Standard',
      strings: {
        '4': { notes: [7, 2, 9, 4], stringNames: ['G', 'D', 'A', 'E'], octaves: [3, 3, 2, 2] },
        '5': { notes: [7, 2, 9, 4, 11], stringNames: ['G', 'D', 'A', 'E', 'B'], octaves: [3, 3, 2, 2, 1] },
        '6': { notes: [0, 7, 2, 9, 4, 11], stringNames: ['C', 'G', 'D', 'A', 'E', 'B'], octaves: [4, 3, 3, 2, 2, 1] }
      }
    },    'dropD': {
      name: 'Drop D',
      strings: {
        '4': { notes: [7, 2, 9, 2], stringNames: ['G', 'D', 'A', 'D'], octaves: [3, 3, 2, 2] },
        '5': { notes: [7, 2, 9, 2, 9], stringNames: ['G', 'D', 'A', 'D', 'A'], octaves: [3, 3, 2, 2, 2] },
        '6': { notes: [7, 2, 9, 2, 9, 4], stringNames: ['G', 'D', 'A', 'D', 'A', 'E'], octaves: [3, 3, 2, 2, 2, 2] }
      }
    },
    'halfStep': {
      name: 'Half Step Down',
      strings: {
        '4': { notes: [6, 1, 8, 3], stringNames: ['Gb', 'Db', 'Ab', 'Eb'], octaves: [3, 3, 2, 2] },
        '5': { notes: [6, 1, 8, 3, 10], stringNames: ['Gb', 'Db', 'Ab', 'Eb', 'Bb'], octaves: [3, 3, 2, 2, 1] },
        '6': { notes: [6, 1, 8, 3, 10, 5], stringNames: ['Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F'], octaves: [3, 3, 2, 2, 1, 2] }
      }
    },
    'wholeStep': {
      name: 'Whole Step Down',
      strings: {
        '4': { notes: [5, 0, 7, 2], stringNames: ['F', 'C', 'G', 'D'], octaves: [3, 3, 2, 2] },
        '5': { notes: [5, 0, 7, 2, 9], stringNames: ['F', 'C', 'G', 'D', 'A'], octaves: [3, 3, 2, 2, 2] },
        '6': { notes: [5, 0, 7, 2, 9, 4], stringNames: ['F', 'C', 'G', 'D', 'A', 'E'], octaves: [4, 3, 3, 2, 2, 2] }
      }
    },
    'fifths': {
      name: 'All Fifths',
      strings: {
        '4': { notes: [9, 2, 7, 0], stringNames: ['A', 'D', 'G', 'C'], octaves: [2, 3, 3, 4] },
        '5': { notes: [9, 2, 7, 0, 5], stringNames: ['A', 'D', 'G', 'C', 'F'], octaves: [2, 3, 3, 4, 4] },
        '6': { notes: [9, 2, 7, 0, 5, 10], stringNames: ['A', 'D', 'G', 'C', 'F', 'Bb'], octaves: [2, 3, 3, 4, 4, 4] }
      }
    }
  };

  // Guitar tunings
  private guitarTunings: Tunings = {
    'standardGuitar': {
      name: 'Standard',
      strings: {
        '6': { notes: [4, 11, 7, 2, 9, 4], stringNames: ['E', 'B', 'G', 'D', 'A', 'E'], octaves: [4, 3, 3, 3, 2, 2] },
        '7': { notes: [4, 11, 7, 2, 9, 4, 11], stringNames: ['E', 'B', 'G', 'D', 'A', 'E', 'B'], octaves: [4, 3, 3, 3, 2, 2, 1] },
        '8': { notes: [4, 11, 7, 2, 9, 4, 11, 6], stringNames: ['E', 'B', 'G', 'D', 'A', 'E', 'B', 'F#'], octaves: [4, 3, 3, 3, 2, 2, 1, 1] }
      }
    },
    'dropDGuitar': {
      name: 'Drop D',
      strings: {
        '6': { notes: [4, 11, 7, 2, 9, 2], stringNames: ['E', 'B', 'G', 'D', 'A', 'D'], octaves: [4, 3, 3, 3, 2, 2] },
        '7': { notes: [4, 11, 7, 2, 9, 2, 9], stringNames: ['E', 'B', 'G', 'D', 'A', 'D', 'A'], octaves: [4, 3, 3, 3, 2, 2, 1] },
        '8': { notes: [4, 11, 7, 2, 9, 2, 9, 4], stringNames: ['E', 'B', 'G', 'D', 'A', 'D', 'A', 'E'], octaves: [4, 3, 3, 3, 2, 2, 1, 1] }
      }
    },
    'halfStepGuitar': {
      name: 'Half Step Down',
      strings: {
        '6': { notes: [3, 10, 6, 1, 8, 3], stringNames: ['Eb', 'Bb', 'Gb', 'Db', 'Ab', 'Eb'], octaves: [4, 3, 3, 3, 2, 2] },
        '7': { notes: [3, 10, 6, 1, 8, 3, 10], stringNames: ['Eb', 'Bb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb'], octaves: [4, 3, 3, 3, 2, 2, 1] },
        '8': { notes: [3, 10, 6, 1, 8, 3, 10, 5], stringNames: ['Eb', 'Bb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F'], octaves: [4, 3, 3, 3, 2, 2, 1, 1] }
      }
    },
    'wholeStepGuitar': {
      name: 'Whole Step Down',
      strings: {
        '6': { notes: [2, 9, 5, 0, 7, 2], stringNames: ['D', 'A', 'F', 'C', 'G', 'D'], octaves: [4, 3, 3, 3, 2, 2] },
        '7': { notes: [2, 9, 5, 0, 7, 2, 9], stringNames: ['D', 'A', 'F', 'C', 'G', 'D', 'A'], octaves: [4, 3, 3, 3, 2, 2, 1] },
        '8': { notes: [2, 9, 5, 0, 7, 2, 9, 4], stringNames: ['D', 'A', 'F', 'C', 'G', 'D', 'A', 'E'], octaves: [4, 3, 3, 3, 2, 2, 1, 1] }
      }
    },
    'openDGuitar': {
      name: 'Open D',
      strings: {
        '6': { notes: [2, 9, 6, 2, 9, 2], stringNames: ['D', 'A', 'F#', 'D', 'A', 'D'], octaves: [4, 3, 3, 3, 2, 2] },
        '7': { notes: [2, 9, 6, 2, 9, 2, 9], stringNames: ['D', 'A', 'F#', 'D', 'A', 'D', 'A'], octaves: [4, 3, 3, 3, 2, 2, 1] },
        '8': { notes: [2, 9, 6, 2, 9, 2, 9, 2], stringNames: ['D', 'A', 'F#', 'D', 'A', 'D', 'A', 'D'], octaves: [4, 3, 3, 3, 2, 2, 1, 1] }
      }
    },
    'openGGuitar': {
      name: 'Open G',
      strings: {
        '6': { notes: [2, 11, 7, 2, 7, 2], stringNames: ['D', 'B', 'G', 'D', 'G', 'D'], octaves: [4, 3, 3, 3, 2, 2] },
        '7': { notes: [2, 11, 7, 2, 7, 2, 7], stringNames: ['D', 'B', 'G', 'D', 'G', 'D', 'G'], octaves: [4, 3, 3, 3, 2, 2, 1] },
        '8': { notes: [2, 11, 7, 2, 7, 2, 7, 2], stringNames: ['D', 'B', 'G', 'D', 'G', 'D', 'G', 'D'], octaves: [4, 3, 3, 3, 2, 2, 1, 1] }
      }
    }
  };

  // Piano/Keyboard configurations
  // Piano keys are represented as octaves of notes starting from A0 (note index 9, octave 0)
  private pianoTunings: Tunings = {
    'standard88': {
      name: '88 Keys (Full)',
      strings: {
        '88': { 
          notes: this.generatePianoKeys(88, 9, 0), // A0 to C8
          stringNames: this.generatePianoKeyNames(88, 9, 0),
          octaves: this.generatePianoOctaves(88, 9, 0)
        }
      }
    },
    'standard61': {
      name: '61 Keys',
      strings: {
        '61': { 
          notes: this.generatePianoKeys(61, 0, 2), // C2 to C7
          stringNames: this.generatePianoKeyNames(61, 0, 2),
          octaves: this.generatePianoOctaves(61, 0, 2)
        }
      }
    },
    'standard49': {
      name: '49 Keys',
      strings: {
        '49': { 
          notes: this.generatePianoKeys(49, 0, 2), // C2 to C6
          stringNames: this.generatePianoKeyNames(49, 0, 2),
          octaves: this.generatePianoOctaves(49, 0, 2)
        }
      }
    },
    'standard37': {
      name: '37 Keys',
      strings: {
        '37': { 
          notes: this.generatePianoKeys(37, 0, 3), // C3 to C6
          stringNames: this.generatePianoKeyNames(37, 0, 3),
          octaves: this.generatePianoOctaves(37, 0, 3)
        }
      }
    },
    'standard25': {
      name: '25 Keys',
      strings: {
        '25': { 
          notes: this.generatePianoKeys(25, 0, 3), // C3 to C5
          stringNames: this.generatePianoKeyNames(25, 0, 3),
          octaves: this.generatePianoOctaves(25, 0, 3)
        }
      }
    }
  };

  // Combined tunings map (will be populated dynamically)
  private tunings: Tunings = {};
  // State management
  private state = new BehaviorSubject<MusicTheoryState>({
    selectedKey: 'C',
    selectedCategory: 'diatonicModes',
    selectedItem: 'ionian',
    selectedInstrument: 'bassGuitar',
    selectedTuning: 'standard',
    selectedStringCount: 4,
    showNashvilleNumbers: false
  });

  constructor() {
    // Initialize combined tunings
    this.updateTuningsByInstrument('bassGuitar');
    // Build unified categories
    this.buildUnifiedCategories();
  }

  // Build unified categories from scales and chords
  private buildUnifiedCategories(): void {
    this.unifiedCategories = [];

    // Add scale categories
    this.scaleCategories.forEach(category => {
      this.unifiedCategories.push({
        id: category.id,
        name: category.name,
        type: 'scale',
        itemLabel: 'Scale/Mode',
        items: category.scales.map(scale => ({
          id: scale.id,
          name: scale.name,
          intervals: scale.intervals,
          preferSharps: scale.preferSharps,
          type: 'scale' as const
        }))
      });
    });

    // Add chord categories
    this.chordCategories.forEach(category => {
      this.unifiedCategories.push({
        id: category.id,
        name: category.name,
        type: 'chord',
        itemLabel: 'Chord',
        items: category.chords.map(chord => ({
          id: chord.id,
          name: chord.name,
          intervals: chord.intervals,
          symbol: chord.symbol,
          type: 'chord' as const
        }))
      });
    });
  }

  // Update available tunings when instrument changes
  private updateTuningsByInstrument(instrumentId: string): void {
    // Reset tunings map
    this.tunings = {};
    
    // Load the appropriate tunings based on selected instrument
    if (instrumentId === 'bassGuitar') {
      Object.assign(this.tunings, this.bassTunings);
    } else if (instrumentId === 'guitar') {
      Object.assign(this.tunings, this.guitarTunings);
    } else if (instrumentId === 'piano') {
      Object.assign(this.tunings, this.pianoTunings);
    }
  }

  // Helper methods for generating piano keys
  private generatePianoKeys(keyCount: number, startNote: number, startOctave: number): number[] {
    const keys: number[] = [];
    let note = startNote;
    let octave = startOctave;
    
    for (let i = 0; i < keyCount; i++) {
      keys.push(note);
      note++;
      if (note >= 12) {
        note = 0;
        octave++;
      }
    }
    
    return keys;
  }

  private generatePianoKeyNames(keyCount: number, startNote: number, startOctave: number): string[] {
    const keyNames: string[] = [];
    let note = startNote;
    
    for (let i = 0; i < keyCount; i++) {
      keyNames.push(this.chromaticScaleWithSharps[note]);
      note++;
      if (note >= 12) {
        note = 0;
      }
    }
    
    return keyNames;
  }

  private generatePianoOctaves(keyCount: number, startNote: number, startOctave: number): number[] {
    const octaves: number[] = [];
    let note = startNote;
    let octave = startOctave;
    
    for (let i = 0; i < keyCount; i++) {
      octaves.push(octave);
      note++;
      if (note >= 12) {
        note = 0;
        octave++;
      }
    }
    
    return octaves;
  }

  // Get available instruments
  getInstruments(): Instrument[] {
    return this.instruments;
  }

  // Get the current instrument object
  getCurrentInstrument(): Instrument | undefined {
    const state = this.state.getValue();
    return this.instruments.find(instrument => instrument.id === state.selectedInstrument);
  }

  // State getters
  getState(): Observable<MusicTheoryState> {
    return this.state.asObservable();
  }

  getCurrentState(): MusicTheoryState {
    return this.state.getValue();
  }

  // State setters
  updateKey(key: string): void {
    this.state.next({
      ...this.state.getValue(),
      selectedKey: key
    });
  }

  updateCategory(category: string): void {
    const newState = { ...this.state.getValue(), selectedCategory: category };

    // Set first item of the new category as selected
    const selectedCategory = this.unifiedCategories.find(cat => cat.id === category);
    const firstItemInCategory = selectedCategory?.items[0]?.id || '';

    newState.selectedItem = firstItemInCategory;
    this.state.next(newState);
  }

  updateItem(itemId: string): void {
    this.state.next({
      ...this.state.getValue(),
      selectedItem: itemId
    });
  }

  updateInstrument(instrumentId: string): void {
    const instrument = this.instruments.find(inst => inst.id === instrumentId);
    if (!instrument) return;
    
    // Update tunings based on the selected instrument
    this.updateTuningsByInstrument(instrumentId);
    
    // Get current state to modify
    const currentState = this.state.getValue();
    const newState = { ...currentState, selectedInstrument: instrumentId };
    
    // Set default tuning and string count for this instrument
    newState.selectedTuning = instrument.defaultTuning;
    
    // For piano, default to 61 keys (good for 1080p screens), otherwise use first option
    if (instrumentId === 'piano') {
      newState.selectedStringCount = 61;
      newState.selectedTuning = 'standard61';
    } else {
      newState.selectedStringCount = instrument.supportedStringCounts[0];
    }
    
    this.state.next(newState);
  }

  updateTuning(tuning: string): void {
    this.state.next({
      ...this.state.getValue(),
      selectedTuning: tuning
    });
  }

  updateStringCount(count: number): void {
    this.state.next({
      ...this.state.getValue(),
      selectedStringCount: count
    });
  }

  toggleNashvilleNumbers(): void {
    const currentState = this.state.getValue();
    this.state.next({
      ...currentState,
      showNashvilleNumbers: !currentState.showNashvilleNumbers
    });
  }

  // Data getters
  getChromaticScale(): string[] {
    return this.chromaticScaleWithBoth;
  }

  getScaleCategories(): ScaleCategory[] {
    return this.scaleCategories;
  }

  // New unified category methods
  getUnifiedCategories(): MusicTheoryCategory[] {
    return this.unifiedCategories;
  }

  getCurrentCategory(): MusicTheoryCategory | undefined {
    const state = this.state.getValue();
    return this.unifiedCategories.find(cat => cat.id === state.selectedCategory);
  }

  getCurrentItems(): MusicTheoryItem[] {
    const category = this.getCurrentCategory();
    return category ? category.items : [];
  }

  getCurrentItem(): MusicTheoryItem | undefined {
    const state = this.state.getValue();
    const items = this.getCurrentItems();
    return items.find(item => item.id === state.selectedItem);
  }

  isChordCategory(): boolean {
    const category = this.getCurrentCategory();
    return category?.type === 'chord';
  }

  getTunings(): Tunings {
    return this.tunings;
  }

  getCurrentScales(): Scale[] {
    const state = this.state.getValue();
    const category = this.scaleCategories.find(cat => cat.id === state.selectedCategory);
    return category ? category.scales : [];
  }

  getCurrentScaleObject(): Scale | undefined {
    const state = this.state.getValue();
    const scales = this.getCurrentScales();
    return scales.find(scale => scale.id === state.selectedItem);
  }

  // Utility methods
  shouldUseSharps(): boolean {
    const state = this.state.getValue();
    const currentItem = this.getCurrentItem();

    if (!currentItem) return true;

    // For fretboard notes, respect the explicit selection
    if (state.selectedCategory === 'fretboardNotes') {
      if (state.selectedItem === 'allNotesSharp' || state.selectedItem === 'sharps') {
        return true;
      }
      if (state.selectedItem === 'allNotesFlat' || state.selectedItem === 'flats') {
        return false;
      }
    }

    // If the key is a flat key, prefer flats
    if (this.flatKeys.includes(state.selectedKey)) {
      return false;
    }

    // For certain keys with accidentals, make specific decisions
    if (state.selectedKey.includes('#') || state.selectedKey.includes('b')) {
      // If key has a # in it, prefer sharps, if it has a b, prefer flats
      return state.selectedKey.includes('#');
    }

    // Otherwise use the item's preference (scales have preferSharps, chords default to true)
    return currentItem.preferSharps !== undefined ? currentItem.preferSharps : true;
  }

  getChromatic(): string[] {
    return this.shouldUseSharps() ? this.chromaticScaleWithSharps : this.chromaticScaleWithFlats;
  }

  getNoteIndex(noteName: string): number {
    // Handle both formats, e.g. both "C#" and "C#/Db" should map to index 1
    if (noteName.includes('/')) {
      return this.chromaticScaleWithBoth.indexOf(noteName);
    }
    
    // For simple notes, check in both scales
    const sharpIndex = this.chromaticScaleWithSharps.indexOf(noteName);
    if (sharpIndex !== -1) return sharpIndex;
    
    const flatIndex = this.chromaticScaleWithFlats.indexOf(noteName);
    return flatIndex;
  }

  getNoteName(noteIndex: number): string {
    return this.getChromatic()[noteIndex % 12];
  }

  getNashvilleNumber(noteIndex: number, keyIndex: number): string {
    // Calculate the interval relative to the key
    const interval = (noteIndex - keyIndex + 12) % 12;
    return this.nashvilleNumbers[interval];
  }

  isKeyDisabled(): boolean {
    const state = this.state.getValue();
    return state.selectedCategory === 'fretboardNotes' &&
           (state.selectedItem === 'allNotesSharp' ||
            state.selectedItem === 'allNotesFlat' ||
            state.selectedItem === 'naturalNotes' ||
            state.selectedItem === 'sharps' ||
            state.selectedItem === 'flats');
  }

  // Generate mode notes based on selected key and item (scale or chord)
  generateModeNotes(): number[] {
    const state = this.state.getValue();
    const keyIndex = this.getNoteIndex(state.selectedKey);
    const currentItem = this.getCurrentItem();

    if (!currentItem) return [];

    // For fretboard notes options, handle specifically
    if (state.selectedCategory === 'fretboardNotes') {
      if (state.selectedItem === 'allNotesSharp' || state.selectedItem === 'allNotesFlat') {
        return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]; // All notes
      }
      if (state.selectedItem === 'naturalNotes') {
        return [0, 2, 4, 5, 7, 9, 11]; // Natural notes C, D, E, F, G, A, B regardless of key
      }
      if (state.selectedItem === 'sharps' || state.selectedItem === 'flats') {
        return [1, 3, 6, 8, 10]; // Sharp/flat notes C#/Db, D#/Eb, F#/Gb, G#/Ab, A#/Bb regardless of key
      }
    }

    // For other categories (scales/modes/chords), calculate notes based on the key
    return currentItem.intervals.map((interval: number) => {
      return (keyIndex + interval) % 12;
    });
  }

  // Generate fretboard data
  generateFretboard(): FretNote[][] {
    const state = this.state.getValue();
    const frets = 15; // Expanded from 12 to 15 frets
    const strings = state.selectedStringCount; // 4, 5, or 6 strings
    const modeNotes = this.generateModeNotes();
    const rootNoteIndex = this.getNoteIndex(state.selectedKey);
    const currentTuning = this.tunings[state.selectedTuning].strings[state.selectedStringCount.toString()];
    
    if (!currentTuning) {
      return [];
    }
    
    const fretboard: FretNote[][] = [];
    
    for (let stringIndex = 0; stringIndex < strings; stringIndex++) {
      const openStringNote = currentTuning.notes[stringIndex];
      const openStringOctave = (currentTuning as any).octaves ? (currentTuning as any).octaves[stringIndex] : 2;      // Calculate all notes (including open string as fret 0)
      const stringNotes: FretNote[] = [];
      for (let fret = 0; fret <= frets; fret++) {
        const totalSemitones = openStringNote + fret;
        const noteValue = totalSemitones % 12;
        const octave = openStringOctave + Math.floor(totalSemitones / 12);

        stringNotes.push({
          fret,
          noteValue,
          noteName: this.getNoteName(noteValue),
          octave: octave,
          nashvilleNumber: this.getNashvilleNumber(noteValue, rootNoteIndex),
          isRoot: noteValue === rootNoteIndex,
          isInMode: modeNotes.includes(noteValue)
        });
      }
      
      fretboard.push(stringNotes);
    }
    
    return fretboard;
  }

  // Generate keyboard data (for piano)
  generateKeyboard(): FretNote[] {
    const state = this.state.getValue();
    const keyCount = state.selectedStringCount; // For piano, "string count" means number of keys
    const modeNotes = this.generateModeNotes();
    const rootNoteIndex = this.getNoteIndex(state.selectedKey);
    const currentTuning = this.tunings[state.selectedTuning].strings[state.selectedStringCount.toString()];
    
    if (!currentTuning) {
      return [];
    }
    
    const keys: FretNote[] = [];
    
    for (let keyIndex = 0; keyIndex < keyCount; keyIndex++) {
      const noteValue = currentTuning.notes[keyIndex];
      const octave = (currentTuning as any).octaves ? (currentTuning as any).octaves[keyIndex] : 4;

      keys.push({
        fret: keyIndex, // Using fret property to store key index
        noteValue,
        noteName: this.getNoteName(noteValue),
        octave: octave,
        nashvilleNumber: this.getNashvilleNumber(noteValue, rootNoteIndex),
        isRoot: noteValue === rootNoteIndex,
        isInMode: modeNotes.includes(noteValue)
      });
    }
    
    return keys;
  }

  // Format the formula as note names
  getFormulaAsNotes(): string {
    const state = this.state.getValue();
    const keyIndex = this.getNoteIndex(state.selectedKey);
    const currentItem = this.getCurrentItem();

    if (!currentItem) return '';

    // For special Fretboard Notes options, show fixed formulas
    if (state.selectedCategory === 'fretboardNotes') {
      if (state.selectedItem === 'allNotesSharp' || state.selectedItem === 'allNotesFlat') {
        return "All 12 notes of the chromatic scale";
      }
      if (state.selectedItem === 'naturalNotes') {
        return "C - D - E - F - G - A - B";
      }
      if (state.selectedItem === 'sharps') {
        return "C# - D# - F# - G# - A#";
      }
      if (state.selectedItem === 'flats') {
        return "Db - Eb - Gb - Ab - Bb";
      }
    }

    // Generate formula with Nashville numbers if enabled
    const intervals = currentItem.intervals;

    if (state.showNashvilleNumbers && !this.isKeyDisabled()) {
      const noteNames = intervals.map((interval: number) => {
        const noteIndex = (keyIndex + interval) % 12;
        return `${this.getNoteName(noteIndex)} (${this.nashvilleNumbers[interval]})`;
      });
      return noteNames.join(' - ');
    }

    // Otherwise show just the note names
    return intervals.map((interval: number) => {
      return this.getNoteName((keyIndex + interval) % 12);
    }).join(' - ');
  }

  // Format Nashville numbers formula
  getFormulaAsNashville(): string {
    const state = this.state.getValue();
    const currentItem = this.getCurrentItem();

    if (!currentItem) return '';

    // Only show for applicable scales
    if (state.selectedCategory === 'fretboardNotes' || this.isKeyDisabled()) {
      return "";
    }

    // Map intervals to Nashville numbers
    return currentItem.intervals.map((interval: number) => {
      return this.nashvilleNumbers[interval];
    }).join(' - ');
  }

  // Get display name for current item
  getItemDisplayName(): string {
    const state = this.state.getValue();
    const currentItem = this.getCurrentItem();
    const category = this.getCurrentCategory();

    if (!currentItem || !category) return '';

    // For chords, show key + symbol (e.g., "Gmaj7")
    if (category.type === 'chord' && currentItem.symbol !== undefined) {
      return `${state.selectedKey}${currentItem.symbol}`;
    }

    // For scales, show scale name
    return currentItem.name;
  }

  // Legacy methods for backward compatibility (kept for component)
  getChordCategories(): ChordCategory[] {
    return this.chordCategories;
  }

  getCurrentChords(): Chord[] {
    const items = this.getCurrentItems();
    return items.map(item => ({
      id: item.id,
      name: item.name,
      intervals: item.intervals,
      symbol: item.symbol || ''
    }));
  }

  getCurrentChordObject(): Chord | undefined {
    const item = this.getCurrentItem();
    if (!item || item.type !== 'chord') return undefined;
    return {
      id: item.id,
      name: item.name,
      intervals: item.intervals,
      symbol: item.symbol || ''
    };
  }
}