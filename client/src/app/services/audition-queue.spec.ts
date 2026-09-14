import { AuditionQueue } from './audition-queue';

describe('AuditionQueue', () => {
  let now = 0;
  let queue: AuditionQueue;

  beforeEach(() => {
    now = 0;
    queue = new AuditionQueue(() => now, 2000);
  });

  it('sounds a note once the MIDI of the render after it has loaded, and only once', () => {
    queue.queue({ midiKey: 74, program: 25 });
    queue.rendered();

    expect(queue.midiLoaded()).toEqual({ midiKey: 74, program: 25 });
    expect(queue.midiLoaded()).toBeNull();
  });

  it('waits past the MIDI of a render begun before the note was queued', () => {
    queue.rendered();
    queue.queue({ midiKey: 74, program: 25 });

    expect(queue.midiLoaded()).toBeNull();
    queue.rendered();
    expect(queue.midiLoaded()).toEqual({ midiKey: 74, program: 25 });
  });

  it('keeps the last of two notes queued before one render', () => {
    queue.queue({ midiKey: 74, program: 25 });
    queue.queue({ midiKey: 67, program: 25 });
    queue.rendered();

    expect(queue.midiLoaded()).toEqual({ midiKey: 67, program: 25 });
  });

  it('drops a note whose render never loaded in time, rather than sound it late', () => {
    queue.queue({ midiKey: 74, program: 25 });
    queue.rendered();
    now = 2001;

    expect(queue.midiLoaded()).toBeNull();
  });
});
