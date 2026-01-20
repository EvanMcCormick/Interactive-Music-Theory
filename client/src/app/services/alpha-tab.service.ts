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
   * Load a Guitar Pro file from ArrayBuffer
   */
  loadFromBuffer(buffer: ArrayBuffer, trackIndices?: number[]): void {
    if (!this.api) {
      throw new Error('alphaTab API not initialized');
    }

    this.updateState({ loadingState: 'loading', errorMessage: null });
    const uint8Array = new Uint8Array(buffer);
    this.api.load(uint8Array, trackIndices ?? [0]);
  }

  /**
   * Load from URL
   */
  loadFromUrl(url: string): void {
    if (!this.api) {
      throw new Error('alphaTab API not initialized');
    }

    this.updateState({ loadingState: 'loading', errorMessage: null });

    fetch(url)
      .then(response => response.arrayBuffer())
      .then(buffer => {
        const uint8Array = new Uint8Array(buffer);
        this.api?.load(uint8Array, [0]);
      })
      .catch(error => {
        const message = error instanceof Error ? error.message : 'Failed to load from URL';
        this.updateState({ loadingState: 'error', errorMessage: message });
      });
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
   * Seek to position in ticks
   */
  seekToTick(tick: number): void {
    if (this.api) {
      this.api.tickPosition = tick;
    }
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
   * Set which tracks to render
   */
  setTracks(trackIndices: number[]): void {
    if (this.api && this.api.score) {
      const tracks = trackIndices.map(i => this.api!.score!.tracks[i]).filter(t => t);
      this.api.renderTracks(tracks);
      this.updateState({ selectedTracks: trackIndices });
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
   * Set track volume
   */
  setTrackVolume(trackIndex: number, volume: number): void {
    if (this.api && this.api.score) {
      const track = this.api.score.tracks[trackIndex];
      if (track) {
        this.api.changeTrackVolume([track], volume);
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
