import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, Observable } from 'rxjs';

import { ProgressionComponent } from './progression.component';
import { CircleOfFifthsComponent } from '../circle-of-fifths/circle-of-fifths.component';
import { ProgressionDoc, ProgressionState } from '../../models/progression.model';
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

  stops = 0;

  isLooping = false;

  play(doc: ProgressionDoc): Promise<void> {
    this.played.push(doc);
    return Promise.resolve();
  }

  stop(): void {
    this.stops++;
  }

  setLoop(on: boolean): void {
    this.isLooping = on;
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

  it('composes the palette, the strip and the transport', () => {
    const page: HTMLElement = fixture.nativeElement;

    expect(page.querySelector('app-chord-palette')).not.toBeNull();
    expect(page.querySelector('app-progression-strip')).not.toBeNull();
    expect(page.querySelector('app-progression-transport')).not.toBeNull();
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
     * The guard that keeps Task 11 from eating the key. That task publishes the
     * *sounding chord* through `selectKeyAndMode(root, 'chords', chordId)`, and
     * a page that adopted every selection would read `'maj7'` back as a scale
     * id, find nothing, and leave the palette with no chords to offer.
     */
    it('ignores a selection that names no scale', () => {
      musicTheory.selectKeyAndMode('A', 'diatonicModes', 'aeolian');
      musicTheory.selectKeyAndMode('D', 'chords', 'major');

      expect(key()).toEqual({ tonic: 9, scaleId: 'aeolian' });
    });

    /**
     * One direction only, which is what keeps the fretboard's own selection
     * intact across a visit to this page. Task 11 adds the other direction and
     * has to restore what it overwrites; M1 writes nothing at all.
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
