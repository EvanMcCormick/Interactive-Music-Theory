/**
 * The `harmonicValue` alphaTab gives a natural harmonic touched at `fret`: the fret itself where the node sits on it,
 * the node's true position where it sits between frets, and 12 for a fret with no node.
 *
 * A copy of `ModelUtils.deltaFretToHarmonicValue` (`alphaTab.core.mjs` ~4123-4150 in 1.8), which alphaTex's `nh`
 * (~14688-14690) and both GP importers (~20167, ~20789) call and which is not exported - `ModelUtils` is internal. The
 * model keeps a harmonic's type and not its value, so this is how a natural harmonic gets its value back. alphaTab reads
 * the value twice: it sounds a natural harmonic at `harmonicPitch + stringTuning` (~6058), with `harmonicPitch` read from
 * the value alone (~6078), and the tab draws the value itself, `<12>` or `<3.2>` (`NoteNumberGlyph.doLayout`
 * ~74040-74056). A natural harmonic left at alphaTab's default of 0 sounded the open string.
 *
 * Its own module, pure, so the mapper that sets the value and the conversion's loss checker that asks what the mapper
 * would set read one rule, and the checker imports no service.
 */
export function naturalHarmonicValueOf(fret: number): number {
  switch (fret) {
    case 2:
      return 2.4;
    case 3:
      return 3.2;
    case 4:
    case 5:
    case 7:
    case 9:
    case 12:
    case 16:
    case 17:
    case 19:
    case 24:
      return fret;
    case 8:
      return 8.2;
    case 10:
      return 9.6;
    case 14:
    case 15:
      return 14.7;
    case 21:
    case 22:
      return 21.7;
    default:
      return 12;
  }
}
