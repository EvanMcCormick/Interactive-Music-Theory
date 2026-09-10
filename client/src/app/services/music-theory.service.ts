import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  Scale,
  ScaleCategory,
  FretNote,
  Tunings,
  Instrument,
  MusicTheoryState,
  ChordCategory,
  MusicTheoryCategory,
  MusicTheoryItem
} from '../models/music-theory.model';
import { CHORD_CATEGORIES } from './chord-catalog';
import { SpellingSelection, noteName, preferSharps } from './note-naming';

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

  /**
   * The chord table, which left this file when M3 Task 5 added a category to
   * it: reference data with no state around it is the part of a service that is
   * not a service, and `circle-of-fifths.data.ts` had gone the same way before
   * it. `chord-catalog.ts` argues the move, and holds the guardrail that no
   * interval array moved in it.
   *
   * This is the module-level array itself and not a copy of it, so every
   * instance of this service shares one and `getChordCategories` hands that one
   * out. `readonly` on both is what makes the guardrail a compiler's business
   * rather than a docstring's.
   */
  private readonly chordCategories: readonly ChordCategory[] = CHORD_CATEGORIES;

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
          // Carried through so a chord tone can be spelled by its place in the
          // chord rather than by whichever of twelve names shares its pitch.
          steps: chord.steps,
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
  /**
   * A `rootSpelling` is valid only with the selection it arrived with, and each
   * of the three setters below drops it for that reason.
   *
   * The guard in `note-naming.ts` tests the *pitch class*, which is why it is
   * not enough on its own: a spelling survives any change that leaves the key
   * where it was, and the item is half of what a spelling is for. B ionian under
   * a `Cb` left behind by a B flat major ♭II printed `Cb Db Eb Fb Gb Ab Bb` -
   * every letter in flats, an `F♭` among them, under a key field reading `B`.
   */
  updateKey(key: string): void {
    this.state.next({
      ...this.state.getValue(),
      selectedKey: key,
      rootSpelling: undefined
    });
  }

  updateCategory(category: string): void {
    const newState = { ...this.state.getValue(), selectedCategory: category, rootSpelling: undefined };

    // Set first item of the new category as selected
    const selectedCategory = this.unifiedCategories.find(cat => cat.id === category);
    const firstItemInCategory = selectedCategory?.items[0]?.id || '';

    newState.selectedItem = firstItemInCategory;
    this.state.next(newState);
  }

  updateItem(itemId: string): void {
    this.state.next({
      ...this.state.getValue(),
      selectedItem: itemId,
      rootSpelling: undefined
    });
  }

  /**
   * Sets the key and the mode together, in one emission.
   *
   * `updateCategory` deliberately resets `selectedItem` to the first item of the
   * category it moves to, so a caller that wants a particular key *and* a
   * particular mode cannot get there with the setters above without either
   * fighting that reset or emitting three times - and three emissions is three
   * re-renders of the fretboard for one user action.
   *
   * Added for the circle of fifths, where every click means exactly this:
   * clicking C sets C ionian, clicking its inner ring sets A aeolian. Nothing
   * else needs it yet, and it stays here rather than in the component because
   * this is where state transitions live.
   *
   * `rootSpelling` is for the second caller, the progression composer lighting
   * its own chord. `key` has to stay one of the twelve table names because the
   * key dropdown and `getNoteIndex` both compare against them, and the chord
   * the composer is lighting can be rooted on a `C♭`, which is not one of them.
   * So the name and the spelling travel separately, and the argument is
   * optional because every other caller's key spells itself. Omitting it clears
   * whatever the last caller set: see `MusicTheoryState.rootSpelling`.
   */
  selectKeyAndMode(key: string, categoryId: string, itemId: string, rootSpelling?: string): void {
    this.state.next({
      ...this.state.getValue(),
      selectedKey: key,
      selectedCategory: categoryId,
      selectedItem: itemId,
      rootSpelling
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

  // `findChordCategory` stood here and had no caller in the app or in a spec.
  // It answered which category holds a chord id, for a caller that knew only
  // which chord it wanted; the progression was that caller until M3 Task 5
  // rewrote `chordFor` to look a chord up by its intervals instead, which
  // answers the category and the id together. The same commit removed two other
  // methods on exactly this ground and left this one behind. Its argument
  // survives where it is still load-bearing: `findChordByIntervals` searches
  // chord categories only, and says why - `diminished` and `augmented` are each
  // both a triad and a scale here, so an id is unique within a category and not
  // across them.

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

  /**
   * Whether the app spells this selection with sharps.
   *
   * The rule and its six clauses are in `note-naming.ts`, beside the letter
   * arithmetic that starts from its answer - two questions about one subject,
   * neither of them a piece of state. This is the app-wide caller of it, and it
   * stays a method here because that is the call every surface already makes.
   */
  shouldUseSharps(): boolean {
    return preferSharps(this.selection());
  }

  /**
   * The selection, reduced to what a spelling rule needs. See `note-naming.ts`.
   */
  private selection(): SpellingSelection {
    const state = this.state.getValue();

    return {
      categoryId: state.selectedCategory,
      itemId: state.selectedItem,
      keyName: state.selectedKey,
      keyIndex: this.getNoteIndex(state.selectedKey),
      item: this.getCurrentItem(),
      rootSpelling: state.rootSpelling
    };
  }

  /**
   * How the fretboard and the keyboard name a note: by the letter its degree or
   * its place in the chord gives it, falling back to the chromatic tables where
   * neither applies. `note-naming.ts` holds the rule and every reason it falls
   * back.
   */
  noteNameFor(noteValue: number): string {
    return this.nameNote(noteValue, this.selection());
  }

  /**
   * The same answer for a caller that already has the selection in hand.
   *
   * `noteNameFor` rebuilt the selection two to four times for every note it
   * named - once itself and once more inside `getNoteName`, each of those
   * reading the subject, resolving the category and searching it for the item -
   * and `generateKeyboard` names 88 notes on every emission. The surfaces below
   * build it once per render and pass it down.
   */
  private nameNote(noteValue: number, selection: SpellingSelection): string {
    return noteName(noteValue, selection) ?? this.spellNote(noteValue, preferSharps(selection));
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
    return this.spellNote(noteIndex, this.shouldUseSharps());
  }

  /**
   * Spells a pitch class with the accidentals the caller asks for.
   *
   * `getNoteName` is this with the app-wide answer already filled in, and that
   * is the right default for the fretboard and the keyboard, which draw the
   * key this service has selected. It is the wrong one for a page in a key of
   * its own: the progression composer carries its own key and its own
   * `preferSharps`, and asking the app-wide rule spelled E flat major from
   * whatever the fretboard behind it happened to be in.
   *
   * The two chromatic tables stay here rather than being exported, so there is
   * still one place a note name is written down.
   */
  spellNote(noteIndex: number, preferSharps: boolean): string {
    const chromatic = preferSharps ? this.chromaticScaleWithSharps : this.chromaticScaleWithFlats;
    return chromatic[noteIndex % 12];
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

  /**
   * Whether the current selection names a key at all.
   *
   * Three kinds of thing can be selected here and only one of them is a key.
   * A chord is a shape rather than a tonality, and `triads`, `seventh`,
   * `extended` and `alterations` are all reachable from the fretboard's own
   * category dropdown. The five `fretboardNotes` entries are display modes:
   * "All Notes (Sharps)" is not a key with a sharp in it, it is every note on
   * the neck - which is precisely what `isKeyDisabled` above says, since it is
   * what greys out this service's own key selector for them.
   *
   * Written as one method because the progression composer needs the answer and
   * had been asking a different question for it. `getCurrentScaleObject()`
   * being truthy is "does the selected item resolve to a scale", and that
   * answers *no* to a chord the user chose deliberately and *yes* to a
   * fretboard display mode - wrong in both directions, and the second one put
   * a progression into a key called "Natural Notes (No Sharps/Flats)".
   *
   * A category this service cannot resolve answers false, which is the honest
   * reading rather than a defensive one: there is no category to ask what kind
   * of thing it holds.
   */
  isKeySelection(): boolean {
    return this.getCurrentCategory()?.type === 'scale' && !this.isKeyDisabled();
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

    const selection = this.selection();
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
          noteName: this.nameNote(noteValue, selection),
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

    const selection = this.selection();
    const keys: FretNote[] = [];

    for (let keyIndex = 0; keyIndex < keyCount; keyIndex++) {
      const noteValue = currentTuning.notes[keyIndex];
      const octave = (currentTuning as any).octaves ? (currentTuning as any).octaves[keyIndex] : 4;

      keys.push({
        fret: keyIndex, // Using fret property to store key index
        noteValue,
        noteName: this.nameNote(noteValue, selection),
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
        return `${this.noteNameFor(noteIndex)} (${this.nashvilleNumbers[interval]})`;
      });
      return noteNames.join(' - ');
    }

    // Otherwise show just the note names
    return intervals.map((interval: number) => {
      return this.noteNameFor((keyIndex + interval) % 12);
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
  getChordCategories(): readonly ChordCategory[] {
    return this.chordCategories;
  }

  // `getCurrentChords` and `getCurrentChordObject` stood here and had no caller
  // in the app or in a spec. They rebuilt a `Chord` out of a `MusicTheoryItem`,
  // which since M3 Task 5 cannot be done at all - `steps` is a fact about a
  // chord that the unified item does not carry, and the two would have had to
  // invent an empty one. Removed rather than filled with a value that breaks the
  // field's own invariant.
}