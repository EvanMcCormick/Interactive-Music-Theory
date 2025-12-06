export interface Scale {
  id: string;
  name: string;
  intervals: number[];
  preferSharps: boolean;
}

export interface Chord {
  id: string;
  name: string;
  intervals: number[];
  symbol: string;
}

// Unified item that can be either a scale or chord
export interface MusicTheoryItem {
  id: string;
  name: string;
  intervals: number[];
  preferSharps?: boolean;
  symbol?: string;
  type: 'scale' | 'chord';
}

// Unified category that contains scales or chords
export interface MusicTheoryCategory {
  id: string;
  name: string;
  type: 'scale' | 'chord';
  items: MusicTheoryItem[];
  itemLabel: string; // "Scale/Mode" or "Chord"
}

// Legacy interfaces for backward compatibility
export interface ScaleCategory {
  id: string;
  name: string;
  scales: Scale[];
}

export interface ChordCategory {
  id: string;
  name: string;
  chords: Chord[];
}

export interface TuningString {
  notes: number[];
  stringNames: string[];
  octaves?: number[];
}

export interface Tuning {
  name: string;
  strings: {
    [key: string]: TuningString;
  };
}

export interface Tunings {
  [key: string]: Tuning;
}

export interface Instrument {
  id: string;
  name: string;
  defaultTuning: string;
  supportedStringCounts: number[];
}

export interface FretNote {
  fret: number;
  noteValue: number;
  noteName: string;
  octave: number;
  nashvilleNumber: string;
  isRoot: boolean;
  isInMode: boolean;
}

export interface MusicTheoryState {
  selectedKey: string;
  selectedCategory: string;
  selectedItem: string;
  selectedInstrument: string;
  selectedTuning: string;
  selectedStringCount: number;
  showNashvilleNumbers: boolean;
}