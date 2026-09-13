import {
  ScoreDoc,
  createDefaultBar,
  createDefaultMasterBar,
  effectiveTimeSignature
} from '../models/composer.model';

/**
 * Inserts a bar at `index` across every track, preserving the invariant that the timeline
 * is shared, and returns the index it used after clamping.
 *
 * A new first bar takes over bar 1's time signature declaration. Anywhere else a fresh
 * master bar declaring nothing inherits the meter in force, but bar 1 has nothing to inherit
 * from, and `effectiveTimeSignature` answers an undeclared bar 1 with 4/4 - which is
 * `scoreMeter`, and so the guard on `sendProgression`. The displaced bar drops a declaration
 * that now repeats the meter already in force, so a uniform score does not gain a meter
 * change at bar 2: the shape the mapper reads a loaded file into.
 *
 * Pure apart from mutating `doc`, so the service and Fix bar share one definition of what
 * inserting a bar means. Divergence of generated tracks is the caller's to stamp - it is
 * a fact about commands, not about bars.
 */
export function insertBarInto(doc: ScoreDoc, index: number): number {
  const at = Math.max(0, Math.min(doc.masterBars.length, index));
  const masterBar = createDefaultMasterBar();
  const displaced = doc.masterBars[at];
  if (at === 0 && displaced) {
    masterBar.timeSignature = effectiveTimeSignature(doc.masterBars, 0);
    displaced.timeSignature = null;
  }
  doc.masterBars.splice(at, 0, masterBar);
  for (const track of doc.tracks) {
    for (const staff of track.staves) {
      const template = staff.bars[Math.min(at, staff.bars.length - 1)];
      const bar = createDefaultBar(staff.showTablature, effectiveTimeSignature(doc.masterBars, at));
      if (template) {
        bar.clef = template.clef;
        bar.clefOttava = template.clefOttava;
        bar.keySignature = { ...template.keySignature };
      }
      staff.bars.splice(at, 0, bar);
    }
  }
  return at;
}
