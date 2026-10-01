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
  /** Current playback position in milliseconds */
  timePosition: number;
  /** Total duration in milliseconds */
  totalDuration: number;
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
 * Settings for alphaTab initialization
 */
export interface AlphaTabSettings {
  /** Core settings */
  core?: {
    /** Font directory path */
    fontDirectory?: string;
    /** Whether to use web workers */
    useWorkers?: boolean;
    /**
     * Whether to record where each individual note was drawn.
     *
     * Off in alphaTab by default, and the gate on `noteMouseDown`: the click
     * handler asks `boundsLookup.getNoteAtPos` for the note under the pointer
     * and only fires the event when it has one, so a renderer that never
     * recorded note bounds reports beats and nothing finer. A panel that wants
     * to know *which note* was clicked - the transcription review, whose whole
     * gesture is overruling one note - has to ask for this.
     *
     * It costs a rectangle per note in the lookup, which is why the composer,
     * where the beat is the unit of selection, starts with it off and turns it
     * on only when its scale panel first opens, for the highlight to read
     * (`AlphaTabService.setNoteBounds`).
     */
    includeNoteBounds?: boolean;
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
    /**
     * Stretch the final system to the full width instead of leaving it short.
     *
     * alphaTab defaults this off, which is the printed-page convention. A
     * preview of a few bars is the case it reads wrongly: the only system is
     * also the last one, so the music draws at its natural width and the rest
     * of the panel stays blank. See `ProgressionNotationComponent`, which turns
     * it on for exactly that reason.
     */
    justifyLastSystem?: boolean;
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
 * A library entry as the library lists it: everything but the file. A list of every file is read on the first visit to
 * the gallery or the composer and kept for the session, so it holds no bytes; what needs them - opening a file - reads
 * that one entry (`GpLibraryService.getEntry`). As `CompositionSummary` is to a saved composition.
 */
export type GpLibrarySummary = Omit<GpLibraryEntry, 'fileData'>;

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
  timePosition: 0,
  totalDuration: 0,
  tempoMultiplier: 1.0,
  volume: 1.0,
  isLooping: false,
  loadingState: 'idle',
  errorMessage: null
};
