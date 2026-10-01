import type { ScoreDoc, TimeSignature } from './composer.model';
import type { ChordSlot, ProgressionKey } from './progression.model';

/**
 * A song: one ProseMirror document, and the few facts the library keeps beside
 * it.
 *
 * Everything that defines the song lives in `content` - its key, tempo,
 * sections, words and chords - so one undo history covers all of it and a later
 * sync provider (design Part 8) syncs one thing. The fields around `content`
 * are the record's, not the song's: which record it is, how many times it has
 * been written, and when.
 *
 * The schema that `content` follows is `services/song-schema.ts`; the
 * derivations that read it are `services/song-document.ts`. This file holds
 * only the shapes, so a module that stores or lists songs need not import
 * ProseMirror to name them.
 */
export interface SongDoc {
  id: string;
  /**
   * How many times the record has been written, counting from 0 for one never
   * saved. The library bumps it on each save, so two copies of a song can be
   * told apart without comparing their content.
   */
  revision: number;
  /**
   * Epoch milliseconds rather than `Date`, unlike `CompositionEntry`: a number
   * survives `JSON.stringify` - which an export or a sync message goes through -
   * where a `Date` comes back as a string nobody re-parses.
   */
  createdAt: number;
  updatedAt: number;
  /**
   * The ProseMirror document as `Node.toJSON()` writes it.
   *
   * Typed loosely on purpose: a record read back from IndexedDB is whatever was
   * stored, which after a bug or a hand-edited import may not be a song at all.
   * `songNodeOf` is the one door from this to a document, and it refuses with a
   * reason rather than trusting the type.
   */
  content: Readonly<Record<string, unknown>>;
}

/**
 * What the library's list shows for one song, without the content.
 *
 * Derived from the record by `songSummaryOf` rather than stored beside it, so
 * the card can never disagree with the sheet it opens.
 */
export interface SongSummary {
  id: string;
  title: string;
  artist: string;
  /** Null exactly when `unreadable` is set: a song that cannot be read has no key to show. */
  key: ProgressionKey | null;
  sectionCount: number;
  updatedAt: number;
  /**
   * Why the song's content cannot be opened, or null when it can.
   *
   * A corrupt record still gets a card - with its title if the title is still
   * readable - so the user can see it is there and delete it. Leaving it off the
   * list would be dropping it silently, which the design rules out (Part 6).
   */
  unreadable: string | null;
}

/**
 * The song's own facts: the `doc` node's attributes.
 *
 * On the document rather than beside it so a key change or a tempo change is a
 * step in the same undo history as the words (design Part 1). Every section
 * shares them; a section's progression borrows them (`sectionProgressionOf`).
 */
export interface SongMeta {
  title: string;
  artist: string;
  /** Reused from the progression page as it is, `preferSharps` included. */
  key: ProgressionKey;
  /** BPM. */
  tempo: number;
  timeSignature: TimeSignature;
}

/**
 * What a section is for.
 *
 * `pre` is a pre-chorus. The kind is what the section *is*; the label is what
 * it is *called* ("Chorus 2", "Middle eight"), and the two are kept apart so a
 * renamed section still plays, prints and exports as what it is.
 */
export type SectionKind = 'intro' | 'verse' | 'pre' | 'chorus' | 'bridge' | 'outro' | 'other';

/** Every kind, in the order a song usually meets them; the "+ Section" menu's order. */
export const SECTION_KINDS: readonly SectionKind[] = Object.freeze([
  'intro',
  'verse',
  'pre',
  'chorus',
  'bridge',
  'outro',
  'other'
]);

/** A section node's attributes. */
export interface SectionAttrs {
  id: string;
  label: string;
  kind: SectionKind;
}

/**
 * A chord atom's attributes: a whole `ChordSlot`, less its `startBeat`.
 *
 * **`startBeat` is left out on purpose.** It is derived - the beats of the
 * chords before this one in its section, summed - so a stored copy could only
 * ever agree with that sum or be wrong, and every move, insert and delete would
 * have to rewrite every later atom to keep it agreeing. Omitting it makes the
 * wrong state unrepresentable; `sectionProgressionOf` puts it back.
 *
 * Built from `ChordSlot` rather than listed again, so a field the progression
 * model gains is a field the atom must carry: the schema's per-attribute
 * checks (`CHORD_CHECKS` in `song-schema.ts`) and `atomAttrsOf` stop compiling
 * until it does.
 */
export type ChordAtomAttrs = Omit<ChordSlot, 'startBeat'>;

/**
 * A tab block's attributes (milestone S3). Declared in S1 so a song saved now
 * opens unchanged when tab blocks arrive: no schema migration.
 */
export interface TabBlockAttrs {
  id: string;
  name: string;
  /** One track, in the composer's model, kept to the song's tempo and time signature. */
  score: ScoreDoc;
}

/**
 * A voice memo's attributes (milestone S4), declared now for the same reason as
 * `TabBlockAttrs`.
 *
 * The audio is not here. It lives in its own store, keyed by `id`, so binary
 * data stays out of the undo history and out of a future sync (design Part 1).
 */
export interface MemoAttrs {
  id: string;
  name: string;
  durationSec: number;
}
