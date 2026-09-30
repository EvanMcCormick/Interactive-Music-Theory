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
import { AuditionQueue } from './audition-queue';

/**
 * alphaTab's own sentinel for "draw every track": a one-element list holding -1
 * (`AlphaTabApi.renderScore`, `alphaTab.core.mjs` ~51181 in 1.8).
 *
 * Needed because `load` takes the track indices before the bytes have been parsed, so the caller cannot know how
 * many tracks the file has. Passing explicit indices there would also meet alphaTab's own off-by-one - it accepts
 * `index <= tracks.length` and pushes `undefined` for the last - which this sentinel steps around.
 */
export const ALL_TRACKS: readonly number[] = [-1];

/** How the player sounds one track: muted, soloed, both or neither. */
export interface TrackPlayback {
  mute: boolean;
  solo: boolean;
}

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
  /** A note entry's audition, held until its render's MIDI has loaded. See `auditionAfterRender`. */
  private readonly auditions = new AuditionQueue();

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
    // alphaTab's own default, restated: a score's last system keeps its natural
    // width. Right for a page, wrong for a short preview, so a caller can ask.
    defaultSettings.display.justifyLastSystem = settings?.display?.justifyLastSystem ?? false;

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

    // MIDI loaded: a render's `loadMidiFile` has stopped the player, so a note entry's audition can sound now. And the
    // mixer the page wants goes back on: a score alphaTab is given carries its mutes in `PlaybackInformation`, which the
    // player never reads - only `changeTrackMute` and `changeTrackSolo` reach it.
    this.api.midiLoaded.on(() => {
      this.applyTrackPlayback();
      const audition = this.auditions.midiLoaded();
      if (audition) this.auditionNote(audition.midiKey, audition.program);
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
   * Loads Guitar Pro bytes and draws `trackIndices`.
   *
   * Replaces `loadFile(file)`, which read a `File` and then hard-coded `[0]`, so a four-piece file drew one staff
   * while the page listed four tracks beside it. Bytes rather than a `File` because every caller now has an
   * `ArrayBuffer` already - a `gp-library` entry's `fileData` - and the viewer used to wrap one in a Blob and a File
   * to get the same buffer back out.
   *
   * Parse failures do not arrive here: `api.load` hands the bytes to a worker, and a file alphaTab cannot read
   * reaches the `error` event, which sets `loadingState: 'error'` (`setupEventListeners`).
   */
  loadBytes(bytes: ArrayBuffer, trackIndices: readonly number[]): void {
    if (!this.api) {
      throw new Error('alphaTab API not initialized');
    }

    this.updateState({ loadingState: 'loading', errorMessage: null });
    this.api.load(new Uint8Array(bytes), trackIndices.slice());
  }

  /**
   * Draws `trackIndices` of the score alphaTab already holds - the track strip's show/hide in the Original state,
   * where there is no document to re-render from. Indices the score does not have are left out, and an empty list
   * draws nothing, so a caller that refuses to hide the last track does so for itself (`renderedTracksOf`).
   */
  renderTracks(trackIndices: readonly number[]): void {
    const score = this.api?.score;
    if (!this.api || !score) return;
    this.api.renderTracks(trackIndices.map(index => score.tracks[index]).filter(track => track !== undefined));
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
    this.auditions.rendered();
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
    this.playNote(midiKey, program, durationMs);
  }

  /**
   * Sounds the note an edit wrote, once the render that edit asks for has loaded its MIDI (`AuditionQueue`).
   *
   * Sounded at once, the render's `loadMidiFile` stopped it a moment later, and that stop could reach alphaTab's
   * AudioWorklet output before its buffer source had started - the `InvalidStateError`s "cannot call stop without
   * calling start first" and "cannot call start more than once".
   */
  auditionAfterRender(midiKey: number, program = 25): void {
    if (!this.api?.player) return;
    this.auditions.queue({ midiKey, program });
  }

  private playNote(midiKey: number, program: number, durationMs: number): void {
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


  /** The mute and solo each track should play with, by index, kept and applied again after every MIDI load. */
  private trackPlayback: readonly TrackPlayback[] = [];
  /**
   * Whether a page has set `trackPlayback` for the api there is now. Until one has, a MIDI load leaves the player's mixer
   * alone: an empty one would unmute every track of another page's score. `dispose` forgets both with the api - this is a
   * root service, and the next page to make an api may not be the one that set them.
   */
  private trackPlaybackSet = false;

  /**
   * Plays each track of the score alphaTab holds muted or soloed as `states` say, by index, now and after every render
   * from here on (`midiLoaded`). The page's one mixer: the track strip's rows, in either state.
   */
  setTrackPlayback(states: readonly TrackPlayback[]): void {
    // Asked on every caret move by the score; the player is told only of a change.
    const same =
      states.length === this.trackPlayback.length &&
      states.every((state, index) => state.mute === this.trackPlayback[index].mute && state.solo === this.trackPlayback[index].solo);
    if (this.trackPlaybackSet && same) return;
    this.trackPlayback = states;
    this.trackPlaybackSet = true;
    this.applyTrackPlayback();
  }

  private applyTrackPlayback(): void {
    const score = this.api?.score;
    if (!this.api || !score || !this.trackPlaybackSet) return;
    const tracksWhere = (test: (state: TrackPlayback) => boolean): alphaTab.model.Track[] =>
      score.tracks.filter((_, index) => test(this.trackPlayback[index] ?? { mute: false, solo: false }));
    // Off first, then on: the player mutes and solos by MIDI channel, and tracks share them - every single-staff drum
    // track is on channel 9 - so an unmute sent after a mute would unmute the muted track's channel with it.
    this.api.changeTrackMute(tracksWhere(state => !state.mute), false);
    this.api.changeTrackMute(tracksWhere(state => state.mute), true);
    this.api.changeTrackSolo(tracksWhere(state => !state.solo), false);
    this.api.changeTrackSolo(tracksWhere(state => state.solo), true);
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
   *
   * Fires whatever `player.enableUserInteraction` says: `_setupClickHandling` wires the beat mouse events
   * either way, and the flag only decides whether alphaTab also runs its own selection - which sets the
   * playback range on mouse-up.
   */
  onBeatMouseDown(handler: (beat: alphaTab.model.Beat) => void): void {
    this.api?.beatMouseDown.on(beat => this.ngZone.run(() => handler(beat)));
  }

  /**
   * Notify when the pointer crosses a beat after a `beatMouseDown`, until alphaTab sees the mouse-up.
   *
   * Unlike every other handler here, `handler` runs **outside** Angular's zone. alphaTab raises this on every
   * pointer move while its `_isBeatMouseDown` is set, and it hears mouse-up only on its own surface
   * (`canvasElement.mouseUp`, `alphaTab.core.mjs` ~53195 in 1.8), so after a release outside the score it goes
   * on firing for every move over the score until the next mouse-up there - and nothing public clears the flag.
   * A caller checks the move's own `MouseEvent.buttons` and enters the zone only for a move that changes state.
   */
  onBeatMouseMove(handler: (beat: alphaTab.model.Beat) => void): void {
    this.api?.beatMouseMove.on(beat => this.ngZone.runOutsideAngular(() => handler(beat)));
  }

  /** Notify when the button is released over alphaTab's surface after a `beatMouseDown`, with the beat under the pointer or null. */
  onBeatMouseUp(handler: (beat: alphaTab.model.Beat | null) => void): void {
    this.api?.beatMouseUp.on(beat => this.ngZone.run(() => handler(beat)));
  }

  /**
   * Draws alphaTab's selection markers from `startBeat` to `endBeat` without setting the playback range,
   * so selecting never changes what the transport plays. alphaTab does not redraw it after a render while
   * `enableUserInteraction` is off, so a caller redraws after `renderFinished`.
   */
  highlightRange(startBeat: alphaTab.model.Beat, endBeat: alphaTab.model.Beat): void {
    this.api?.highlightPlaybackRange(startBeat, endBeat);
  }

  /** Removes the selection markers. */
  clearHighlight(): void {
    this.api?.clearPlaybackRangeHighlight();
  }

  /**
   * Moves the playback position to the start of `beat`, as a click did while alphaTab's own interaction was
   * on - and nothing more: no playback range is set. The start comes from the tick cache, which counts
   * repeats (`MidiTickLookup.getBeatStart`, the beat's first playing). Does nothing before the player has
   * built a tick cache.
   */
  seekToBeat(beat: alphaTab.model.Beat): void {
    const api = this.api;
    const cache = api?.tickCache;
    if (!api || !cache) return;
    api.tickPosition = cache.getBeatStart(beat);
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

  /**
   * Notify once each render pass finishes. The bounds lookup is not yet the new render's: with workers,
   * `renderFinished` fires before `BoundsLookup.fromJson` replaces it (`alphaTab.core.mjs` ~55561-55567 in
   * 1.8). Anything that reads bounds waits for `onPostRenderFinished`.
   */
  onRenderFinished(handler: () => void): void {
    this.api?.renderFinished.on(() => this.ngZone.run(() => handler()));
  }

  /**
   * Notify once a render's bounds lookup is in place - after `renderFinished`, and after a resize re-layout -
   * so beats of the score just rendered can be found in it.
   */
  onPostRenderFinished(handler: () => void): void {
    this.api?.postRenderFinished.on(() => this.ngZone.run(() => handler()));
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
    this.trackPlayback = [];
    this.trackPlaybackSet = false;
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
