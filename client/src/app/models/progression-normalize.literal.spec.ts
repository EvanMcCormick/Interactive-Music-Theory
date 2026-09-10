import { ChordDegree, ChordSlot, createDegreeSlot } from './progression.model';
import { OCTAVE_MAX, normalizeChordSlot } from './progression-normalize';

/**
 * The guard on `SlotHarmony.literal.from`: the degree a slot that lost its
 * numeral can be turned back into.
 *
 * ## Why this is not in `progression-normalize.spec.ts`
 *
 * That file is 1095 lines against the project's 1000-line cap, so a task that
 * added to it would be choosing to grow a file already past it. The precedent
 * for a topic-named sibling instead is M3 Task 6's
 * `progression.service.tensions.spec.ts`, and the seam here is the same kind:
 * everything below is about one field of one variant, and none of it needs to
 * sit beside the octave clamp and the tempo range to be read.
 *
 * The field is under two clauses of the normalisation rule at once, which is
 * what makes it worth a file rather than a line. Its **absence** is the fifth
 * clause - a migration, filled with the value that already means "no way back"
 * - and its **contents**, when there are any, are an ordinary stored degree and
 * go through `normalizeChordDegree` like any other.
 */
describe('normalizeChordSlot: a literal slot’s way back', () => {
  /** A literal slot carrying `from`, built off a real degree slot. */
  function literal(from: ChordDegree | null): ChordSlot {
    return {
      ...createDegreeSlot(0, 0),
      harmony: { kind: 'literal', reason: 'unrecognised', from }
    };
  }

  /** The `from` a slot comes back with, narrowed. */
  function fromOf(slot: ChordSlot): ChordDegree | null | undefined {
    const harmony = normalizeChordSlot(slot).harmony;
    if (harmony.kind !== 'literal') throw new Error('expected a literal slot');
    return harmony.from;
  }

  /** A degree to keep, taken from a slot the factory built. */
  function someDegree(): ChordDegree {
    const harmony = createDegreeSlot(4, 0).harmony;
    if (harmony.kind !== 'degree') throw new Error('unreachable');
    return harmony.degree;
  }

  /**
   * The migration. The field was added at M3 Task 8, so every slot written
   * before it arrives without one - and `null` is not a stand-in for a missing
   * answer here but the honest one, because a slot with nothing recorded to go
   * back to is a slot with no way back.
   */
  it('fills an absent from with null', () => {
    const older = { ...literal(null) } as Record<string, unknown>;
    older['harmony'] = { kind: 'literal', reason: 'unrecognised' };

    expect(fromOf(older as never)).toBeNull();
  });

  it('keeps a null one null', () => {
    expect(fromOf(literal(null))).toBeNull();
  });

  it('keeps the degree it is given', () => {
    expect(fromOf(literal(someDegree()))).toEqual(someDegree());
  });

  /**
   * A `from` is stored harmony and is built from the moment Reset to chord is
   * pressed, so it is bounded on the way in rather than on that one press. An
   * octave off the end of the control would otherwise sit in the document
   * unread until it became notes.
   */
  it('bounds the degree it keeps', () => {
    expect(fromOf(literal({ ...someDegree(), octave: 9 }))?.octave).toBe(OCTAVE_MAX);
  });

  /** And refuses one of the wrong kind, where the degree branch would. */
  it('throws on a from that could not build a chord', () => {
    expect(() => fromOf(literal({ ...someDegree(), inversion: Number.NaN })))
      .toThrowError(/inversion/);
  });

  /**
   * Rebuilt rather than passed through, for the reason every other branch of
   * the normaliser is: a document already on the `structuredClone` undo stack
   * must not find its harmony amended behind it.
   */
  it('does not hand back the harmony it was given', () => {
    const slot = literal(someDegree());
    expect(normalizeChordSlot(slot).harmony).not.toBe(slot.harmony);
  });
});
