import { BeatDoc, FermataDoc, ScoreDoc } from '../models/composer.model';
import { playbackStartsOf } from './bar-fill';
import { BeatRef } from './composer-selection';

/**
 * A fermata through an edit that moves beats: where it stands afterwards, on every track, and what the edit says
 * when it could keep a fermata nowhere.
 *
 * alphaTab finishes tracks in order, and each voice's beats in order, and files a beat's fermata on the master bar
 * at the tick the beat plays at, handing it to every beat finished later at that tick without one (`Voice.finish`,
 * `alphaTab.core.mjs` ~3226-3294; `MasterBar.addFermata` ~2705; `MasterBar.getFermata` ~2728). So a fermata
 * belongs to a bar position (the design's M2 decision 2), and a position is the tick a beat plays at
 * (`playbackStartsOf`), which is not always where it is drawn: a beat after on-beat graces plays after them.
 *
 * Lifted out of `beat-edits.ts`, which every edit that moves beats calls it from, to keep that file readable.
 */

/**
 * Why an edit could keep a fermata neither at its position nor on its note (`settleFermatas`):
 * - `otherTracks`: its note moved to where another track has a beat, which would take the fermata on save.
 * - `otherVoices`: the same, where the beat is on another staff or voice of the note's own track.
 * - `ontoAnotherFermata`: its note moved to a position that holds a fermata already.
 * - `noNoteThere`: no beat starts at its position any more, and its note is not one that moved - it was written
 *   over, or became a grace.
 */
export type FermataDropReason = 'otherTracks' | 'otherVoices' | 'ontoAnotherFermata' | 'noNoteThere';

/** One reason per fermata an edit removed. Empty when it removed none. */
export type FermataDrops = readonly FermataDropReason[];

/** An ordinary beat holding a fermata before an edit: the beat itself, by identity, and where it played. */
export interface FermataHolder {
  beat: BeatDoc;
  trackIndex: number;
  staffIndex: number;
  barIndex: number;
  /** Its playback start in its bar (`playbackStartsOf`). */
  start: number;
  fermata: FermataDoc;
}

/** Each bar position's fermata before an edit, for the bars it may move beats in. See `settleFermatas`. */
export interface FermataSnapshot {
  /** By bar index, the fermata at every tick where an ordinary beat plays on some staff, or null where none there has one. */
  readonly positions: ReadonlyMap<number, ReadonlyMap<number, FermataDoc | null>>;
  /** Every ordinary beat that held a fermata. */
  readonly holders: readonly FermataHolder[];
  /** How many bars the score had: a bar appended since is settled as one that held no fermata. */
  readonly barCount: number;
}

/**
 * The fermata at every bar position of the bars `barIndices`, and the beats holding them, read as a position is read
 * everywhere: voice 1 of every staff of every track but a generated one, at the tick each beat plays, graces aside.
 * Where tracks disagree - only a loaded file can leave them so - the first fermata found stands for the position.
 */
export function fermataSnapshotOf(doc: ScoreDoc, barIndices: Iterable<number>): FermataSnapshot {
  const positions = new Map<number, Map<number, FermataDoc | null>>();
  const holders: FermataHolder[] = [];
  for (const barIndex of barIndices) {
    if (positions.has(barIndex)) continue;
    const bar = new Map<number, FermataDoc | null>();
    for (const { trackIndex, staffIndex, beats, starts } of positionVoicesOf(doc, barIndex)) {
      beats.forEach((beat, index) => {
        if (beat.effects.grace !== 'none') return;
        const fermata = beat.effects.fermata;
        if (!bar.get(starts[index])) bar.set(starts[index], fermata ? { ...fermata } : null);
        if (fermata) holders.push({ beat, trackIndex, staffIndex, barIndex, start: starts[index], fermata: { ...fermata } });
      });
    }
    positions.set(barIndex, bar);
  }
  return { positions, holders, barCount: doc.masterBars.length };
}

/**
 * Puts every fermata in the bars of `before` where it belongs after an edit that moved beat starts - a length
 * change, an insert, a delete, a paste, Fix bar - on every track, and returns why each one it could not keep went.
 *
 * A fermata filed at a tick reaches every beat finished later at that tick, so a fermata beat an edit moves takes it
 * to its new tick and, on save, to every later track's beat there, while the tracks it left keep theirs. So:
 *
 * 1. `pasted` beats, graces aside, bring their own fermata, which wins at the position they land on (`pasteBeats`).
 * 2. **A fermata goes with its note** when that reaches no other beat. The note - held by identity in `before` - has
 *    moved, and all of these hold: (a) no ordinary beat on another staff, or in another voice of the note's staff,
 *    still plays at the old position holding a fermata, so nothing keeps it there; (b) no ordinary beat on another
 *    staff or voice plays at the note's new position, which the fermata would reach; (c) the new position holds no
 *    fermata. The old position then holds none, unless another fermata was carried onto it. Notes are tried until
 *    none moves, so a run of fermata notes that each move onto the next one's place all carry.
 * 3. Otherwise **a fermata stays at its position**: every ordinary beat playing there now, on any staff, takes it -
 *    the beat an edit moved onto it included. A beat that moved to a position that held none, or that was no
 *    position before, takes none.
 * 4. A position no beat plays at any longer, on any staff, **loses its fermata**, and so does a note that failed (b)
 *    or (c) and left its position with nothing there. Nothing can hold a fermata at a tick no beat plays at.
 * 5. Every grace takes the fermata at the position it plays at (`graceFermataOf`).
 *
 * Returns a reason for each fermata of `before` that ends up nowhere (`FermataDropReason`), for the edit to say so.
 */
export function settleFermatas(doc: ScoreDoc, before: FermataSnapshot, pasted: ReadonlyMap<BeatDoc, FermataDoc> = new Map()): FermataDrops {
  const barIndices = new Set(before.positions.keys());
  for (let barIndex = before.barCount; barIndex < doc.masterBars.length; barIndex++) barIndices.add(barIndex);

  const settled = new Map<number, Map<number, FermataDoc | null>>();
  const voicesByBar = new Map<number, PositionVoice[]>();
  const located = new Map<BeatDoc, { trackIndex: number; staffIndex: number; barIndex: number; start: number }>();
  for (const barIndex of barIndices) {
    const positions = new Map(before.positions.get(barIndex) ?? []);
    const voices = positionVoicesOf(doc, barIndex);
    for (const { trackIndex, staffIndex, beats, starts } of voices) {
      beats.forEach((beat, index) => {
        if (beat.effects.grace !== 'none') return;
        located.set(beat, { trackIndex, staffIndex, barIndex, start: starts[index] });
        const own = pasted.get(beat);
        if (own) positions.set(starts[index], own);
      });
    }
    settled.set(barIndex, positions);
    voicesByBar.set(barIndex, voices);
  }

  // Rule 2: the notes that moved, and whether each fermata can go with its note.
  const key = (barIndex: number, start: number): string => `${barIndex}:${start}`;
  const failures = new Map<FermataHolder, FermataDropReason>();
  const heldThere = new Set<FermataHolder>();
  const carriedFrom = new Set<string>();
  const claimed = new Set<string>();
  const pending: { holder: FermataHolder; barIndex: number; start: number }[] = [];
  for (const holder of before.holders) {
    const at = located.get(holder.beat);
    if (!at || at.trackIndex !== holder.trackIndex || at.staffIndex !== holder.staffIndex) continue;
    if (at.barIndex === holder.barIndex && at.start === holder.start) continue;
    if (otherBeatsAt(doc, holder, holder.barIndex, holder.start).some(other => other.holdsPosition || other.beat.effects.fermata)) {
      heldThere.add(holder);
      continue;
    }
    const reached = otherBeatsAt(doc, holder, at.barIndex, at.start);
    if (reached.length > 0) {
      failures.set(holder, reached.some(other => other.trackIndex !== holder.trackIndex) ? 'otherTracks' : 'otherVoices');
      continue;
    }
    pending.push({ holder, barIndex: at.barIndex, start: at.start });
  }
  for (let carried = true; carried; ) {
    carried = false;
    for (const move of [...pending]) {
      const destination = settled.get(move.barIndex);
      if (!destination || (destination.get(move.start) ?? null) !== null) continue;
      const { holder } = move;
      destination.set(move.start, { ...holder.fermata });
      claimed.add(key(move.barIndex, move.start));
      carriedFrom.add(key(holder.barIndex, holder.start));
      if (!claimed.has(key(holder.barIndex, holder.start))) settled.get(holder.barIndex)?.set(holder.start, null);
      pending.splice(pending.indexOf(move), 1);
      carried = true;
    }
  }
  for (const { holder } of pending) failures.set(holder, 'ontoAnotherFermata');

  // Rules 3 and 4, then 5.
  const playingNow = new Map<number, Set<number>>();
  for (const [barIndex, voices] of voicesByBar) {
    const ticks = new Set<number>();
    for (const { beats, starts } of voices) {
      beats.forEach((beat, index) => {
        if (beat.effects.grace !== 'none') return;
        setFermata(beat, settled.get(barIndex)?.get(starts[index]) ?? null);
        ticks.add(starts[index]);
      });
    }
    playingNow.set(barIndex, ticks);
  }
  for (const [barIndex, voices] of voicesByBar) {
    for (const { beats, starts } of voices) {
      beats.forEach((beat, index) => {
        if (beat.effects.grace === 'none') return;
        setFermata(beat, playingNow.get(barIndex)?.has(starts[index]) ? settled.get(barIndex)?.get(starts[index]) ?? null : null);
      });
    }
  }

  const drops: FermataDropReason[] = [];
  for (const [barIndex, positions] of before.positions) {
    for (const [start, fermata] of positions) {
      if (!fermata || carriedFrom.has(key(barIndex, start)) || playingNow.get(barIndex)?.has(start)) continue;
      const holders = before.holders.filter(holder => holder.barIndex === barIndex && holder.start === start);
      if (holders.some(holder => heldThere.has(holder))) continue;
      drops.push(holders.map(holder => failures.get(holder)).find(reason => reason !== undefined) ?? 'noNoteThere');
    }
  }
  return drops;
}

/**
 * The fermata the grace `ref` names holds by the per-position rule: the one standing on the ordinary beats that play
 * at the tick the grace plays at, on any track but a generated one (`playbackStartsOf`) - or none, when no ordinary
 * beat plays there or none there has one. alphaTab files a grace's fermata at that tick, so any other value spreads
 * to every later track's beat there on save, or is replaced by the one filed there on load.
 */
export function graceFermataOf(doc: ScoreDoc, ref: BeatRef): FermataDoc | null {
  const beats = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex]?.voices[ref.voiceIndex]?.beats ?? [];
  const tick = playbackStartsOf(beats)[ref.beatIndex];
  if (tick === undefined) return null;
  for (const voice of positionVoicesOf(doc, ref.barIndex)) {
    const standing = voice.beats.find((beat, index) => voice.starts[index] === tick && beat.effects.grace === 'none' && beat.effects.fermata);
    if (standing?.effects.fermata) return { ...standing.effects.fermata };
  }
  return null;
}

/** Why fermatas went, one clause per reason, for one fermata and for several. */
const DROP_CLAUSES: Readonly<Record<FermataDropReason, readonly [string, string]>> = {
  otherTracks: ['its note moved where it would reach other tracks', 'their notes moved where they would reach other tracks'],
  otherVoices: [
    'its note moved where it would reach another staff or voice of its track',
    'their notes moved where they would reach another staff or voice of their track'
  ],
  ontoAnotherFermata: ["its note moved onto another fermata's place", "their notes moved onto other fermatas' places"],
  noNoteThere: ['no note starts at its place any more', 'no note starts at their places any more']
};

/**
 * What an edit says about the fermatas it removed, or null when it removed none: "1 fermata removed: its note moved
 * where it would reach other tracks." One sentence per reason.
 */
export function fermataNoticeOf(drops: FermataDrops): string | null {
  const sentences = (Object.keys(DROP_CLAUSES) as FermataDropReason[]).flatMap(reason => {
    const count = drops.filter(drop => drop === reason).length;
    if (count === 0) return [];
    return [`${count} ${count === 1 ? 'fermata' : 'fermatas'} removed: ${DROP_CLAUSES[reason][count === 1 ? 0 : 1]}.`];
  });
  return sentences.length > 0 ? sentences.join(' ') : null;
}

/** Voice 1 of one bar on a staff that is not generated, with the tick each beat plays at. */
interface PositionVoice {
  trackIndex: number;
  staffIndex: number;
  beats: BeatDoc[];
  starts: number[];
}

/** Voice 1 of bar `barIndex` on every staff of every track but a generated one: where a fermata position is read. */
function positionVoicesOf(doc: ScoreDoc, barIndex: number): PositionVoice[] {
  const voices: PositionVoice[] = [];
  doc.tracks.forEach((track, trackIndex) => {
    if (track.generated) return;
    track.staves.forEach((staff, staffIndex) => {
      const beats = staff.bars[barIndex]?.voices[0]?.beats;
      if (beats) voices.push({ trackIndex, staffIndex, beats, starts: playbackStartsOf(beats) });
    });
  });
  return voices;
}

/**
 * Every ordinary beat playing at `start` in bar `barIndex` but those in voice 1 of `holder`'s own staff: in any voice
 * of any staff of any track, generated ones included, since alphaTab files and hands on a fermata in all of them.
 * `holdsPosition` marks a beat that settling gives the position's fermata - voice 1 of a staff that is not generated.
 */
function otherBeatsAt(
  doc: ScoreDoc,
  holder: FermataHolder,
  barIndex: number,
  start: number
): { trackIndex: number; beat: BeatDoc; holdsPosition: boolean }[] {
  const found: { trackIndex: number; beat: BeatDoc; holdsPosition: boolean }[] = [];
  doc.tracks.forEach((track, trackIndex) =>
    track.staves.forEach((staff, staffIndex) =>
      staff.bars[barIndex]?.voices.forEach((voice, voiceIndex) => {
        if (trackIndex === holder.trackIndex && staffIndex === holder.staffIndex && voiceIndex === 0) return;
        const starts = playbackStartsOf(voice.beats);
        voice.beats.forEach((beat, index) => {
          if (beat.effects.grace === 'none' && starts[index] === start) {
            found.push({ trackIndex, beat, holdsPosition: voiceIndex === 0 && !track.generated });
          }
        });
      })
    )
  );
  return found;
}

/**
 * Gives `beat` `fermata`, when it holds another. A new effects object, since a spread-copied beat can share its
 * effects with another.
 */
function setFermata(beat: BeatDoc, fermata: FermataDoc | null): void {
  const current = beat.effects.fermata;
  if (current === fermata || (current && fermata && current.type === fermata.type && current.length === fermata.length)) return;
  beat.effects = { ...beat.effects, fermata: fermata ? { ...fermata } : null };
}
