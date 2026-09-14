import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { notesAt, setAccidental, toggleNoteEffect, toggleTie, toggleTrill } from './note-edits';
import { NoteDoc, NotePitch, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

const ref = (beatIndex: number): BeatRef =>
  ({ trackIndex: 0, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex });
const noteOn = (pitch: NotePitch): NoteDoc =>
  ({ pitch, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() });

/** Guitar score whose first beat is a two-note chord on strings 1 and 2, and second beat one note. */
function chordDoc(): ScoreDoc {
  const doc = ComposerService.createEmptyScore();
  const beats = doc.tracks[0].staves[0].bars[0].voices[0].beats;
  beats[0] = { ...beats[0], isRest: false, notes: [noteOn({ kind: 'fretted', string: 1, fret: 0 }), noteOn({ kind: 'fretted', string: 2, fret: 1 })] };
  beats[1] = { ...beats[1], isRest: false, notes: [noteOn({ kind: 'fretted', string: 1, fret: 3 })] };
  return doc;
}

describe('notesAt', () => {
  it('is the focused string\'s note when one beat is selected', () => {
    expect(notesAt(chordDoc(), [ref(0)], 1).map(note => note.pitch)).toEqual([{ kind: 'fretted', string: 2, fret: 1 }]);
  });

  it('is every note when a range is selected, focus or not', () => {
    expect(notesAt(chordDoc(), [ref(0), ref(1)], 1).length).toBe(3);
  });

  it('is every note in the beat without a focus', () => {
    expect(notesAt(chordDoc(), [ref(0)], null).length).toBe(2);
  });
});

describe('toggleNoteEffect', () => {
  it('turns a valued effect off when every target already has it', () => {
    const doc = chordDoc();
    toggleNoteEffect(doc, [ref(0), ref(1)], null, 'accent', 'heavy', 'none');

    toggleNoteEffect(doc, [ref(0), ref(1)], null, 'accent', 'heavy', 'none');

    expect(notesAt(doc, [ref(0), ref(1)], null).map(note => note.effects.accent)).toEqual(['none', 'none', 'none']);
  });

  it('gives every target its own copy of a structured value', () => {
    const doc = chordDoc();
    const bend = [{ offset: 0, value: 0 }, { offset: 60, value: 4 }];

    toggleNoteEffect(doc, [ref(0)], null, 'bendPoints', bend, []);
    const [first, second] = notesAt(doc, [ref(0)], null);
    first.effects.bendPoints.push({ offset: 30, value: 2 });

    expect(second.effects.bendPoints.length).toBe(2);
  });
});

describe('setAccidental', () => {
  it('forces the accidental and drops a letter that would overrule it', () => {
    const doc = ComposerService.createEmptyScore();
    const beat = doc.tracks[0].staves[0].bars[0].voices[0].beats[0];
    beat.isRest = false;
    beat.notes = [noteOn({ kind: 'pitched', noteValue: 1, octave: 4, letter: 'C' })];

    setAccidental(doc, [ref(0)], null, 'flat');

    expect(beat.notes[0].accidental).toBe('flat');
    expect(beat.notes[0].pitch).toEqual({ kind: 'pitched', noteValue: 1, octave: 4 });
  });
});

describe('toggleTie', () => {
  it('ties, then unties, the focused note', () => {
    const doc = chordDoc();

    toggleTie(doc, [ref(1)], null);
    expect(notesAt(doc, [ref(1)], null)[0].isTied).toBeTrue();

    toggleTie(doc, [ref(1)], null);
    expect(notesAt(doc, [ref(1)], null)[0].isTied).toBeFalse();
  });

  it('ties the notes of a range that have a note to tie from, skipping the rest, and a second press unties them', () => {
    // Beat 0's two notes are the first on their strings; beat 1's string-1 note has beat 0's before it.
    // alphaTab clears a tie with no origin, so the first notes are skipped rather than tied for nothing.
    const doc = chordDoc();
    const beats = doc.tracks[0].staves[0].bars[0].voices[0].beats;

    toggleTie(doc, [ref(0), ref(1)], null);
    expect([...beats[0].notes, ...beats[1].notes].map(note => note.isTied)).toEqual([false, false, true]);

    toggleTie(doc, [ref(0), ref(1)], null);
    expect([...beats[0].notes, ...beats[1].notes].map(note => note.isTied)).toEqual([false, false, false]);
  });

  it('ties across a bar line from an uneven bar without reordering that bar', () => {
    // Bar 0 is a half on string 1, a quarter rest and a quarter on string 2. Bar 1's first note, on
    // string 1, ties from the half: the search walks bar 0 backwards, and must not reverse it.
    const doc = ComposerService.createEmptyScore();
    const bar0 = doc.tracks[0].staves[0].bars[0].voices[0].beats;
    bar0.splice(0, bar0.length, { ...bar0[0], duration: 2, isRest: false, notes: [noteOn({ kind: 'fretted', string: 1, fret: 3 })] }, { ...bar0[1] }, {
      ...bar0[2],
      isRest: false,
      notes: [noteOn({ kind: 'fretted', string: 2, fret: 1 })]
    });
    const next = doc.tracks[0].staves[0].bars[1].voices[0].beats[0];
    next.isRest = false;
    next.notes = [noteOn({ kind: 'fretted', string: 1, fret: 3 })];

    toggleTie(doc, [{ ...ref(0), barIndex: 1 }], null);

    expect(next.notes[0].isTied).toBeTrue();
    expect(bar0.map(beat => `${beat.isRest ? 'r' : 'n'}${beat.duration}`)).toEqual(['n2', 'r4', 'n4']);
  });
});

describe('toggleNoteEffect clearing a range', () => {
  it('clears only the notes holding the value pressed, leaving another value alone', () => {
    // Beat 0's string-1 note shift-slides into beat 1's, which slides out and lands nowhere. Shift slide
    // reads beat 0's note alone, which has it, so the press clears - and must not wipe the slide out.
    const doc = chordDoc();
    const beats = doc.tracks[0].staves[0].bars[0].voices[0].beats;
    beats[0].notes[0].effects.slide = 'shiftSlide';
    beats[1].notes[0].effects.slide = 'slideOutUp';

    toggleNoteEffect(doc, [ref(0), ref(1)], null, 'slide', 'shiftSlide', 'none');

    expect([...beats[0].notes, ...beats[1].notes].map(note => note.effects.slide)).toEqual(['none', 'none', 'slideOutUp']);
  });
});

describe('toggleNoteEffect with a hammer-on', () => {
  it('puts it on the notes that can land and skips the last, then clears them all', () => {
    // Beat 1's note is the last on string 1 in the score, so it has nothing to land on.
    const doc = chordDoc();
    const beats = doc.tracks[0].staves[0].bars[0].voices[0].beats;

    toggleNoteEffect(doc, [ref(0), ref(1)], null, 'isHammerPullOrigin', true, false);
    expect(beats[0].notes.map(note => note.effects.isHammerPullOrigin)).toEqual([true, false]);
    expect(beats[1].notes[0].effects.isHammerPullOrigin).toBeFalse();

    toggleNoteEffect(doc, [ref(0), ref(1)], null, 'isHammerPullOrigin', true, false);
    expect(beats[0].notes[0].effects.isHammerPullOrigin).toBeFalse();
  });
});

describe('toggleTrill', () => {
  it('aims each note of a chord a whole step above itself, capo included, and a second press clears them', () => {
    // String 1 (E, 64) at fret 0 and string 2 (B, 59) at fret 1, under a capo at 2.
    const doc = chordDoc();
    doc.tracks[0].staves[0].capo = 2;
    const notes = doc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes;

    toggleTrill(doc, [ref(0)], null);
    expect(notes.map(note => note.effects.trill?.value)).toEqual([68, 64]);

    toggleTrill(doc, [ref(0)], null);
    expect(notes.map(note => note.effects.trill)).toEqual([null, null]);
  });

  it('gives every note a trill when some already have one', () => {
    const doc = chordDoc();
    const notes = doc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes;
    notes[0].effects.trill = { value: 70, speed: 32 };

    toggleTrill(doc, [ref(0)], null);

    expect(notes.map(note => note.effects.trill)).toEqual([{ value: 66, speed: 16 }, { value: 62, speed: 16 }]);
  });
});
