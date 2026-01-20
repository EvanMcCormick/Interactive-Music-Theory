/**
 * alphaTab integration models for Guitar Pro file viewing
 */

// Note: alphaTab types are accessed via the alphaTab namespace, not direct imports
// Use 'any' for Score type since it's not directly exported

/**
 * State for the alphaTab player and renderer
 */
export interface AlphaTabState {
  /** Whether a score is currently loaded */
  isLoaded: boolean;
  /** Whether audio is currently playing */
  isPlaying: boolean;
  /** Whether the player is ready for playback */
  isReadyForPlayback: boolean;
  /** Current playback position in ticks */
  tickPosition: number;
  /** Current playback position in milliseconds */
  timePosition: number;
  /** Total duration in milliseconds */
  totalDuration: number;
  /** The loaded score (null if none loaded) - uses alphaTab's Score type */
  score: any | null;
  /** Currently selected track indices */
  selectedTracks: number[];
  /** Current playback tempo multiplier (1.0 = normal) */
  tempoMultiplier: number;
  /** Master volume (0-1) */
  volume: number;
  /** Whether playback loops */
  isLooping: boolean;
  /** Loading/error state */
  loadingState: 'idle' | 'loading' | 'loaded' | 'error';
  /** Error message if loadingState is 'error' */
  errorMessage: string | null;
}

/**
 * Simplified track info for UI display
 */
export interface GpTrackInfo {
  /** Track index */
  index: number;
  /** Track display name */
  name: string;
  /** Short name (abbreviation) */
  shortName: string;
  /** Track color (hex string) */
  color: string;
  /** Whether track is muted */
  isMuted: boolean;
  /** Whether track is soloed */
  isSolo: boolean;
  /** Whether this is a percussion track */
  isPercussion: boolean;
  /** MIDI channel */
  channel: number;
  /** MIDI program (instrument) */
  program: number;
}

/**
 * Simplified score info for UI display
 */
export interface GpScoreInfo {
  /** Song title */
  title: string;
  /** Song subtitle */
  subtitle: string;
  /** Artist name */
  artist: string;
  /** Album name */
  album: string;
  /** Copyright info */
  copyright: string;
  /** Tab author */
  tabAuthor: string;
  /** Initial tempo in BPM */
  tempo: number;
  /** Number of tracks */
  trackCount: number;
  /** Number of bars */
  barCount: number;
}

/**
 * Settings for alphaTab initialization
 */
export interface AlphaTabSettings {
  /** Core settings */
  core?: {
    /** Font directory path */
    fontDirectory?: string;
    /** Whether to use web workers */
    useWorkers?: boolean;
    /** Log level */
    logLevel?: number;
  };
  /** Display settings */
  display?: {
    /** Scale factor (1.0 = 100%) */
    scale?: number;
    /** Stave profile: 'default', 'score', 'tab', 'tabMixed' */
    staveProfile?: string;
    /** Layout mode: 'page' or 'horizontal' */
    layoutMode?: 'page' | 'horizontal';
    /** Bar count per row (for page layout) */
    barsPerRow?: number;
  };
  /** Player settings */
  player?: {
    /** Enable audio player */
    enablePlayer?: boolean;
    /** Enable cursor following */
    enableCursor?: boolean;
    /** Enable user interaction (click to seek) */
    enableUserInteraction?: boolean;
    /** SoundFont file path */
    soundFont?: string;
    /** Element to scroll when cursor moves */
    scrollElement?: HTMLElement | string;
    /** Scroll mode */
    scrollMode?: 'continuous' | 'off' | 'offScreen';
  };
  /** Notation settings */
  notation?: {
    /** Show rhythm notation */
    rhythmMode?: 'hidden' | 'showWithBars' | 'showWithBeams';
    /** Show fingering */
    fingeringMode?: 'score' | 'singleNoteEffectBand' | 'singleNoteEffectBandForcePiano';
  };
}

/**
 * GP Library entry stored in IndexedDB
 */
export interface GpLibraryEntry {
  /** Unique ID */
  id: string;
  /** Original filename */
  fileName: string;
  /** File size in bytes */
  fileSize: number;
  /** File data as ArrayBuffer */
  fileData: ArrayBuffer;
  /** Song title */
  title: string;
  /** Artist name */
  artist?: string;
  /** Album name */
  album?: string;
  /** Initial tempo in BPM */
  tempo?: number;
  /** Number of tracks */
  trackCount?: number;
  /** Detected key signature (0-11, where 0=C) */
  key?: number;
  /** Detected scales used (scale IDs) */
  detectedScales?: string[];
  /** Detected chords used (chord IDs) */
  detectedChords?: string[];
  /** Date added to library */
  dateAdded: Date;
  /** Last opened date */
  lastOpened?: Date;
  /** User tags */
  tags?: string[];
}

/**
 * Filter options for GP library search
 */
export interface GpLibraryFilter {
  /** Search text (matches title, artist, filename) */
  searchText?: string;
  /** Filter by key (0-11) */
  key?: number;
  /** Filter by scale IDs */
  scaleIds?: string[];
  /** Filter by chord IDs */
  chordIds?: string[];
  /** Filter by tags */
  tags?: string[];
}

/**
 * Scale/chord highlighting configuration
 */
export interface HighlightConfig {
  /** Whether highlighting is enabled */
  enabled: boolean;
  /** Root note value (0-11, where 0=C) */
  rootNote: number;
  /** Intervals to highlight (semitones from root) */
  intervals: number[];
  /** Name of the scale/chord being highlighted */
  name: string;
  /** Type: 'scale' or 'chord' */
  type: 'scale' | 'chord';
}

/**
 * Default highlight config (disabled)
 */
export const DEFAULT_HIGHLIGHT_CONFIG: HighlightConfig = {
  enabled: false,
  rootNote: 0,
  intervals: [],
  name: '',
  type: 'scale'
};

/**
 * Default state for alphaTab
 */
export const DEFAULT_ALPHA_TAB_STATE: AlphaTabState = {
  isLoaded: false,
  isPlaying: false,
  isReadyForPlayback: false,
  tickPosition: 0,
  timePosition: 0,
  totalDuration: 0,
  score: null,
  selectedTracks: [],
  tempoMultiplier: 1.0,
  volume: 1.0,
  isLooping: false,
  loadingState: 'idle',
  errorMessage: null
};
