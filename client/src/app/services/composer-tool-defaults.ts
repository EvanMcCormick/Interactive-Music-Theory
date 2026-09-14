import { BendPointDoc, FermataDoc, TrillDoc, Tuplet } from '../models/composer.model';

/**
 * The values M2's tools apply where M4 will give them an editor: a bend, a fermata, a trill's speed and
 * interval, and the tuplets the tuplet popover offers.
 *
 * The structured values are functions rather than constants, so no press can hand one object to two
 * notes or beats: every caller gets its own copy. `composer-tool-defaults.spec.ts` sends each through a
 * save, because a default alphaTab reshapes would draw a mark a reload changes.
 */

/**
 * A full bend: a whole tone - 4 quarter tones - reached by the end of the note. Two points at offsets 0
 * and 60 are exactly the shape alphaTab keeps for its plain `Bend` type, so `Note.finish`, which
 * rewrites any bend of two to four points into one of Guitar Pro's shapes, leaves it as written.
 */
export function fullBendPoints(): BendPointDoc[] {
  return [
    { offset: 0, value: 0 },
    { offset: 60, value: 4 }
  ];
}

/** A medium fermata held for its written length. */
export function defaultFermata(): FermataDoc {
  return { type: 'medium', length: 1 };
}

/** A trill in sixteenth notes. */
export const DEFAULT_TRILL_SPEED: TrillDoc['speed'] = 16;

/** How far above its note a default trill alternates, in semitones: a whole step. */
export const TRILL_INTERVAL = 2;

/** The tuplets the tuplet popover offers until M4's custom tuplet editor. */
export const TUPLET_CHOICES: readonly Readonly<Tuplet>[] = [
  { numerator: 3, denominator: 2 },
  { numerator: 5, denominator: 4 },
  { numerator: 6, denominator: 4 },
  { numerator: 7, denominator: 4 }
];
