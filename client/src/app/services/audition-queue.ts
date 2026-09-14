/**
 * Holds a note entry's audition until the score it changed has its MIDI loaded.
 *
 * Every write re-engraves, and alphaTab's `renderScore` loads the new score's MIDI, whose `AlphaSynth.loadMidiFile`
 * calls `stop()` - so a note sounded straight after the write was cut off by its own render, 150 ms later when the
 * composer's debounce fired. Worse, `stop()` pauses the Web Audio output, and alphaTab's AudioWorklet output starts its
 * buffer source only once `audioWorklet.addModule` resolves (`AlphaSynthAudioWorkletOutput.play`): a pause that lands
 * first calls `stop` on a source never started, and the play after it has two pending promises start one source - the
 * two `InvalidStateError`s the hand check logged. Sounding the note after the MIDI has loaded puts the stop first.
 *
 * Pure: the service tells it when a note is asked for, when a render begins and when MIDI has loaded.
 */

/** A note to sound, and the General MIDI program to voice it with. */
export interface Audition {
  midiKey: number;
  program: number;
}

export class AuditionQueue {
  private pending: { audition: Audition; queuedAt: number; rendered: boolean } | null = null;

  /**
   * @param now The clock, in milliseconds.
   * @param waitMs How long a note waits for its render's MIDI before it is dropped: a note sounded seconds after the
   *   click that asked for it is worse than none.
   */
  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly waitMs = 2000
  ) {}

  /** Asks for `audition` after the next render's MIDI. A note already waiting is replaced: one render covers both writes. */
  queue(audition: Audition): void {
    this.pending = { audition, queuedAt: this.now(), rendered: false };
  }

  /** A render has begun, whose MIDI a waiting note is sounded after. */
  rendered(): void {
    if (this.pending) this.pending.rendered = true;
  }

  /** MIDI has loaded: the note to sound now, if one waits on a render begun after it was asked for and in time. */
  midiLoaded(): Audition | null {
    const pending = this.pending;
    if (!pending?.rendered) return null;
    this.pending = null;
    return this.now() - pending.queuedAt <= this.waitMs ? pending.audition : null;
  }
}
