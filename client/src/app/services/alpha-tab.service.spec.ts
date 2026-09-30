import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTabService } from './alpha-tab.service';

describe('AlphaTabService before an api exists', () => {
  it('registers mouse-move, mouse-up and post-render handlers, draws and clears a highlight, and seeks, without throwing', () => {
    TestBed.configureTestingModule({});
    const service = TestBed.inject(AlphaTabService);
    const beat = new alphaTab.model.Beat();

    expect(() => {
      service.onBeatMouseMove(() => undefined);
      service.onBeatMouseUp(() => undefined);
      service.onPostRenderFinished(() => undefined);
      service.highlightRange(beat, beat);
      service.clearHighlight();
      service.seekToBeat(beat);
      service.renderTracks([0, 1]);
      service.setTrackPlayback([{ mute: true, solo: false }]);
    }).not.toThrow();
  });

  it('refuses to load bytes before an api exists, naming the reason', () => {
    TestBed.configureTestingModule({});
    const service = TestBed.inject(AlphaTabService);

    expect(() => service.loadBytes(new ArrayBuffer(8), [0, 1])).toThrowError('alphaTab API not initialized');
  });
});

/**
 * The page's mixer (`setTrackPlayback`), against a stand-in for alphaTab's api: the score it holds, the events this
 * service listens to, and a player that keeps a mute and a solo per MIDI channel, as alphaTab's does
 * (`changeTrackMute` sets the track's primary and secondary channels). The stand-in is put where `initializeApi` puts
 * the real one, which would boot workers and a sound font.
 */
describe('AlphaTabService mixer', () => {
  interface FakeApi {
    score: alphaTab.model.Score;
    channelMute: Map<number, boolean>;
    channelSolo: Map<number, boolean>;
    changeTrackMute: jasmine.Spy<(tracks: alphaTab.model.Track[], mute: boolean) => void>;
    changeTrackSolo: jasmine.Spy<(tracks: alphaTab.model.Track[], solo: boolean) => void>;
    loadMidi(): void;
  }

  let service: AlphaTabService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AlphaTabService);
  });

  /** An api holding a score of tracks on `channels`, one track each: a second single-staff drum track shares channel 9. */
  function fakeApi(...channels: number[]): FakeApi {
    const score = new alphaTab.model.Score();
    for (const channel of channels) {
      const track = new alphaTab.model.Track();
      track.playbackInfo.primaryChannel = channel;
      track.playbackInfo.secondaryChannel = channel;
      score.addTrack(track);
    }
    const midiLoaded: (() => void)[] = [];
    const event = (handlers: (() => void)[] = []) => ({ on: (handler: () => void) => void handlers.push(handler) });
    const channelMute = new Map<number, boolean>();
    const channelSolo = new Map<number, boolean>();
    const perChannel = (map: Map<number, boolean>) => (tracks: alphaTab.model.Track[], on: boolean) => {
      for (const track of tracks) {
        map.set(track.playbackInfo.primaryChannel, on);
        map.set(track.playbackInfo.secondaryChannel, on);
      }
    };
    const api = {
      score,
      scoreLoaded: event(),
      midiLoaded: event(midiLoaded),
      playerReady: event(),
      playerStateChanged: event(),
      playerPositionChanged: event(),
      error: event(),
      changeTrackMute: jasmine.createSpy('changeTrackMute').and.callFake(perChannel(channelMute)),
      changeTrackSolo: jasmine.createSpy('changeTrackSolo').and.callFake(perChannel(channelSolo)),
      destroy: () => undefined
    };
    const internals = service as unknown as { api: unknown; setupEventListeners(): void };
    internals.api = api;
    internals.setupEventListeners();
    return { ...api, channelMute, channelSolo, loadMidi: () => midiLoaded.forEach(handler => handler()) };
  }

  it('mutes and solos each track as told, and unmutes and unsolos the rest', () => {
    const api = fakeApi(0, 1);
    const [first, second] = api.score.tracks;

    service.setTrackPlayback([{ mute: true, solo: false }, { mute: false, solo: true }]);

    expect(api.changeTrackMute).toHaveBeenCalledWith([first], true);
    expect(api.changeTrackMute).toHaveBeenCalledWith([second], false);
    expect(api.changeTrackSolo).toHaveBeenCalledWith([second], true);
    expect(api.changeTrackSolo).toHaveBeenCalledWith([first], false);
  });

  it('tells the player nothing when asked again for the mixer it already has', () => {
    const api = fakeApi(0, 1);
    service.setTrackPlayback([{ mute: true, solo: false }, { mute: false, solo: false }]);
    api.changeTrackMute.calls.reset();
    api.changeTrackSolo.calls.reset();

    service.setTrackPlayback([{ mute: true, solo: false }, { mute: false, solo: false }]);

    expect(api.changeTrackMute).not.toHaveBeenCalled();
    expect(api.changeTrackSolo).not.toHaveBeenCalled();
  });

  it('puts the mixer back on the player after every MIDI load, which forgets it', () => {
    const api = fakeApi(0, 1);
    service.setTrackPlayback([{ mute: false, solo: false }, { mute: true, solo: false }]);
    api.changeTrackMute.calls.reset();

    api.loadMidi();

    expect(api.changeTrackMute).toHaveBeenCalledWith([api.score.tracks[1]], true);
  });

  it('keeps a muted track muted when another track on its channel is not: every single-staff drum track is on 9', () => {
    const api = fakeApi(9, 9, 0);

    service.setTrackPlayback([{ mute: true, solo: false }, { mute: false, solo: false }, { mute: false, solo: false }]);

    expect(api.channelMute.get(9)).toBeTrue();
    expect(api.channelMute.get(0)).toBeFalse();
  });

  it('keeps a soloed track soloed when another track on its channel is not', () => {
    const api = fakeApi(9, 9, 0);

    service.setTrackPlayback([{ mute: false, solo: false }, { mute: false, solo: true }, { mute: false, solo: false }]);

    expect(api.channelSolo.get(9)).toBeTrue();
    expect(api.channelSolo.get(0)).toBeFalse();
  });

  it("leaves the player's mixer alone on a MIDI load while no page has set one", () => {
    const api = fakeApi(0, 1);

    api.loadMidi();

    expect(api.changeTrackMute).not.toHaveBeenCalled();
    expect(api.changeTrackSolo).not.toHaveBeenCalled();
  });

  it('forgets the mixer with the api it was set for, so the next api is left as it loads', () => {
    fakeApi(0, 1);
    service.setTrackPlayback([{ mute: true, solo: false }, { mute: false, solo: true }]);

    service.dispose();
    const next = fakeApi(0, 1);
    next.loadMidi();

    expect(next.changeTrackMute).not.toHaveBeenCalled();
    expect(next.changeTrackSolo).not.toHaveBeenCalled();
  });
});
