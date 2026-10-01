import { ChordSlot, ProgressionKey, createDegreeSlot } from '../models/progression.model';
import { rekeyedSlot } from './progression-degree-editor';
import { regenerateSlot } from './progression-edit';

/**
 * `rekeyedSlot`, the pure half of `ProgressionDegreeEditor.rekey`.
 *
 * Its behaviour is pinned through the service in `progression.service.rekey.spec.ts`
 * and `progression.service.regenerate.spec.ts`; these two specs hold the function
 * itself to the rule the song sheet re-keys its chord atoms by, without a store.
 */
describe('rekeyedSlot', () => {
  const IONIAN = [0, 2, 4, 5, 7, 9, 11];
  const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
  const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
  const A_MINOR: ProgressionKey = { tonic: 9, scaleId: 'aeolian', preferSharps: false };
  const C_MINOR: ProgressionKey = { tonic: 0, scaleId: 'aeolian', preferSharps: false };

  function voiced(degree: number): ChordSlot {
    return regenerateSlot(createDegreeSlot(degree, 0), C_MAJOR, IONIAN);
  }

  function pitchClassesOf(slot: ChordSlot): number[] {
    return [...new Set(slot.notes.map(note => note.midi % 12))].sort((a, b) => a - b);
  }

  it('keeps a slot that does not own its pitches on its degree, and voices it in the new key', () => {
    const fifth = voiced(4);

    const moved = rekeyedSlot(fifth, IONIAN, AEOLIAN, A_MINOR, -3);

    expect(moved.harmony).toEqual(fifth.harmony);
    // v in A minor: E, G, B.
    expect(pitchClassesOf(moved)).toEqual([4, 7, 11]);
  });

  it('keeps the pitches of a slot that owns them, and numbers them again in the new key', () => {
    const tonic = voiced(0);
    const owned: ChordSlot = { ...tonic, owned: { ...tonic.owned, pitches: true } };

    // Same tonic, new mode: nothing transposes, so the pitches stay exactly put.
    const moved = rekeyedSlot(owned, IONIAN, AEOLIAN, C_MINOR, 0);

    expect(moved.notes).toEqual(owned.notes);
    // C, E, G is still a major chord on the tonic, so it is written I with its
    // major third pinned: the bare degree would now read i, over notes it is not.
    expect(moved.harmony).toEqual({
      kind: 'degree',
      degree: jasmine.objectContaining({ degree: 0, alter: 0, quality: 'major', inversion: 0, octave: 0 })
    });
    expect(tonic.harmony).toEqual({ kind: 'degree', degree: jasmine.objectContaining({ quality: null }) });
  });
});
