import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, Observable } from 'rxjs';

import { ProgressionComponent } from './progression.component';
import { CircleOfFifthsComponent } from '../circle-of-fifths/circle-of-fifths.component';
import { createOwnership } from '../../models/progression-normalize';
import { ProgressionDoc, ProgressionState } from '../../models/progression.model';
import { MusicTheoryState } from '../../models/music-theory.model';
import { CIRCLE_POSITIONS } from '../../services/circle-of-fifths.data';
import { MusicTheoryService } from '../../services/music-theory.service';
import { ProgressionPlayerService } from '../../services/progression-player.service';
import { ProgressionService } from '../../services/progression.service';

/**
 * The page shell: what it composes, and the three things it owns.
 *
 * ## The player is faked, and the page's own providers are why
 *
 * `ProgressionComponent` provides `PROGRESSION_AUDIO` and the player itself -
 * that is what keeps Tone out of the eager bundle, see the component - so a
 * fixture built from it unaltered would construct a real `PolySynth`, `Reverb`
 * and convolution on the headless browser's audio context. `overrideComponent`
 * replaces that provider list wholesale with one fake, which the transport
 * below then resolves from the same node injector a real player would come
 * from.
 *
 * ## The circle is driven for real
 *
 * The invariant the page exists to hold is that turning the circle moves the
 * *progression's* key and not only the app's, and `ProgressionService.setKey`
 * is public with nothing else calling it. So one test builds the real
 * `CircleOfFifthsComponent` beside the page - which is where it lives in the
 * app, in the shell rather than on the page - clicks its inner ring through the
 * component's own method, and reads the progression back. The rest of the key
 * tests drive `MusicTheoryService` directly, because they are about which
 * selections the page adopts rather than about the circle.
 */
class FakePlayer {
  private readonly currentSlotSubject = new BehaviorSubject<string | null>(null);

  readonly currentSlot$: Observable<string | null> = this.currentSlotSubject.asObservable();

  readonly played: ProgressionDoc[] = [];

  /** The documents handed over for the loop boundary, in order. */
  readonly updated: ProgressionDoc[] = [];

  stops = 0;

  isLooping = false;

  play(doc: ProgressionDoc): Promise<void> {
    this.played.push(doc);
    return Promise.resolve();
  }

  update(doc: ProgressionDoc): void {
    this.updated.push(doc);
  }

  /**
   * Stopping empties the cursor, as the real one's `halt` does.
   *
   * Not decoration: restoring the user's key when playback stops is the page's
   * job, and the *only* signal it gets is this emission. A fake that merely
   * counted stops would let a page that never restored anything pass.
   */
  stop(): void {
    this.stops++;
    this.publish(null);
  }

  setLoop(on: boolean): void {
    this.isLooping = on;
  }

  /**
   * A cue reached: the sounding slot changed.
   *
   * De-duplicated the way `ProgressionPlayerService.publishSlot` de-duplicates,
   * so a test cannot get an emission out of this fake that the real player
   * would have swallowed.
   */
  publish(slotId: string | null): void {
    if (this.currentSlotSubject.getValue() === slotId) return;
    this.currentSlotSubject.next(slotId);
  }
}

describe('ProgressionComponent', () => {
  let fixture: ComponentFixture<ProgressionComponent>;
  let component: ProgressionComponent;
  let progression: ProgressionService;
  let musicTheory: MusicTheoryService;
  let player: FakePlayer;

  /** The key the progression is in, as the two numbers that decide it. */
  function key(): { tonic: number; scaleId: string } {
    const current = progression.doc.key;
    return { tonic: current.tonic, scaleId: current.scaleId };
  }

  /**
   * What the service is publishing now. `BehaviorSubject`, so synchronous -
   * the same helper `progression.service.spec.ts` uses, written the same way.
   */
  function currentState(): ProgressionState {
    let captured: ProgressionState | undefined;
    progression.getState().subscribe(value => (captured = value)).unsubscribe();
    if (captured === undefined) throw new Error('getState published nothing on subscribe');
    return captured;
  }

  /** The app-wide selection, as the three fields the fretboard draws from. */
  function selection(): { key: string; categoryId: string; itemId: string } {
    const state: MusicTheoryState = musicTheory.getCurrentState();
    return {
      key: state.selectedKey,
      categoryId: state.selectedCategory,
      itemId: state.selectedItem
    };
  }

  /** The id of the nth slot, which is what a cue names. */
  function slotId(index: number): string {
    const slot = progression.doc.slots[index];
    if (!slot) throw new Error(`the progression has no slot ${index}`);
    return slot.id;
  }

  /** A key press on the document, as a real one would arrive. */
  function press(init: KeyboardEventInit): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  }

  /**
   * The same press with the focus inside a text box.
   *
   * A real element rather than the transport's own tempo box: what matters is
   * that the event's target is editable, and reaching into another component's
   * DOM to find one would pin its structure for no gain.
   */
  function pressInATextBox(init: KeyboardEventInit): void {
    const box = document.createElement('input');
    document.body.appendChild(box);
    try {
      box.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    } finally {
      box.remove();
    }
  }

  beforeEach(async () => {
    player = new FakePlayer();

    await TestBed.configureTestingModule({
      imports: [ProgressionComponent]
    })
      .overrideComponent(ProgressionComponent, {
        set: { providers: [{ provide: ProgressionPlayerService, useValue: player }] }
      })
      .compileComponents();

    progression = TestBed.inject(ProgressionService);
    musicTheory = TestBed.inject(MusicTheoryService);

    fixture = TestBed.createComponent(ProgressionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // -------------------------------------------------------------------------
  // Composition
  // -------------------------------------------------------------------------

  it('composes the palette, the roll, the strip and the transport', () => {
    const page: HTMLElement = fixture.nativeElement;

    expect(page.querySelector('app-chord-palette')).not.toBeNull();
    expect(page.querySelector('app-piano-roll')).not.toBeNull();
    expect(page.querySelector('app-progression-strip')).not.toBeNull();
    expect(page.querySelector('app-progression-transport')).not.toBeNull();
  });

  /**
   * The roll opens on whatever the strip has selected, and it learns that from
   * the published state rather than from an input this shell relays. Asserted
   * from the page rather than in the roll's own spec, because what is being
   * checked is that the two components are wired to one service and not that
   * either works: appending a chord selects it, and the roll draws its notes.
   */
  it('shows the selected chord in the roll without the shell passing it over', () => {
    progression.appendSlot(0);
    fixture.detectChanges();

    const page: HTMLElement = fixture.nativeElement;
    expect(page.querySelectorAll('app-piano-roll .note').length).toBe(
      progression.doc.slots[0].notes.length
    );
  });

  it('names the key the progression is in', () => {
    musicTheory.selectKeyAndMode('A', 'diatonicModes', 'aeolian');
    fixture.detectChanges();

    expect(component.keyName).toBe('A Aeolian (Natural Minor)');
  });

  // -------------------------------------------------------------------------
  // The circle, which is this page's key selector
  // -------------------------------------------------------------------------

  describe('the key it takes from the circle', () => {
    it('moves the progression when the circle turns', () => {
      const circle = TestBed.createComponent(CircleOfFifthsComponent);
      circle.detectChanges();

      // The inner ring of the C position: A minor.
      circle.componentInstance.selectMinor(CIRCLE_POSITIONS[0]);

      expect(musicTheory.getCurrentState().selectedKey).toBe('A');
      expect(key()).toEqual({ tonic: 9, scaleId: 'aeolian' });
    });

    /**
     * Six o'clock is two keys, and which one was clicked is the whole reason
     * that wedge is split in half.
     *
     * F sharp major and G flat major are the same pitch class, so a page that
     * carries only the pitch class across cannot tell them apart - and
     * `keySignatureKind` asked about pitch class 6 finds the F sharp position,
     * because that is the one the circle stores. The app itself has already
     * decided: `shouldUseSharps` reads the key *name*, so selecting G flat puts
     * the fretboard into flats. These two pin that the progression ends up
     * where the fretboard and the drawer already are.
     *
     * This is `b514027` one layer up. That commit taught `spellingFor` to read
     * a minor key's own signature rather than its scale's default; the input it
     * reads had already lost the distinction by the time it arrived.
     */
    it('keeps the flat spelling of an enharmonic major key', () => {
      const circle = TestBed.createComponent(CircleOfFifthsComponent);
      circle.detectChanges();

      // The outer ring of the six o'clock position, enharmonic half: G flat.
      circle.componentInstance.selectMajor(CIRCLE_POSITIONS[6], true);

      expect(key()).toEqual({ tonic: 6, scaleId: 'ionian' });
      expect(progression.doc.key.preferSharps).toBeFalse();
      expect(component.keyName).toBe('Gb Ionian (Major)');
    });

    it('keeps the sharp spelling of the other half of the same wedge', () => {
      const circle = TestBed.createComponent(CircleOfFifthsComponent);
      circle.detectChanges();

      circle.componentInstance.selectMajor(CIRCLE_POSITIONS[6]);

      expect(key()).toEqual({ tonic: 6, scaleId: 'ionian' });
      expect(progression.doc.key.preferSharps).toBeTrue();
      expect(component.keyName).toBe('F# Ionian (Major)');
    });

    /** The inner ring of the same wedge: E flat minor against D sharp minor. */
    it('keeps the flat spelling of an enharmonic minor key', () => {
      const circle = TestBed.createComponent(CircleOfFifthsComponent);
      circle.detectChanges();

      circle.componentInstance.selectMinor(CIRCLE_POSITIONS[6], true);

      expect(key()).toEqual({ tonic: 3, scaleId: 'aeolian' });
      expect(progression.doc.key.preferSharps).toBeFalse();
      expect(component.keyName).toBe('Eb Aeolian (Natural Minor)');
    });

    it('adopts the key the app is already in when the page opens', () => {
      musicTheory.selectKeyAndMode('Eb', 'diatonicModes', 'ionian');

      const opened = TestBed.createComponent(ProgressionComponent);
      opened.detectChanges();

      expect(key()).toEqual({ tonic: 3, scaleId: 'ionian' });
    });

    /**
     * A key change is a commit and a commit is an undo step, so a page that
     * pushed the key it already had would spend one on being opened - and
     * `MusicTheoryService` emits for the instrument and the tuning too.
     */
    it('costs no undo step when the app is already in the progression key', () => {
      musicTheory.updateInstrument('piano');
      musicTheory.selectKeyAndMode('C', 'diatonicModes', 'ionian');

      expect(currentState().canUndo).toBeFalse();
    });

    /**
     * The guard that keeps `light` from eating the key. It publishes the
     * *sounding chord* through `selectKeyAndMode(root, 'triads', chordId)`, and
     * a page that adopted every selection would drag the progression onto the
     * root of whatever chord happened to be sounding.
     *
     * A real category, because a real chord selection is the thing that has to
     * be refused. This test named `'chords'` before, which is no category in
     * `MusicTheoryService` at all - so it asserted that an *unresolvable*
     * selection is refused, which is true and a different sentence. The user
     * can reach `triads` from the fretboard's own category dropdown, and
     * `light` publishes it several times a bar.
     */
    it('ignores a selection that names a chord rather than a key', () => {
      musicTheory.selectKeyAndMode('A', 'diatonicModes', 'aeolian');
      musicTheory.selectKeyAndMode('D', 'triads', 'major');

      expect(key()).toEqual({ tonic: 9, scaleId: 'aeolian' });
    });

    /**
     * The same question in the other direction, and the one "does this resolve
     * to a scale?" got wrong. `fretboardNotes` is a scale category, so its five
     * display modes resolve to a `Scale` and were adopted as keys: "All Notes
     * (Sharps)" replaced the palette with a twelve-note refusal message, and
     * "Natural Notes" left it working under a key called `Natural Notes (No
     * Sharps/Flats)`.
     *
     * The app already knows these name no key - `isKeyDisabled` is what greys
     * out its own key selector for exactly them - and `isKeySelection` is that
     * fact asked once rather than restated here.
     */
    it('ignores a fretboard-notes display mode, which names no key', () => {
      musicTheory.selectKeyAndMode('A', 'diatonicModes', 'aeolian');
      musicTheory.selectKeyAndMode('D', 'fretboardNotes', 'allNotesSharp');

      expect(key()).toEqual({ tonic: 9, scaleId: 'aeolian' });
    });

    /**
     * `naturalNotes` is the sharp one: it is seven notes, so it builds chords
     * happily and the palette shows no sign of anything being wrong. Only the
     * name gives it away.
     */
    it('ignores the natural-notes mode, which builds chords and is no key', () => {
      musicTheory.selectKeyAndMode('A', 'diatonicModes', 'aeolian');
      musicTheory.selectKeyAndMode('D', 'fretboardNotes', 'naturalNotes');

      expect(key()).toEqual({ tonic: 9, scaleId: 'aeolian' });
    });

    /**
     * One direction only, which is what keeps the fretboard's own selection
     * intact across a visit to this page. `light` adds the other direction and
     * has to restore what it overwrites; nothing else here writes at all.
     */
    it('leaves the app-wide selection alone', () => {
      musicTheory.selectKeyAndMode('E', 'diatonicModes', 'aeolian');

      progression.setKey(5, 'ionian');
      fixture.destroy();

      const state = musicTheory.getCurrentState();
      expect(state.selectedKey).toBe('E');
      expect(state.selectedItem).toBe('aeolian');
    });

    it('stops mirroring once the page is gone', () => {
      fixture.destroy();

      musicTheory.selectKeyAndMode('A', 'diatonicModes', 'aeolian');

      expect(key()).toEqual({ tonic: 0, scaleId: 'ionian' });
    });
  });

  // -------------------------------------------------------------------------
  // Undo from the keyboard
  // -------------------------------------------------------------------------

  describe('the keyboard half of undo', () => {
    beforeEach(() => {
      progression.appendSlot(0);
    });

    it('undoes on Ctrl+Z', () => {
      press({ key: 'z', ctrlKey: true });

      expect(progression.doc.slots.length).toBe(0);
    });

    it('undoes on Cmd+Z, for the other keyboard', () => {
      press({ key: 'z', metaKey: true });

      expect(progression.doc.slots.length).toBe(0);
    });

    it('redoes on Ctrl+Y', () => {
      press({ key: 'z', ctrlKey: true });
      press({ key: 'y', ctrlKey: true });

      expect(progression.doc.slots.length).toBe(1);
    });

    it('redoes on Ctrl+Shift+Z', () => {
      press({ key: 'z', ctrlKey: true });
      press({ key: 'Z', ctrlKey: true, shiftKey: true });

      expect(progression.doc.slots.length).toBe(1);
    });

    it('leaves Z alone without the modifier', () => {
      press({ key: 'z' });

      expect(progression.doc.slots.length).toBe(1);
    });

    /**
     * Windows reports AltGr as Ctrl+Alt, and `AltGr+Z` types a character on
     * several European layouts. Undoing instead - and swallowing the keystroke
     * with `preventDefault` on the way - is a bug the user cannot describe.
     */
    it('leaves an AltGr combination to the keyboard layout', () => {
      press({ key: 'z', ctrlKey: true, altKey: true });

      expect(progression.doc.slots.length).toBe(1);
    });

    /**
     * The tempo box is on this page, and Ctrl+Z in a text box means undo the
     * typing. Stealing it would leave the user unable to take back a keystroke.
     */
    it('leaves the shortcut to a text box that has the focus', () => {
      pressInATextBox({ key: 'z', ctrlKey: true });

      expect(progression.doc.slots.length).toBe(1);
    });

    it('stops listening once the page is gone', () => {
      fixture.destroy();

      press({ key: 'z', ctrlKey: true });

      expect(progression.doc.slots.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // The backing track: what the fretboard shows while a progression plays
  // -------------------------------------------------------------------------

  /**
   * The other direction, and the one that has to give the key back.
   *
   * The page writes the sounding chord into `MusicTheoryService` so the
   * fretboard lights it, which means it is overwriting a selection the user
   * made. Every test here is about one of the two halves of that: what gets
   * published, and that the user's own selection comes back.
   */
  describe('the chord it lights the fretboard with', () => {
    beforeEach(() => {
      // A minor, so the key, the category and the item all differ from what the
      // chords below publish - a restore that put back only two of the three
      // would still pass if any of them agreed by accident.
      musicTheory.selectKeyAndMode('A', 'diatonicModes', 'aeolian');
    });

    it('publishes nothing until something sounds', () => {
      expect(selection()).toEqual({
        key: 'A',
        categoryId: 'diatonicModes',
        itemId: 'aeolian'
      });
    });

    it('lights the sounding chord', () => {
      // iv of A minor: D minor.
      progression.appendSlot(3);
      player.publish(slotId(0));

      expect(selection()).toEqual({ key: 'D', categoryId: 'triads', itemId: 'minor' });
    });

    /**
     * A quality is a chord id, and the id says which category holds it: the
     * triads and the sevenths are two categories in `MusicTheoryService`, so a
     * page that hardcoded one would light nothing for half the qualities the
     * complexity control can reach.
     */
    it('finds a seventh chord in its own category', () => {
      progression.appendSlot(0);
      progression.setSlotExtent(slotId(0), 7);
      player.publish(slotId(0));

      expect(selection()).toEqual({ key: 'A', categoryId: 'seventh', itemId: 'minor7' });
    });

    it('follows the progression from chord to chord', () => {
      progression.appendSlot(0);
      progression.appendSlot(5);
      player.publish(slotId(0));
      player.publish(slotId(1));

      // VI of A minor: F major.
      expect(selection()).toEqual({ key: 'F', categoryId: 'triads', itemId: 'major' });
    });

    /**
     * The restore, and all three fields of it. The key alone is not enough:
     * leaving `selectedCategory` on `triads` would leave the fretboard drawing
     * a chord shape in a key the user never asked to see a chord in.
     */
    it('gives the whole selection back when playback stops', () => {
      progression.appendSlot(3);
      player.publish(slotId(0));
      player.publish(null);

      expect(selection()).toEqual({
        key: 'A',
        categoryId: 'diatonicModes',
        itemId: 'aeolian'
      });
    });

    it('gives it back when the page is left mid-play', () => {
      progression.appendSlot(3);
      player.publish(slotId(0));

      fixture.destroy();

      expect(selection()).toEqual({
        key: 'A',
        categoryId: 'diatonicModes',
        itemId: 'aeolian'
      });
    });

    /**
     * Turning the circle while a progression plays is a normal thing to do -
     * the drawer is app-wide and this page has no key picker of its own - and
     * the selection to give back afterwards is the one the user ended on. A
     * page that restored the selection it captured when play began would undo
     * their key change the moment the music stopped, and `adopt` would then
     * pull the progression back into the old key behind it.
     */
    it('gives back the key the user moved to during playback', () => {
      progression.appendSlot(3);
      player.publish(slotId(0));

      musicTheory.selectKeyAndMode('Eb', 'diatonicModes', 'ionian');
      player.publish(null);

      expect(selection()).toEqual({
        key: 'Eb',
        categoryId: 'diatonicModes',
        itemId: 'ionian'
      });
    });

    /**
     * The loop this page is one half of. The broadcast above comes straight
     * back through the `getState()` subscription that adopts the app's key, and
     * is refused there because a chord category names no scale - see 'ignores a
     * selection that names no scale'. This is the same guard from the other
     * end: driven by a real cue rather than by a hand-written category id, so
     * it fails if the two ever stop describing the same thing.
     */
    it('does not re-key the progression from its own broadcast', () => {
      progression.appendSlot(3);
      const before = currentState();

      player.publish(slotId(0));

      expect(key()).toEqual({ tonic: 9, scaleId: 'aeolian' });
      expect(currentState().canUndo).toBe(before.canUndo);
    });

    /**
     * **A known limitation, characterised rather than fixed.** The fretboard
     * follows the *document*, and the document can move while the transport
     * is running: `adopt` calls turning the circle mid-playback a normal thing
     * to do, and `chordFor` reads current state rather than the schedule the
     * player is running. So the chord lit here is the new key's, while the
     * chord being heard is still the old key's.
     *
     * Lighting the old key instead is not the fix and would be worse - it
     * would disagree with the strip card beside it as well as with the rail.
     * The fix is a re-schedule, and `ProgressionPlayerService.play` holds the
     * argument for leaving it to M2, where the piano roll makes mid-play
     * editing the normal case.
     */
    it('lights the key the document is in, not the key that is sounding', () => {
      progression.appendSlot(3);
      progression.appendSlot(4);
      player.publish(slotId(0));

      // The circle turned mid-playback. The schedule was built in A minor.
      musicTheory.selectKeyAndMode('C', 'diatonicModes', 'ionian');
      player.publish(slotId(1));

      // v of A minor is E minor and is what the transport is sounding; V of C
      // major is G major and is what the fretboard shows.
      expect(selection()).toEqual({ key: 'G', categoryId: 'triads', itemId: 'major' });
    });

    /**
     * Hungarian minor's second degree is a major third under a diminished
     * fifth, which is no named triad at all - `degreeQuality` calls it
     * `'other'`, and there is no chord in `MusicTheoryService` to light for it.
     *
     * The fretboard goes back to the user's own selection rather than holding
     * the previous chord. The scale is the honest thing to show: a diatonic
     * chord this app cannot name is still built from the scale's notes, so the
     * scale contains every note that is sounding, where the chord before it
     * contains notes that are not.
     */
    it('shows the key again for a chord it has no name for', () => {
      progression.setKey(0, 'hungarianMinor');
      progression.appendSlot(0);
      progression.appendSlot(1);
      player.publish(slotId(0));

      player.publish(slotId(1));

      expect(selection()).toEqual({
        key: 'A',
        categoryId: 'diatonicModes',
        itemId: 'aeolian'
      });
    });

    /**
     * The override path through `effectiveQuality`, which no spec reached from
     * this side either - so deleting that function's override branch lit the
     * key's own chord under a borrowed one and nothing failed.
     *
     * bVII in C major is a major triad on Bb where the key gives a diminished
     * one on B. The fretboard has to light the major triad the slot names, or it
     * would highlight notes that are not sounding while the card beside it reads
     * `VII`.
     */
    it('lights the chord an override names, not the one the key gives', () => {
      progression.setKey(0, 'ionian');
      progression.appendSlot(6);
      const built = progression.doc;
      progression.replaceDocument({
        ...built,
        slots: built.slots.map(slot =>
          slot.harmony.kind === 'degree'
            ? {
                ...slot,
                harmony: {
                  kind: 'degree' as const,
                  degree: { ...slot.harmony.degree, alter: -1, quality: 'major' as const }
                }
              }
            : slot
        )
      });

      player.publish(slotId(0));

      expect(selection()).toEqual({ key: 'A#', categoryId: 'triads', itemId: 'major' });
    });

    /**
     * And it lights what sounds rather than what was asked for.
     *
     * The same bVII at extent 7 keeps the key's own A above the override's
     * triad, so the chord is Bb-D-F-A. Lighting `major` there would highlight
     * three of the four notes playing and call the fourth an accident; the
     * fretboard shows the major seventh the slot actually builds.
     */
    it('lights the seventh an extended override becomes', () => {
      progression.setKey(0, 'ionian');
      progression.appendSlot(6);
      const built = progression.doc;
      progression.replaceDocument({
        ...built,
        slots: built.slots.map(slot =>
          slot.harmony.kind === 'degree'
            ? {
                ...slot,
                harmony: {
                  kind: 'degree' as const,
                  degree: {
                    ...slot.harmony.degree,
                    alter: -1,
                    extent: 7 as const,
                    quality: 'major' as const
                  }
                }
              }
            : slot
        )
      });

      player.publish(slotId(0));

      expect(selection()).toEqual({ key: 'A#', categoryId: 'seventh', itemId: 'major7' });
    });

    /**
     * And it hands over the *letter* as well as the pitch.
     *
     * `key` above has to stay one of the twelve chromatic names, because the
     * fretboard's key dropdown and `getNoteIndex` both compare against them -
     * and a `C♭` root is not one. So the numeral's own letter travels beside it,
     * and the fretboard spells the whole chord off that: the same bVII lights as
     * B♭ D F rather than as the A♯ D F its table name would have given, under a
     * card reading `VII`.
     */
    it('hands the fretboard the letter the numeral names, not just the pitch', () => {
      progression.setKey(0, 'ionian');
      progression.appendSlot(6);
      const built = progression.doc;
      progression.replaceDocument({
        ...built,
        slots: built.slots.map(slot =>
          slot.harmony.kind === 'degree'
            ? {
                ...slot,
                harmony: {
                  kind: 'degree' as const,
                  degree: { ...slot.harmony.degree, alter: -1, quality: 'major' as const }
                }
              }
            : slot
        )
      });

      player.publish(slotId(0));

      expect(musicTheory.getCurrentState().rootSpelling).toBe('Bb');
      expect(musicTheory.generateModeNotes().map(note => musicTheory.noteNameFor(note)))
        .toEqual(['Bb', 'D', 'F']);
    });

    /** And gives it back when the chord stops, so the key spells itself again. */
    it('takes the spelling away with the chord', () => {
      progression.setKey(0, 'ionian');
      progression.appendSlot(6);
      player.publish(slotId(0));

      player.publish(null);

      expect(musicTheory.getCurrentState().rootSpelling).toBeUndefined();
    });

    /**
     * A literal slot has no degree, so there is no chord to publish - the same
     * refusal the strip makes when it prints no numeral on such a card. It is
     * unreachable in M1; `replaceDocument` is the one door it can come through,
     * which is what makes this testable before M3 builds the recogniser.
     */
    it('shows the key again for a slot with no chord in it', () => {
      progression.appendSlot(3);
      const built = progression.doc;
      progression.replaceDocument({
        ...built,
        slots: [
          ...built.slots,
          {
            id: 'detached',
            harmony: { kind: 'literal', reason: 'unrecognised' },
            startBeat: 4,
            lengthBeats: 4,
            notes: [],
            owned: createOwnership()
          }
        ]
      });
      player.publish(slotId(0));

      player.publish('detached');

      expect(selection()).toEqual({
        key: 'A',
        categoryId: 'diatonicModes',
        itemId: 'aeolian'
      });
    });

    /**
     * A key that can build no chords cannot name the one it is holding either:
     * the stored quality came from the scale that was selected when the slot
     * was made. The strip refuses to print a numeral in exactly this case, and
     * the fretboard refuses to light one.
     */
    it('shows the key again when the key can name no chords', () => {
      progression.appendSlot(3);
      progression.setKey(9, 'minorPentatonic');

      player.publish(slotId(0));

      expect(selection()).toEqual({
        key: 'A',
        categoryId: 'diatonicModes',
        itemId: 'aeolian'
      });
    });

    it('stops publishing once the page is gone', () => {
      progression.appendSlot(3);
      fixture.destroy();

      player.publish(slotId(0));

      expect(selection()).toEqual({
        key: 'A',
        categoryId: 'diatonicModes',
        itemId: 'aeolian'
      });
    });
  });

  // -------------------------------------------------------------------------
  // Keeping the player fed
  // -------------------------------------------------------------------------

  /**
   * The page carries every edit to the player, which applies it at the loop
   * boundary. The direction runs this way round on purpose: the player has
   * never heard of `ProgressionService`, which is what keeps `buildSchedule`
   * pure arithmetic testable against numbers.
   *
   * It is the page rather than the transport that pushes, and the reason is in
   * the transport's own docstring - it does not stop playback when it is
   * destroyed, because a control being torn down is not a stop. A transport
   * that fed the player would stop feeding it at that moment and leave a loop
   * running on a schedule nothing could ever correct. The page cannot be in
   * that position: it stops the player as it goes.
   */
  describe('the documents it hands the player', () => {
    it('hands over every edit', () => {
      progression.appendSlot(0);

      expect(player.updated[player.updated.length - 1]).toBe(progression.doc);
    });

    it('hands over a key change made from the circle mid-playback', () => {
      progression.appendSlot(0);
      player.publish(slotId(0));

      musicTheory.selectKeyAndMode('Eb', 'diatonicModes', 'ionian');

      expect(player.updated[player.updated.length - 1]).toBe(progression.doc);
      expect(progression.doc.key.tonic).toBe(3);
    });

    it('hands over the state it opens on, before anything is edited', () => {
      // The subscription is a `BehaviorSubject`, so the player is holding the
      // current document before the first press of play rather than only after
      // the first edit.
      expect(player.updated.length).toBeGreaterThan(0);
      expect(player.updated[player.updated.length - 1]).toBe(progression.doc);
    });

    it('stops handing over once the page is gone', () => {
      fixture.destroy();
      const handed = player.updated.length;

      progression.appendSlot(0);

      expect(player.updated.length).toBe(handed);
    });
  });

  // -------------------------------------------------------------------------
  // Leaving the page
  // -------------------------------------------------------------------------

  /**
   * Leaving silences the progression. The transport declined to do this and was
   * right to - it is a control, not the owner - and this is the owner: the page
   * provides the player, and audio that outlived the only transport that can
   * stop it would be audio with no off switch.
   */
  it('stops playback when the page is destroyed', () => {
    fixture.destroy();

    expect(player.stops).toBeGreaterThan(0);
  });
});
