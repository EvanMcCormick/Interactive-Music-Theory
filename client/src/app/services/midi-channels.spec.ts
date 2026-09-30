import { ChannelledTrack, PERCUSSION_CHANNEL, midiChannelsOf } from './midi-channels';

/**
 * The channel rule the mapper writes and the conversion's loss checker compares against: `midiChannelsOf`, pinned
 * against what alphaTab's `ModelUtils.consolidate` would assign, since that function is not exported and a score the
 * composer builds never passes through it.
 *
 * A wrong channel is silent in every other test: a track on the kit's channel plays its notes as drums, and two tracks
 * on one channel share whichever program was set last.
 */
describe('midiChannelsOf', () => {
  const pitched: ChannelledTrack = { staves: [{ isPercussion: false }] };
  const drums: ChannelledTrack = { staves: [{ isPercussion: true }] };

  it('gives pitched tracks the lowest free pair each, skipping the kit channel', () => {
    const channels = midiChannelsOf([pitched, pitched, pitched, pitched, pitched]);

    expect(channels.map(c => [c.primary, c.secondary])).toEqual([[0, 1], [2, 3], [4, 5], [6, 7], [8, 10]]);
  });

  it('puts a one-staff drum track on the kit channel without using up a pitched pair', () => {
    const channels = midiChannelsOf([drums, pitched]);

    expect(channels).toEqual([
      { primary: PERCUSSION_CHANNEL, secondary: PERCUSSION_CHANNEL },
      { primary: 0, secondary: 1 }
    ]);
  });

  it('does not treat a two-staff track with one percussion staff as a kit', () => {
    const mixed: ChannelledTrack = { staves: [{ isPercussion: false }, { isPercussion: true }] };

    expect(midiChannelsOf([mixed])).toEqual([{ primary: 0, secondary: 1 }]);
  });
});
