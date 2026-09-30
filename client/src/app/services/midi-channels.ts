/**
 * Which MIDI channels each track of a score plays on, as alphaTab's importers assign them.
 *
 * alphaTab assigns channels in `ModelUtils.consolidate` (`alphaTab.core.mjs` ~4315-4335 in 1.8), which every importer
 * runs and `Score.finish` does not - and `ModelUtils` is not exported. So a score the composer built, rather than one
 * alphaTab read, kept every track on `PlaybackInformation`'s default of channel 0: the tracks shared one program,
 * whichever was set last, and a drum kit was played as pitched notes, since only channel 9 means a kit.
 *
 * Pure, and over the least a track can be described by, so the mapper that writes channels and the conversion's loss
 * checker that compares a file's own against them read one rule. The model holds no channel (`PlaybackInfoDoc`): this
 * is the whole of what decides one.
 */

/** The General MIDI channel a drum kit sounds on: alphaTab's `SynthConstants.PercussionChannel`. */
export const PERCUSSION_CHANNEL = 9;

/** A track, as far as its channels go: whether it is one percussion staff. */
export interface ChannelledTrack {
  staves: readonly { isPercussion: boolean }[];
}

/** One track's channels. */
export interface MidiChannels {
  primary: number;
  secondary: number;
}

/**
 * The channels `consolidate` gives `tracks`, in order, from alphaTab's defaults of 0 and 0: a track whose one staff is
 * percussion goes on channel 9, primary and secondary; every other track takes the lowest unused channel for each, never 9.
 */
export function midiChannelsOf(tracks: readonly ChannelledTrack[]): MidiChannels[] {
  const used = new Set<number>([PERCUSSION_CHANNEL]);
  const lowestFree = (): number => {
    let channel = 0;
    while (used.has(channel)) channel++;
    used.add(channel);
    return channel;
  };
  return tracks.map(track => {
    if (track.staves.length === 1 && track.staves[0].isPercussion) return { primary: PERCUSSION_CHANNEL, secondary: PERCUSSION_CHANNEL };
    const primary = lowestFree();
    return { primary, secondary: lowestFree() };
  });
}
