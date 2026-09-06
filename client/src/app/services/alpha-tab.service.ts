import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  AlphaTabState,
  GpTrackInfo,
  GpScoreInfo,
  AlphaTabSettings,
  DEFAULT_ALPHA_TAB_STATE
} from '../models/alpha-tab.model';
import * as alphaTab from '@coderline/alphatab';

/**
 * Service for managing alphaTab API interactions
 * Provides state management via BehaviorSubject following MusicTheoryService pattern
 */
@Injectable({
  providedIn: 'root'
})
export class AlphaTabService {
  private stateSubject = new BehaviorSubject<AlphaTabState>(DEFAULT_ALPHA_TAB_STATE);
  private api: alphaTab.AlphaTabApi | null = null;

  constructor(private ngZone: NgZone) {}

  /**
   * Get the current state as an Observable
   */
  getState(): BehaviorSubject<AlphaTabState> {
    return this.stateSubject;
  }

  /**
   * Get current state value
   */
  getCurrentState(): AlphaTabState {
    return this.stateSubject.getValue();
  }

  /**
   * Update state with partial values
   */
  private updateState(partial: Partial<AlphaTabState>): void {
    this.stateSubject.next({ ...this.stateSubject.getValue(), ...partial });
  }

  /**
   * Initialize alphaTab API on a DOM element
   */
  initializeApi(element: HTMLElement, settings?: AlphaTabSettings): void {
    if (this.api) {
      this.dispose();
    }

    const defaultSettings: alphaTab.Settings = new alphaTab.Settings();

    // Core settings
    defaultSettings.core.fontDirectory = settings?.core?.fontDirectory ?? '/assets/font/';
    defaultSettings.core.useWorkers = settings?.core?.useWorkers ?? true;
    // alphaTab's own default, restated: `noteMouseDown` never fires without
    // it, so a caller that wants note-level clicks has to say so.
    defaultSettings.core.includeNoteBounds = settings?.core?.includeNoteBounds ?? false;

    // Display settings
    defaultSettings.display.scale = settings?.display?.scale ?? 1.0;
    defaultSettings.display.staveProfile = this.parseStaveProfile(settings?.display?.staveProfile);
    defaultSettings.display.layoutMode = settings?.display?.layoutMode === 'horizontal'
      ? alphaTab.LayoutMode.Horizontal
      : alphaTab.LayoutMode.Page;

    // Player settings
    defaultSettings.player.enablePlayer = settings?.player?.enablePlayer ?? true;
    defaultSettings.player.enableCursor = settings?.player?.enableCursor ?? true;
    defaultSettings.player.enableUserInteraction = settings?.player?.enableUserInteraction ?? true;
    defaultSettings.player.soundFont = settings?.player?.soundFont ?? '/assets/soundfont/sonivox.sf2';

    if (settings?.player?.scrollElement) {
      if (typeof settings.player.scrollElement === 'string') {
        const scrollEl = document.querySelector(settings.player.scrollElement);
        if (scrollEl) {
          defaultSettings.player.scrollElement = scrollEl as HTMLElement;
        }
      } else {
        defaultSettings.player.scrollElement = settings.player.scrollElement;
      }
    }

    this.api = new alphaTab.AlphaTabApi(element, defaultSettings);
    this.setupEventListeners();
  }

  /**
   * Parse stave profile string to enum
   */
  private parseStaveProfile(profile?: string): alphaTab.StaveProfile {
    switch (profile) {
      case 'score': return alphaTab.StaveProfile.Score;
      case 'tab': return alphaTab.StaveProfile.Tab;
      case 'tabMixed': return alphaTab.StaveProfile.TabMixed;
      default: return alphaTab.StaveProfile.Default;
    }
  }

  /**
   * Set up alphaTab event listeners
   */
  private setupEventListeners(): void {
    if (!this.api) return;

    // Score loaded
    this.api.scoreLoaded.on((score) => {
      this.ngZone.run(() => {
        this.updateState({
          isLoaded: true,
          score: score,
          selectedTracks: score.tracks.map((_, i) => i),
          loadingState: 'loaded',
          errorMessage: null
        });
      });
    });

    // Player ready
    this.api.playerReady.on(() => {
      this.ngZone.run(() => {
        this.updateState({ isReadyForPlayback: true });
      });
    });

    // Player state changed
    this.api.playerStateChanged.on((args) => {
      this.ngZone.run(() => {
        this.updateState({
          isPlaying: args.state === alphaTab.synth.PlayerState.Playing
        });
      });
    });

    // Position changed
    this.api.playerPositionChanged.on((args) => {
      this.ngZone.run(() => {
        this.updateState({
          tickPosition: args.currentTick,
          timePosition: args.currentTime,
          totalDuration: args.endTime
        });
      });
    });

    // Error handling
    this.api.error.on((error) => {
      this.ngZone.run(() => {
        console.error('alphaTab error:', error);
        this.updateState({
          loadingState: 'error',
          errorMessage: error.message || 'Unknown error occurred'
        });
      });
    });
  }

  /**
   * Load a Guitar Pro file from a File object
   */
  async loadFile(file: File): Promise<void> {
    if (!this.api) {
      throw new Error('alphaTab API not initialized');
    }

    this.updateState({ loadingState: 'loading', errorMessage: null });

    try {
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      this.api.load(uint8Array, [0]); // Load first track by default
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load file';
      this.updateState({ loadingState: 'error', errorMessage: message });
      throw error;
    }
  }



  /**
   * Render an in-memory score. Used by the composer, which builds a Score from
   * its own ScoreDoc rather than loading a file.
   */
  renderScore(score: alphaTab.model.Score, trackIndices?: number[]): void {
    if (!this.api) {
      throw new Error('alphaTab API not initialized');
    }
    this.updateState({ loadingState: 'loading', errorMessage: null });
    this.api.renderScore(score, trackIndices);
  }

  /**
   * Force a re-render of the score alphaTab already holds.
   *
   * alphaTab refuses to draw into a zero-width element and does not retry on
   * its own, so this is needed once the container has actually been laid out.
   */
  render(): void {
    this.api?.render();
  }

  /**
   * Sound a single note immediately, on the score's own soundfont.
   *
   * Auditioning is deliberately decoupled from rendering: note entry should be
   * audible instantly even while a re-render is still in flight.
   *
   * @param midiKey MIDI note number (60 = middle C)
   * @param program General MIDI program to voice the note with
   * @param durationMs How long to hold the note
   */
  auditionNote(midiKey: number, program = 25, durationMs = 500): void {
    if (!this.api) return;

    const midi = new alphaTab.midi.MidiFile();
    midi.division = 960;

    const channel = 0;
    const ticks = Math.max(1, Math.round((durationMs / 500) * midi.division));

    midi.addEvent(
      new alphaTab.midi.ProgramChangeEvent(0, 0, channel, program)
    );
    midi.addEvent(
      new alphaTab.midi.NoteOnEvent(0, 0, channel, midiKey, 100)
    );
    midi.addEvent(
      new alphaTab.midi.NoteOffEvent(0, ticks, channel, midiKey, 0)
    );

    this.api.player?.playOneTimeMidiFile(midi);
  }

  /**
   * Toggle the metronome. Volume is 0-1.
   */
  setMetronomeVolume(volume: number): void {
    if (this.api) {
      this.api.metronomeVolume = Math.max(0, Math.min(1, volume));
    }
  }

  /**
   * Toggle the count-in before playback. Volume is 0-1.
   */
  setCountInVolume(volume: number): void {
    if (this.api) {
      this.api.countInVolume = Math.max(0, Math.min(1, volume));
    }
  }

  /**
   * Start playback
   */
  play(): void {
    this.api?.play();
  }

  /**
   * Pause playback
   */
  pause(): void {
    this.api?.pause();
  }

  /**
   * Toggle play/pause
   */
  playPause(): void {
    this.api?.playPause();
  }

  /**
   * Stop playback and reset position
   */
  stop(): void {
    this.api?.stop();
  }


  /**
   * Seek to position in milliseconds
   */
  seekToTime(timeMs: number): void {
    if (this.api) {
      this.api.timePosition = timeMs;
    }
  }

  /**
   * Set playback speed multiplier
   */
  setPlaybackSpeed(multiplier: number): void {
    if (this.api) {
      this.api.playbackSpeed = multiplier;
      this.updateState({ tempoMultiplier: multiplier });
    }
  }

  /**
   * Set master volume (0-1)
   */
  setVolume(volume: number): void {
    if (this.api) {
      this.api.masterVolume = Math.max(0, Math.min(1, volume));
      this.updateState({ volume });
    }
  }

  /**
   * Set looping
   */
  setLooping(loop: boolean): void {
    if (this.api) {
      this.api.isLooping = loop;
      this.updateState({ isLooping: loop });
    }
  }


  /**
   * Mute/unmute a track
   */
  setTrackMute(trackIndex: number, mute: boolean): void {
    if (this.api && this.api.score) {
      const track = this.api.score.tracks[trackIndex];
      if (track) {
        this.api.changeTrackMute([track], mute);
      }
    }
  }

  /**
   * Solo/unsolo a track
   */
  setTrackSolo(trackIndex: number, solo: boolean): void {
    if (this.api && this.api.score) {
      const track = this.api.score.tracks[trackIndex];
      if (track) {
        this.api.changeTrackSolo([track], solo);
      }
    }
  }


  /**
   * Get simplified track info for UI
   */
  getTrackInfo(): GpTrackInfo[] {
    const state = this.getCurrentState();
    if (!state.score) return [];

    return state.score.tracks.map((track: any, index: number) => ({
      index,
      name: track.name,
      shortName: track.shortName,
      color: this.colorToHex(track.color),
      isMuted: false, // alphaTab doesn't expose this directly
      isSolo: false,
      isPercussion: track.isPercussion,
      channel: track.playbackInfo.primaryChannel,
      program: track.playbackInfo.program
    }));
  }

  /**
   * Get simplified score info for UI
   */
  getScoreInfo(): GpScoreInfo | null {
    const state = this.getCurrentState();
    if (!state.score) return null;

    return {
      title: state.score.title || 'Untitled',
      subtitle: state.score.subTitle || '',
      artist: state.score.artist || 'Unknown Artist',
      album: state.score.album || '',
      copyright: state.score.copyright || '',
      tabAuthor: state.score.tab || '',
      tempo: state.score.tempo,
      trackCount: state.score.tracks.length,
      barCount: state.score.masterBars.length
    };
  }

  /**
   * Convert alphaTab Color to hex string
   */
  private colorToHex(color: alphaTab.model.Color): string {
    const r = color.r.toString(16).padStart(2, '0');
    const g = color.g.toString(16).padStart(2, '0');
    const b = color.b.toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }

  /**
   * Get the raw alphaTab API (for advanced use cases)
   */
  getApi(): alphaTab.AlphaTabApi | null {
    return this.api;
  }

  /**
   * Notify when a rendered beat is clicked. alphaTab does the hit testing, so
   * the caller gets the exact beat without any pixel maths of its own.
   * Requires `player.enableUserInteraction`.
   */
  onBeatMouseDown(handler: (beat: alphaTab.model.Beat) => void): void {
    this.api?.beatMouseDown.on(beat => this.ngZone.run(() => handler(beat)));
  }

  /**
   * Notify when a rendered note is clicked, giving the exact note.
   *
   * **Requires `core.includeNoteBounds`.** alphaTab hit-tests the beat first
   * and only then asks the bounds lookup for a note inside it, and it skips
   * that second step entirely unless note bounds were recorded - so without
   * the flag this registers a handler that is never called, silently. It does
   * *not* require the player: `_setupClickHandling` runs whatever
   * `player.enableUserInteraction` says, which only governs `preventDefault`
   * and the playback selection.
   *
   * Registered against the `AlphaTabApi` this service holds, which
   * `initializeApi` creates once and `dispose` destroys. Re-rendering a
   * different score does not replace it, so a caller registers once and the
   * handler survives every render; registering per render would fire one click
   * as many times as the score had been drawn.
   */
  onNoteMouseDown(handler: (note: alphaTab.model.Note) => void): void {
    this.api?.noteMouseDown.on(note => this.ngZone.run(() => handler(note)));
  }

  /** Notify once each render pass finishes, when bounds become valid. */
  onRenderFinished(handler: () => void): void {
    this.api?.renderFinished.on(() => this.ngZone.run(() => handler()));
  }

  /** Positions of rendered beats and notes, valid after a render completes. */
  getBoundsLookup(): alphaTab.rendering.BoundsLookup | null {
    return this.api?.boundsLookup ?? null;
  }

  /**
   * Dispose of alphaTab resources
   */
  dispose(): void {
    if (this.api) {
      this.api.destroy();
      this.api = null;
    }
    this.stateSubject.next(DEFAULT_ALPHA_TAB_STATE);
  }

  /**
   * Reset to initial state without disposing
   */
  reset(): void {
    this.stop();
    this.updateState({
      isLoaded: false,
      isPlaying: false,
      tickPosition: 0,
      timePosition: 0,
      totalDuration: 0,
      score: null,
      selectedTracks: [],
      loadingState: 'idle',
      errorMessage: null
    });
  }
}
