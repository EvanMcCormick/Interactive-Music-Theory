import { ChordDegree, SlotHarmony } from '../models/progression.model';

/**
 * Whether a slot can be handed back to the generator, and the one sentence each
 * refusal is said in.
 *
 * ## The bug this file exists to make impossible
 *
 * `ProgressionService.resetSlotToChord` refuses on two conditions. Three places
 * spoke about those refusals and each wrote them out for itself: the service
 * made them, the roll's button explained them, and the strip's sentence under
 * the cards promised the button as the way back out of an unlabelled card. The
 * strip's promise was not conditioned on either refusal, so in the one state
 * that unlabels *every* card at once - a key that cannot stack thirds, where
 * `intervals` is null for the whole document together - the strip said "Reset to
 * chord, in the roll, turns it back into one" one panel over from the same
 * button, greyed, saying there was no chord to go back to. Two surfaces, one
 * state, opposite claims, and the one the user was told to trust was the false
 * one.
 *
 * So the predicate and its words are written once, here, and the three read
 * them. That is the argument `effectiveChord` makes about naming a chord, one
 * layer over: a rule with more than one reader is a rule that belongs in one
 * place, because the second writing of it is free to drift and will.
 *
 * ## Why the sentences live beside the predicate rather than in the components
 *
 * They are not decoration on the refusal, they *are* the refusal said out loud,
 * and the whole failure above was a sentence that had come loose from the
 * condition it described. Keeping the two in one record is what makes a new
 * refusal impossible to add without wording it, and impossible to word twice.
 *
 * A file under `services/` holding user-facing prose is not a first:
 * `progression-chord-names.ts` is nothing but, and for the same reason - one
 * writing of a convention that several components print.
 */

/** Why there is no chord to go back to. */
export type ResetRefusal = 'unbuildable-key' | 'no-origin';

/**
 * What a reset would do to a slot: the degree to rebuild from, or why there is
 * none.
 *
 * A discriminated result rather than a boolean and a nullable degree beside it,
 * so the caller that goes on to rebuild is handed a `ChordDegree` it does not
 * have to re-narrow, and the caller that only explains is handed a refusal it
 * cannot forget to word.
 */
export type ResetOutcome =
  | { canReset: true; held: ChordDegree }
  | { canReset: false; refusal: ResetRefusal };

/** What the button, and the strip's sentence, say about each refusal. */
export const RESET_REFUSAL_TEXT: Record<ResetRefusal, string> = {
  'unbuildable-key': 'This key cannot build chords, so there is no chord to go back to.',
  'no-origin': 'These notes were never a chord in this app, so there is none to go back to.'
};

/**
 * The two refusals, asked once.
 *
 * `canBuildChords` is passed in rather than resolved here for the reason
 * `regenerateSlot` takes intervals rather than a scale id: resolving a key needs
 * `MusicTheoryService`, which is injected, and this file is meant to be readable
 * without one. Every caller already holds the answer - the service from
 * `ProgressionKeyContext`, both views from `ProgressionState.canBuildChords`.
 *
 * **A literal slot is not refused for being literal.** M3 Task 8 gave literal
 * harmony the degree it degraded from and taught the service to rebuild from it,
 * so a slot dragged into a cluster has a way back; `from` is null only for a
 * document written elsewhere, and that slot is refused in words rather than in
 * silence.
 *
 * `?? null` rather than a bare read, because `from` is typed
 * `ChordDegree | null | undefined` and a document parsed from a file is
 * `undefined` here at runtime whatever the type says. That divergence is exactly
 * what this function removes: the roll's copy of this predicate omitted the
 * coalesce and so reported a live button with no reason on a slot the service
 * would refuse.
 */
export function resetOutcome(canBuildChords: boolean, harmony: SlotHarmony): ResetOutcome {
  if (!canBuildChords) return { canReset: false, refusal: 'unbuildable-key' };

  const held = harmony.kind === 'degree' ? harmony.degree : harmony.from ?? null;
  if (held === null) return { canReset: false, refusal: 'no-origin' };

  return { canReset: true, held };
}
