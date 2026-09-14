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
 * - `notesApart`: the notes holding it, on several staves or voices, moved to different ticks, so carried with all of
 *   them it would be several fermatas.
 * - `becameGrace`: no ordinary beat plays at its position any more, and its note became a grace, which cannot hold a
 *   fermata alone.
 * - `noNoteThere`: no beat plays at its position any more, and its note is not one that moved: it was written over.
 */
export type FermataDropReason = 'otherTracks' | 'otherVoices' | 'ontoAnotherFermata' | 'notesApart' | 'becameGrace' | 'noNoteThere';

/** One reason per fermata an edit removed. Empty when it removed none. */
export type FermataDrops = readonly FermataDropReason[];

/** An ordinary beat holding a fermata before an edit: the beat itself, by identity, and where it played. */
export interface FermataHolder {
  beat: BeatDoc;
  trackIndex: number;
  staffIndex: number;
  voiceIndex: number;
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
 * everywhere: every voice of every staff of every track but a generated one, at the tick each beat plays, graces
 * aside. alphaTab files a fermata from any voice, and hands it to any voice. Where tracks or voices disagree - only a
 * loaded file can leave them so - the first fermata found stands for the position.
 */
export function fermataSnapshotOf(doc: ScoreDoc, barIndices: Iterable<number>): FermataSnapshot {
  const positions = new Map<number, Map<number, FermataDoc | null>>();
  const holders: FermataHolder[] = [];
  for (const barIndex of barIndices) {
    if (positions.has(barIndex)) continue;
    const bar = new Map<number, FermataDoc | null>();
    for (const { trackIndex, staffIndex, voiceIndex, beats, starts } of positionVoicesOf(doc, barIndex)) {
      beats.forEach((beat, index) => {
        if (beat.effects.grace !== 'none') return;
        const fermata = beat.effects.fermata;
        if (!bar.get(starts[index])) bar.set(starts[index], fermata ? { ...fermata } : null);
        if (fermata) holders.push({ beat, trackIndex, staffIndex, voiceIndex, barIndex, start: starts[index], fermata: { ...fermata } });
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
 * 2. **A fermata goes with its notes** when that reaches no other beat. The notes holding it at a position - held by
 *    identity in `before`, in any voice of any staff - are read together, with their own voices set aside, and those
 *    that moved carry it when all of these hold: (a) no note holding it stayed at the old position, and no ordinary beat
 *    in another voice still plays there holding a fermata, so nothing keeps it there; (b) they all moved to the same tick, since carried with notes at
 *    different ticks one fermata would become several; (c) no ordinary beat in another voice plays at that new
 *    position, which the fermata would reach; (d) the new position holds no fermata. So the notes holding a fermata on
 *    two tracks, moved alike, take it with them, and what their own voices moved onto the old place does not keep it.
 *    The old position then holds none, unless another fermata was carried onto it. Positions are tried until none
 *    moves, so a run of fermata notes that each move onto the next one's place all carry.
 * 3. Otherwise **a fermata stays at its position**: every ordinary beat playing there now, on any staff, takes it -
 *    the beat an edit moved onto it included. A beat that moved to a position that held none, or that was no
 *    position before, takes none.
 * 4. A position no beat plays at any longer, on any staff, **loses its fermata**, and so do notes that failed (b), (c)
 *    or (d) and left their position with nothing there. Nothing can hold a fermata at a tick no beat plays at.
 * 5. Every grace takes the fermata at the position it plays at (`graceFermataOf`).
 *
 * Returns a reason for each fermata of `before` that ends up nowhere (`FermataDropReason`), for the edit to say so.
 */
export function settleFermatas(doc: ScoreDoc, before: FermataSnapshot, pasted: ReadonlyMap<BeatDoc, FermataDoc> = new Map()): FermataDrops {
  const barIndices = new Set(before.positions.keys());
  for (let barIndex = before.barCount; barIndex < doc.masterBars.length; barIndex++) barIndices.add(barIndex);

  const settled = new Map<number, Map<number, FermataDoc | null>>();
  const voicesByBar = new Map<number, PositionVoice[]>();
  const located = new Map<BeatDoc, { trackIndex: number; staffIndex: number; voiceIndex: number; barIndex: number; start: number }>();
  for (const barIndex of barIndices) {
    const positions = new Map(before.positions.get(barIndex) ?? []);
    const voices = positionVoicesOf(doc, barIndex);
    for (const { trackIndex, staffIndex, voiceIndex, beats, starts } of voices) {
      beats.forEach((beat, index) => {
        if (beat.effects.grace !== 'none') return;
        located.set(beat, { trackIndex, staffIndex, voiceIndex, barIndex, start: starts[index] });
        const own = pasted.get(beat);
        if (own) positions.set(starts[index], own);
      });
    }
    settled.set(barIndex, positions);
    voicesByBar.set(barIndex, voices);
  }

  // Rule 2: the notes that moved, by the position they held a fermata at, and whether it can go with them.
  const key = (barIndex: number, start: number): string => `${barIndex}:${start}`;
  const failures = new Map<FermataHolder, FermataDropReason>();
  const heldThere = new Set<FermataHolder>();
  const carriedFrom = new Set<string>();
  const claimed = new Set<string>();
  const moved = new Map<string, { holder: FermataHolder; barIndex: number; start: number }[]>();
  /** The positions where a note holding the fermata is still in its voice at its old bar and tick. */
  const stayed = new Set<string>();
  for (const holder of before.holders) {
    const at = located.get(holder.beat);
    if (!at || at.trackIndex !== holder.trackIndex || at.staffIndex !== holder.staffIndex || at.voiceIndex !== holder.voiceIndex) continue;
    const from = key(holder.barIndex, holder.start);
    if (at.barIndex === holder.barIndex && at.start === holder.start) {
      stayed.add(from);
      continue;
    }
    moved.set(from, [...(moved.get(from) ?? []), { holder, barIndex: at.barIndex, start: at.start }]);
  }
  const pending: { holders: FermataHolder[]; barIndex: number; start: number }[] = [];
  for (const moves of moved.values()) {
    const holders = moves.map(move => move.holder);
    const [{ barIndex, start }] = moves;
    // Held there by a note that stayed - which `otherBeatsAt` cannot see when it shares a voice with one that moved - or
    // by a beat in another voice.
    const from = key(holders[0].barIndex, holders[0].start);
    if (stayed.has(from) || otherBeatsAt(doc, holders, holders[0].barIndex, holders[0].start).some(other => other.holdsPosition || other.beat.effects.fermata)) {
      holders.forEach(holder => heldThere.add(holder));
      continue;
    }
    const failWith = (reason: FermataDropReason): void => holders.forEach(holder => failures.set(holder, reason));
    if (moves.some(move => move.barIndex !== barIndex || move.start !== start)) {
      failWith('notesApart');
      continue;
    }
    const reached = otherBeatsAt(doc, holders, barIndex, start);
    if (reached.length > 0) {
      failWith(reached.some(other => !holders.some(holder => holder.trackIndex === other.trackIndex)) ? 'otherTracks' : 'otherVoices');
      continue;
    }
    pending.push({ holders, barIndex, start });
  }
  for (let carried = true; carried; ) {
    carried = false;
    for (const move of [...pending]) {
      const destination = settled.get(move.barIndex);
      if (!destination || (destination.get(move.start) ?? null) !== null) continue;
      const [{ barIndex: fromBar, start: fromStart, fermata }] = move.holders;
      destination.set(move.start, { ...fermata });
      claimed.add(key(move.barIndex, move.start));
      carriedFrom.add(key(fromBar, fromStart));
      if (!claimed.has(key(fromBar, fromStart))) settled.get(fromBar)?.set(fromStart, null);
      pending.splice(pending.indexOf(move), 1);
      carried = true;
    }
  }
  for (const { holders } of pending) holders.forEach(holder => failures.set(holder, 'ontoAnotherFermata'));

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
  const graces = new Set<BeatDoc>();
  for (const [barIndex, voices] of voicesByBar) {
    for (const { beats, starts } of voices) {
      beats.forEach((beat, index) => {
        if (beat.effects.grace === 'none') return;
        graces.add(beat);
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
      const failed = holders.map(holder => failures.get(holder)).find(reason => reason !== undefined);
      drops.push(failed ?? (holders.some(holder => graces.has(holder.beat)) ? 'becameGrace' : 'noNoteThere'));
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
  notesApart: ['the notes holding it moved apart', 'the notes holding them moved apart'],
  becameGrace: [
    'its note became a grace note, which cannot hold a fermata of its own',
    'their notes became grace notes, which cannot hold fermatas of their own'
  ],
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

/** One voice of one bar on a staff that is not generated, with the tick each beat plays at. */
interface PositionVoice {
  trackIndex: number;
  staffIndex: number;
  voiceIndex: number;
  beats: BeatDoc[];
  starts: number[];
}

/** Every voice of bar `barIndex` on every staff of every track but a generated one: where a fermata position is read. */
function positionVoicesOf(doc: ScoreDoc, barIndex: number): PositionVoice[] {
  const voices: PositionVoice[] = [];
  doc.tracks.forEach((track, trackIndex) => {
    if (track.generated) return;
    track.staves.forEach((staff, staffIndex) => {
      staff.bars[barIndex]?.voices.forEach(({ beats }, voiceIndex) => {
        voices.push({ trackIndex, staffIndex, voiceIndex, beats, starts: playbackStartsOf(beats) });
      });
    });
  });
  return voices;
}

/**
 * Every ordinary beat playing at `start` in bar `barIndex` but those in the voices `holders` are in: in any voice of any
 * staff of any track, generated ones included, since alphaTab files and hands on a fermata in all of them.
 * `holdsPosition` marks a beat that settling gives the position's fermata - one on a staff that is not generated.
 */
function otherBeatsAt(
  doc: ScoreDoc,
  holders: readonly FermataHolder[],
  barIndex: number,
  start: number
): { trackIndex: number; beat: BeatDoc; holdsPosition: boolean }[] {
  const found: { trackIndex: number; beat: BeatDoc; holdsPosition: boolean }[] = [];
  doc.tracks.forEach((track, trackIndex) =>
    track.staves.forEach((staff, staffIndex) =>
      staff.bars[barIndex]?.voices.forEach((voice, voiceIndex) => {
        const own = holders.some(holder => holder.trackIndex === trackIndex && holder.staffIndex === staffIndex && holder.voiceIndex === voiceIndex);
        if (own) return;
        const starts = playbackStartsOf(voice.beats);
        voice.beats.forEach((beat, index) => {
          if (beat.effects.grace === 'none' && starts[index] === start) found.push({ trackIndex, beat, holdsPosition: !track.generated });
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
