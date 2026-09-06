import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ScoreDoc, TimeSignature } from '../../../../models/composer.model';
import {
  BeatGrid,
  DerivationSettings,
  DetectedNote,
  TranscriptionSession,
  createDefaultDerivationSettings
} from '../../../../models/transcription.model';
import { AlphaTabService } from '../../../../services/alpha-tab.service';
import { deriveScore } from '../../../../services/score-derivation';
import { TranscriptionState } from '../../../../services/transcription.service';
import { FoldedNote } from '../../../../services/transcription-octave';
import { countDiscards, describeFolds, gridTempoBpm } from './review-controls';
import { TranscriptionReviewComponent } from './transcription-review.component';

/**
 * The panel is deliberately free of `TranscriptionService`, so everything below
 * drives it with a plain state object - which is what makes the round trip
 * assertable: emit, hand the *next* state back, and check the control shows it.
 */

/** Stands in for the engraver, so nothing here downloads a font or a soundfont. */
class FakeAlphaTabService {
  initialised = 0;
  disposed = 0;
  renders = 0;
  readonly rendered: alphaTab.model.Score[] = [];
  private api: object | null = null;

  initializeApi(): void {
    this.initialised += 1;
    this.api = {};
  }

  getApi(): object | null {
    return this.api;
  }

  renderScore(score: alphaTab.model.Score): void {
    this.rendered.push(score);
  }

  render(): void {
    this.renders += 1;
  }

  dispose(): void {
    this.disposed += 1;
    this.api = null;
  }
}

const note = (
  pitch: number,
  onsetSec: number,
  confidence = 1,
  id = `${pitch}@${onsetSec}`
): DetectedNote => ({
  id,
  pitch,
  onsetSec,
  offsetSec: onsetSec + 0.4,
  confidence,
  bendCents: []
});

/** Comfortably past the component's render debounce. */
const SETTLE_MS = 200;

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };

/** Eight beats at 120 BPM: two bars of 4/4. */
const GRID: BeatGrid = {
  beatsSec: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5],
  timeSignature: FOUR_FOUR
};

/** A low bass line: E1, A1, D2, G2, all comfortably fretted. */
const NOTES: DetectedNote[] = [
  note(40, 0),
  note(45, 0.5),
  note(50, 1.0),
  note(55, 1.5),
  note(43, 2.0),
  note(38, 2.5)
];

function makeSession(
  settings: Partial<DerivationSettings> = {},
  grid: BeatGrid = GRID,
  notes: DetectedNote[] = NOTES
): TranscriptionSession {
  return {
    id: 's1',
    sourceName: 'bassline.wav',
    durationSec: 4,
    notes,
    rawNotes: notes,
    bendFrameRateHz: 86.13,
    grid,
    settings: { ...createDefaultDerivationSettings(), ...settings }
  };
}

function readyState(
  session: TranscriptionSession,
  extra: Partial<TranscriptionState> = {}
): TranscriptionState {
  return {
    phase: 'ready',
    progress: 1,
    session,
    derived: deriveScore(session),
    suppressed: [],
    error: null,
    refusal: null,
    ...extra
  };
}

describe('TranscriptionReviewComponent', () => {
  let fixture: ComponentFixture<TranscriptionReviewComponent>;
  let component: TranscriptionReviewComponent;
  let alphaTabStub: FakeAlphaTabService;

  let settingsEmits: Partial<DerivationSettings>[];
  let meterEmits: TimeSignature[];
  let tempoEmits: number[];
  let nudgeEmits: number[];

  function query<T extends HTMLElement>(selector: string): T {
    return fixture.nativeElement.querySelector(selector) as T;
  }

  function control<T extends HTMLElement>(id: string): T {
    return query<T>(`#${id}`);
  }

  function text(selector: string): string {
    const element = fixture.nativeElement.querySelector(selector);
    return element ? (element.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
  }

  /** Replaces the input the way an OnPush parent does, then re-renders. */
  function push(state: TranscriptionState | null): void {
    fixture.componentRef.setInput('state', state);
    fixture.detectChanges();
  }

  /**
   * Drives a number or range input the way a user does.
   *
   * `input` only. `NumberValueAccessor` listens for that alone, and
   * `RangeValueAccessor` listens for both it and `change` - so firing the pair
   * would have the slider report every drag twice.
   */
  function type(id: string, value: string): void {
    const input = control<HTMLInputElement>(id);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /** Drives a select by picking the option showing `label`. */
  function choose(id: string, label: string): void {
    const select = control<HTMLSelectElement>(id);
    const index = Array.from(select.options).findIndex(
      option => (option.textContent ?? '').trim() === label
    );
    expect(index).toBeGreaterThanOrEqual(0);

    select.selectedIndex = index;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function shownOption(id: string): string {
    const select = control<HTMLSelectElement>(id);
    return (select.options[select.selectedIndex]?.textContent ?? '').trim();
  }

  beforeEach(async () => {
    alphaTabStub = new FakeAlphaTabService();

    await TestBed.configureTestingModule({
      imports: [TranscriptionReviewComponent]
    })
      .overrideComponent(TranscriptionReviewComponent, {
        set: { providers: [{ provide: AlphaTabService, useValue: alphaTabStub }] }
      })
      .compileComponents();
  });

  // Separate, and fake-async, because the render request is debounced. A timer
  // started in an ordinary `beforeEach` belongs to the real clock, and `tick`
  // inside the test body cannot reach it - so the preview would never draw and
  // every assertion about it would fail for the wrong reason.
  beforeEach(fakeAsync(() => {
    fixture = TestBed.createComponent(TranscriptionReviewComponent);
    component = fixture.componentInstance;

    settingsEmits = [];
    meterEmits = [];
    tempoEmits = [];
    nudgeEmits = [];
    component.settingsChanged.subscribe(v => settingsEmits.push(v));
    component.timeSignatureChanged.subscribe(v => meterEmits.push(v));
    component.tempoChanged.subscribe(v => tempoEmits.push(v));
    component.downbeatNudged.subscribe(v => nudgeEmits.push(v));

    push(readyState(makeSession()));
    tick(SETTLE_MS);
  }));

  // ---------------------------------------------------------------------------
  // (a) Every control round-trips: it emits, and it shows what comes back.
  // ---------------------------------------------------------------------------

  describe('the nine knobs, emitting', () => {
    it('sends the tuning as MIDI pitches, highest string first', () => {
      choose(component.id.tuning, 'Guitar, standard (E B G D A E)');

      // The label travels with the pitches: only this control knows which entry
      // was picked, and `deriveScore` writes it onto the staff.
      expect(settingsEmits).toEqual([
        { tuning: [64, 59, 55, 50, 45, 40], tuningLabel: 'Guitar, standard (E B G D A E)' }
      ]);
    });

    it('names no instrument for the synthetic "current tuning" entry', () => {
      push(readyState(makeSession({ tuning: [50, 45, 40] })));

      choose(component.id.tuning, 'Current (3 strings)');

      // A description of the control, not of an instrument - so derivation
      // infers a family from the pitches instead of writing this on the staff.
      expect(settingsEmits[0].tuningLabel).toBeNull();
    });

    it('does not hand out the preset array itself', () => {
      choose(component.id.tuning, 'Bass, five string (G D A E B)');
      const first = settingsEmits[0].tuning;

      choose(component.id.tuning, 'Bass, five string (G D A E B)');

      expect(settingsEmits[1].tuning).not.toBe(first);
    });

    it('sends the capo', () => {
      type(component.id.capo, '3');

      expect(settingsEmits).toEqual([{ capo: 3 }]);
    });

    it('sends the finest division as a number, not a string', () => {
      choose(component.id.division, 'Eighth note');

      expect(settingsEmits).toEqual([{ finestDivision: 8 }]);
    });

    it('sends the confidence floor', () => {
      type(component.id.confidence, '0.65');

      expect(settingsEmits).toEqual([{ confidenceFloor: 0.65 }]);
    });

    it('sends the position hint', () => {
      type(component.id.position, '5');

      expect(settingsEmits).toEqual([{ positionHint: 5 }]);
    });

    it('sends a blank position hint as null, which lets the hand roam', () => {
      type(component.id.position, '');

      expect(settingsEmits).toEqual([{ positionHint: null }]);
    });

    it('sends the max fret', () => {
      type(component.id.maxFret, '20');

      expect(settingsEmits).toEqual([{ maxFret: 20 }]);
    });

    it('sends the time signature', () => {
      choose(component.id.meter, '6/8');

      expect(meterEmits).toEqual([{ numerator: 6, denominator: 8, isCommon: false }]);
    });

    it('sends the tempo', () => {
      type(component.id.tempo, '96');

      expect(tempoEmits).toEqual([96]);
    });

    it('nudges the downbeat a beat either way', () => {
      const buttons = fixture.nativeElement.querySelectorAll('.control__button');
      (buttons[0] as HTMLButtonElement).click();
      (buttons[1] as HTMLButtonElement).click();

      expect(nudgeEmits).toEqual([-1, 1]);
    });
  });

  describe('the nine knobs, reflecting the state that comes back', () => {
    it('shows the tuning the session is actually on', fakeAsync(() => {
      choose(component.id.tuning, 'Guitar, standard (E B G D A E)');
      push(readyState(makeSession({ tuning: [64, 59, 55, 50, 45, 40] })));
      tick();
      fixture.detectChanges();

      expect(shownOption(component.id.tuning)).toBe('Guitar, standard (E B G D A E)');
    }));

    it('names a tuning that matches no preset rather than showing the wrong one', fakeAsync(() => {
      push(readyState(makeSession({ tuning: [50, 45, 40] })));
      tick(SETTLE_MS);
      fixture.detectChanges();

      expect(shownOption(component.id.tuning)).toBe('Current (3 strings)');
    }));

    it('shows the capo the state carries', fakeAsync(() => {
      push(readyState(makeSession({ capo: 4 })));
      tick();
      fixture.detectChanges();

      expect(control<HTMLInputElement>(component.id.capo).value).toBe('4');
    }));

    it('shows the confidence floor the state carries', fakeAsync(() => {
      push(readyState(makeSession({ confidenceFloor: 0.7 })));
      tick();
      fixture.detectChanges();

      expect(control<HTMLInputElement>(component.id.confidence).value).toBe('0.7');
      expect(text('.control__readout')).toBe('0.70');
    }));

    it('shows the max fret and position hint the state carries', fakeAsync(() => {
      push(readyState(makeSession({ maxFret: 17, positionHint: 7 })));
      tick();
      fixture.detectChanges();

      expect(control<HTMLInputElement>(component.id.maxFret).value).toBe('17');
      expect(control<HTMLInputElement>(component.id.position).value).toBe('7');
    }));

    it('shows the meter the grid is barred in', fakeAsync(() => {
      push(
        readyState(
          makeSession({}, { ...GRID, timeSignature: { numerator: 3, denominator: 4, isCommon: false } })
        )
      );
      tick();
      fixture.detectChanges();

      expect(shownOption(component.id.meter)).toBe('3/4');
    }));

    it('reads the tempo off the grid rather than remembering what was typed', fakeAsync(() => {
      // Eight beats 0.25 s apart is 240 BPM.
      const fast: BeatGrid = {
        beatsSec: [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75],
        timeSignature: FOUR_FOUR
      };
      type(component.id.tempo, '96');
      push(readyState(makeSession({}, fast)));
      tick();
      fixture.detectChanges();

      expect(control<HTMLInputElement>(component.id.tempo).value).toBe('240');
    }));

    // The classic OnPush two-way-binding bug: a control that emits but does not
    // reflect state sits showing a setting the score was never derived with.
    it('snaps a refused division back to the one the score was derived with', fakeAsync(() => {
      const session = makeSession({ finestDivision: 16 });
      const refused = readyState(session, {
        refusal: 'Could not apply that change: finestDivision 4 cannot express a 6/8 bar.'
      });

      choose(component.id.division, 'Quarter note');
      expect(shownOption(component.id.division)).toBe('Quarter note');

      push(refused);
      tick();
      fixture.detectChanges();

      expect(shownOption(component.id.division)).toBe('Sixteenth note');
    }));

    /*
     * The two above hand the refusal back in a *later* change-detection cycle
     * than the one the control moved in, and that is not how the panel is
     * wired. `TranscriptionService` is synchronous: the emit, the refusal and
     * the replacement state all happen inside the `change` handler, before a
     * single binding is checked. `ngModel` then compares the bound value
     * against the one it last saw, finds them equal, and writes nothing - so
     * the select goes on showing the refused option.
     *
     * These two reproduce that ordering by replacing the input from inside the
     * output subscription, the way the host does. Both failed against the
     * mirror fields alone; both were found by driving the real `/transcribe`
     * page rather than by either spec above.
     */
    it('snaps a refused meter back when the refusal arrives in the same cycle', () => {
      const refused = readyState(makeSession(), {
        refusal: 'Could not apply that change: finestDivision 4 cannot express a 6/8 bar.'
      });
      component.timeSignatureChanged.subscribe(() =>
        fixture.componentRef.setInput('state', refused)
      );

      choose(component.id.meter, '6/8');

      expect(shownOption(component.id.meter)).toBe('4/4');
    });

    it('snaps a refused division back when the refusal arrives in the same cycle', () => {
      const refused = readyState(makeSession({ finestDivision: 16 }), {
        refusal: 'Could not apply that change: finestDivision 4 cannot express a 6/8 bar.'
      });
      component.settingsChanged.subscribe(() =>
        fixture.componentRef.setInput('state', refused)
      );

      choose(component.id.division, 'Quarter note');

      expect(shownOption(component.id.division)).toBe('Sixteenth note');
    });

    // The snap-back writes through the value accessor, which is one flag away
    // from firing `ngModelChange` and posting the refused change straight back
    // out of the component - an emit the state it came from cannot answer.
    it('does not re-emit the change it just undid', () => {
      const refused = readyState(makeSession(), {
        refusal: 'Could not apply that change: finestDivision 4 cannot express a 6/8 bar.'
      });
      component.timeSignatureChanged.subscribe(() =>
        fixture.componentRef.setInput('state', refused)
      );

      choose(component.id.meter, '6/8');

      expect(meterEmits.length).toBe(1);
    });
  });

  describe('the downbeat buttons', () => {
    function buttons(): HTMLButtonElement[] {
      return Array.from(fixture.nativeElement.querySelectorAll('.control__button'));
    }

    it('are live while the grid has beats to give either way', () => {
      expect(buttons().every(button => button.disabled)).toBeFalse();
    });

    // `canNudgeDownbeat` exists so a button that would do nothing can say so:
    // at the two-beat floor `nudgedDownbeat` returns the grid by identity, and
    // pressing would push a state for a correction that did not happen.
    it('disables the forward nudge once the grid is down to two beats', () => {
      push(readyState(makeSession({}, { beatsSec: [0, 0.5], timeSignature: FOUR_FOUR })));

      expect(buttons()[1].disabled).toBeTrue();
      // Backwards always has somewhere to go: it builds the beats it needs.
      expect(buttons()[0].disabled).toBeFalse();
    });

    it('disables both when the grid states no interval at all', () => {
      push(readyState(makeSession({}, { beatsSec: [1.0], timeSignature: FOUR_FOUR })));

      expect(buttons().every(button => button.disabled)).toBeTrue();
    });
  });

  // ---------------------------------------------------------------------------
  // Refusals
  // ---------------------------------------------------------------------------

  describe('refusals', () => {
    const REFUSAL = 'Could not apply that change: finestDivision 4 cannot express a 6/8 bar.';

    it('shows the message beside the control that was just turned', () => {
      choose(component.id.division, 'Quarter note');
      push(readyState(makeSession(), { refusal: REFUSAL }));

      expect(text('.control__refusal')).toBe(REFUSAL);
    });

    it('puts it beside the meter when the meter is what moved', () => {
      choose(component.id.meter, '6/8');
      push(readyState(makeSession(), { refusal: REFUSAL }));

      const beside = query<HTMLElement>('.control__refusal').closest('.control');
      expect(beside?.querySelector('select')?.id).toBe(component.id.meter);
    });

    it('does not style it as an error, because the score is still valid', () => {
      choose(component.id.division, 'Quarter note');
      push(readyState(makeSession(), { refusal: REFUSAL }));

      expect(query<HTMLElement>('.review__failure')).toBeNull();
      expect(
        query<HTMLElement>('.control__refusal').classList.contains('review__failure')
      ).toBeFalse();
    });

    it('keeps the score on screen', fakeAsync(() => {
      push(readyState(makeSession(), { refusal: REFUSAL }));
      tick(SETTLE_MS);

      expect(component.hasScore).toBeTrue();
      expect(alphaTabStub.rendered.length).toBeGreaterThan(0);
    }));

    it('clears once a change is applied', () => {
      choose(component.id.division, 'Quarter note');
      push(readyState(makeSession(), { refusal: REFUSAL }));
      push(readyState(makeSession({ finestDivision: 8 })));

      expect(query<HTMLElement>('.control__refusal')).toBeNull();
    });

    // `withTempo` refuses out of range rather than clamping, and does it
    // silently - so the panel has to say why before it ever emits.
    it('says why a tempo outside the range is not applied, and does not emit it', () => {
      type(component.id.tempo, '9999');

      expect(tempoEmits).toEqual([]);
      expect(text('.control__refusal')).toContain('20');
      expect(text('.control__refusal')).toContain('400');
    });

    it('accepts both ends of the tempo range', () => {
      type(component.id.tempo, '20');
      type(component.id.tempo, '400');

      expect(tempoEmits).toEqual([20, 400]);
    });

    it('drops the tempo note once a state arrives and rewrites the field', () => {
      type(component.id.tempo, '9999');
      expect(text('.control__refusal')).not.toBe('');

      push(readyState(makeSession({ capo: 1 })));

      expect(query<HTMLElement>('.control__refusal')).toBeNull();
    });

    /*
     * The three fret controls, whose values `fretboardFault` can turn away.
     * Their `min`/`max` is decoration - a typed or pasted value walks past it -
     * so the service is what refuses, and the panel has to be able to say which
     * control the refusal belongs to. A message shown beside the wrong one is
     * worse than none.
     */
    describe('the fret controls', () => {
      const NECK_REFUSAL =
        'Could not apply that change: a capo at 12 leaves 0 frets of a 12-fret neck, '
        + 'and 4 is the fewest that can be played.';

      /** The id of the input the one rendered refusal is sitting under. */
      function refusalBesides(): string | undefined {
        return query<HTMLElement>('.control__refusal')
          .closest('.control')
          ?.querySelector('input')?.id;
      }

      it('puts a refused capo beside the capo field', () => {
        type(component.id.capo, '12');
        push(readyState(makeSession(), { refusal: NECK_REFUSAL }));

        expect(text('.control__refusal')).toBe(NECK_REFUSAL);
        expect(refusalBesides()).toBe(component.id.capo);
      });

      it('puts a refused max fret beside the max fret field', () => {
        type(component.id.maxFret, '2');
        push(readyState(makeSession(), { refusal: NECK_REFUSAL }));

        expect(refusalBesides()).toBe(component.id.maxFret);
      });

      it('puts a refused position hint beside the position hint field', () => {
        type(component.id.position, '1000');
        push(readyState(makeSession(), { refusal: NECK_REFUSAL }));

        expect(refusalBesides()).toBe(component.id.position);
      });

      // The same one-cycle ordering the two selects have: the service is
      // synchronous, so `ngModel` sees the bound value unchanged at both ends
      // of the round trip and writes nothing without the explicit snap-back.
      it('snaps a refused capo back when the refusal arrives in the same cycle', () => {
        const refused = readyState(makeSession(), { refusal: NECK_REFUSAL });
        component.settingsChanged.subscribe(() =>
          fixture.componentRef.setInput('state', refused)
        );

        type(component.id.capo, '12');

        expect(control<HTMLInputElement>(component.id.capo).value).toBe('0');
      });

      it('snaps a refused position hint back the same way', () => {
        const refused = readyState(makeSession(), { refusal: NECK_REFUSAL });
        component.settingsChanged.subscribe(() =>
          fixture.componentRef.setInput('state', refused)
        );

        type(component.id.position, '1000');

        // Blank, because the session's hint is null: the hand roams.
        expect(control<HTMLInputElement>(component.id.position).value).toBe('');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Discards
  // ---------------------------------------------------------------------------

  describe('discards', () => {
    it('says nothing when nothing was discarded', () => {
      expect(query<HTMLElement>('.discards')).toBeNull();
    });

    it('counts the notes the confidence floor removed', () => {
      push(readyState(makeSession({ confidenceFloor: 0.9 }, GRID, [
        note(40, 0, 1),
        note(45, 0.5, 0.2),
        note(50, 1.0, 0.1)
      ])));

      expect(text('.discards')).toContain('2 below the confidence floor');
    });

    it('counts the partials suppression removed, which live on the state', () => {
      push(readyState(makeSession(), { suppressed: [note(80, 0.2), note(85, 0.7)] }));

      expect(text('.discards')).toContain('2 harmonic partials');
    });

    // The conservation law `buildPreviewDoc` states: every candidate is either
    // drawn or counted here. Five partials struck together on a four-string
    // bass cannot all be drawn, and this count is the only record of the ones
    // that were not.
    it('reports the ghosts the preview could not draw at all', () => {
      push(
        readyState(makeSession(), {
          suppressed: [note(40, 0), note(45, 0), note(50, 0), note(55, 0), note(60, 0)]
        })
      );

      expect(component.omittedCount).toBeGreaterThan(0);
      expect(text('.discards')).toContain('could not be drawn at all');
    });

    it('totals every reason it lists', () => {
      const counted = countDiscards(
        [
          { reason: 'belowConfidence' },
          { reason: 'belowConfidence' },
          { reason: 'unplayable' },
          { reason: 'stringTaken' }
        ],
        [note(80, 0.2)]
      );

      expect(counted.map(entry => entry.count)).toEqual([2, 1, 1, 1]);
      expect(counted.map(entry => entry.reason)).toEqual([
        'belowConfidence',
        'unplayable',
        'stringTaken',
        'suppressed'
      ]);
    });

    it('leaves out the reasons that cost nothing', () => {
      expect(countDiscards([{ reason: 'unplayable' }], []).length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // (b) The preview actually re-renders, and is torn down.
  // ---------------------------------------------------------------------------

  describe('the preview', () => {
    it('engraves the state it was given', () => {
      expect(alphaTabStub.initialised).toBe(1);
      expect(alphaTabStub.rendered.length).toBe(1);
    });

    it('coalesces a run of changes into one engraving', fakeAsync(() => {
      const before = alphaTabStub.rendered.length;

      push(readyState(makeSession({ confidenceFloor: 0.1 })));
      push(readyState(makeSession({ confidenceFloor: 0.2 })));
      push(readyState(makeSession({ confidenceFloor: 0.3 })));
      tick(SETTLE_MS);

      expect(alphaTabStub.rendered.length).toBe(before + 1);
    }));

    // OnPush plus an alphaTab instance that owns its own DOM is exactly where a
    // "live" preview silently stops updating, so this asserts new content and
    // not merely a second call.
    it('re-renders with the new content when a setting changes', fakeAsync(() => {
      const quiet = [note(40, 0, 0.5), note(45, 0.5, 0.5), note(50, 1.0, 0.5)];

      push(readyState(makeSession({ confidenceFloor: 0.3 }, GRID, quiet)));
      tick(SETTLE_MS);
      const first = alphaTabStub.rendered[alphaTabStub.rendered.length - 1];

      // A floor above every confidence empties voice 1 and moves all three
      // notes into the ghost voice.
      push(readyState(makeSession({ confidenceFloor: 0.9 }, GRID, quiet)));
      tick(SETTLE_MS);
      const second = alphaTabStub.rendered[alphaTabStub.rendered.length - 1];

      expect(second).not.toBe(first);
      expect(notesIn(first, 0)).toBeGreaterThan(0);
      expect(notesIn(second, 0)).toBe(0);
      expect(notesIn(second, 1)).toBeGreaterThan(0);
    }));

    it('draws the ghost document, not the exported one', fakeAsync(() => {
      push(readyState(makeSession(), { suppressed: [note(43, 0.25), note(38, 2.75)] }));
      tick(SETTLE_MS);

      const score = alphaTabStub.rendered[alphaTabStub.rendered.length - 1];
      expect(notesIn(score, 1)).toBeGreaterThan(0);
    }));

    it('stops rendering once destroyed, and lets the engraver go', fakeAsync(() => {
      const before = alphaTabStub.rendered.length;

      push(readyState(makeSession({ capo: 2 })));
      fixture.destroy();
      tick(SETTLE_MS);

      expect(alphaTabStub.disposed).toBe(1);
      expect(alphaTabStub.rendered.length).toBe(before);
    }));
  });

  // ---------------------------------------------------------------------------
  // (c) States that are not a finished score.
  // ---------------------------------------------------------------------------

  describe('states with no score', () => {
    it('survives a null state', fakeAsync(() => {
      expect(() => {
        push(null);
        tick(SETTLE_MS);
      }).not.toThrow();

      expect(text('.review__placeholder')).toContain('Nothing to review yet');
      expect(query<HTMLElement>('.review__controls')).toBeNull();
    }));

    it('survives a session that is still being decoded', fakeAsync(() => {
      expect(() => {
        push({
          phase: 'detecting',
          progress: 0.4,
          session: null,
          derived: null,
          suppressed: [],
          error: null,
          refusal: null
        });
        tick(SETTLE_MS);
      }).not.toThrow();

      expect(query<HTMLElement>('.review__controls')).toBeNull();
    }));

    it('shows the reason a run failed, rather than an empty panel', fakeAsync(() => {
      push({
        phase: 'failed',
        progress: 0,
        session: null,
        derived: null,
        suppressed: [],
        error: 'Could not transcribe "bassline.wav": the file would not decode.',
        refusal: null
      });
      tick(SETTLE_MS);

      expect(text('.review__failure')).toContain('would not decode');
      expect(query<HTMLElement>('.review__placeholder')).toBeNull();
    }));

    it('says so rather than engraving a document with no bars', fakeAsync(() => {
      const session = makeSession();
      const derived = deriveScore(session);
      const empty: ScoreDoc = { ...derived.doc, masterBars: [], tracks: [] };
      const before = alphaTabStub.rendered.length;

      push({ ...readyState(session), derived: { ...derived, doc: empty } });
      tick(SETTLE_MS);

      expect(text('.review__no-bars')).toContain('no bars');
      expect(alphaTabStub.rendered.length).toBe(before);
    }));

    it('hides the score pane while there is nothing in it', () => {
      push(null);

      expect(query<HTMLElement>('.review__preview').hidden).toBeTrue();
    });
  });

  // ---------------------------------------------------------------------------
  // Reaching the controls without a pointer.
  // ---------------------------------------------------------------------------

  describe('labelling', () => {
    it('gives every input and select a label that names it', () => {
      const controls: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('.review__controls input, .review__controls select')
      );

      expect(controls.length).toBe(8);
      for (const element of controls) {
        const label = fixture.nativeElement.querySelector(`label[for="${element.id}"]`);
        expect(element.id)
          .withContext('every control needs an id to be labelled by')
          .toBeTruthy();
        expect(label).withContext(`no label for #${element.id}`).not.toBeNull();
        expect((label?.textContent ?? '').trim().length).toBeGreaterThan(0);
      }
    });

    it('never uses a placeholder in place of a label', () => {
      const withPlaceholder = fixture.nativeElement.querySelectorAll('[placeholder]');

      expect(withPlaceholder.length).toBe(0);
    });

    it('points every aria-describedby at something that exists', () => {
      const described: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('[aria-describedby]')
      );

      expect(described.length).toBeGreaterThan(0);
      for (const element of described) {
        for (const id of (element.getAttribute('aria-describedby') ?? '').split(/\s+/)) {
          expect(fixture.nativeElement.querySelector(`#${id}`))
            .withContext(`aria-describedby names a missing #${id}`)
            .not.toBeNull();
        }
      }
    });

    it('names the pair of downbeat buttons with a legend', () => {
      const legend = query<HTMLLegendElement>('fieldset legend');

      expect(legend).not.toBeNull();
      expect((legend.textContent ?? '').trim()).toBe('Downbeat');
    });

    it('gives every instance its own ids, so labels stay unambiguous', () => {
      const second = TestBed.createComponent(TranscriptionReviewComponent);

      expect(second.componentInstance.id.tuning).not.toBe(component.id.tuning);
    });
  });

  // The panel answers to its own width, not the window's, so it lays out
  // correctly wherever it is embedded. Asserted through the computed style
  // rather than by eye, because a container query that silently stopped
  // matching would look exactly like a narrow window.
  describe('the two-pane layout', () => {
    function paneDirection(hostWidth: string): string {
      fixture.nativeElement.style.width = hostWidth;
      fixture.detectChanges();

      const panes = query<HTMLElement>('.review__panes');
      return getComputedStyle(panes).flexDirection;
    }

    afterEach(() => {
      fixture.nativeElement.style.width = '';
    });

    it('puts the controls beside the score when the panel is wide', () => {
      expect(paneDirection('900px')).toBe('row');
    });

    it('stacks them when the panel is narrow, whatever the window is doing', () => {
      expect(paneDirection('420px')).toBe('column');
    });
  });

  // ---------------------------------------------------------------------------
  // Octave folds
  //
  // Not discards: the notes are in the score, at another octave. Before this
  // line existed the discard counts were the panel's only account of what the
  // pipeline did, and a switch from a bass tuning to a guitar one moved every
  // note below E2 up an octave with nothing on screen to say so.
  // ---------------------------------------------------------------------------

  describe('octave folds', () => {
    /** Guitar standard: the fold floor rises from MIDI 28 to 40. */
    const GUITAR = [64, 59, 55, 50, 45, 40];

    it('says nothing when every pitch was already on the neck', () => {
      expect(query<HTMLElement>('.folds')).toBeNull();
    });

    it('says how many notes moved and how far', () => {
      push(readyState(makeSession({ tuning: GUITAR }, GRID, [
        note(28, 0),
        note(33, 0.5),
        note(50, 1.0)
      ])));

      expect(text('.folds')).toBe('Folded onto the neck: 2 notes up an octave.');
    });

    it('separates folds of different depths rather than totalling them', () => {
      push(readyState(makeSession({ tuning: GUITAR }, GRID, [
        note(20, 0),
        note(28, 0.5),
        note(33, 1.0)
      ])));

      // Deepest first: a two-octave fold is a different event from a routine
      // one, and totalling would hide it.
      expect(text('.folds')).toBe(
        'Folded onto the neck: 1 note up two octaves, 2 notes up an octave.'
      );
    });

    it('clears the line once the tuning that caused it goes away', () => {
      const notes = [note(28, 0), note(33, 0.5)];
      push(readyState(makeSession({ tuning: GUITAR }, GRID, notes)));
      expect(query<HTMLElement>('.folds')).not.toBeNull();

      push(readyState(makeSession({}, GRID, notes)));

      expect(query<HTMLElement>('.folds')).toBeNull();
    });
  });

  describe('describeFolds', () => {
    const folded = (semitones: number[]): FoldedNote[] =>
      semitones.map(amount => ({
        note: note(40, 0),
        detectedPitch: 40 - amount,
        semitones: amount
      }));

    it('has nothing to say about a derivation that folded nothing', () => {
      expect(describeFolds([])).toBeNull();
    });

    it('names the direction', () => {
      expect(describeFolds(folded([12]))).toContain('up an octave');
      expect(describeFolds(folded([-12]))).toContain('down an octave');
      expect(describeFolds(folded([-24]))).toContain('down two octaves');
    });

    it('counts in words a reader can hear', () => {
      expect(describeFolds(folded([12]))).toContain('1 note ');
      expect(describeFolds(folded([12, 12]))).toContain('2 notes ');
    });

    it('says a distance in semitones rather than rounding it into a lie', () => {
      // `correctOctaves` cannot produce this; a partial octave arriving here
      // means something upstream changed, and saying "an octave" would hide it.
      expect(describeFolds(folded([7]))).toContain('up 7 semitones');
    });
  });

  describe('gridTempoBpm', () => {
    it('reads the tempo across the whole span, not off the first interval', () => {
      // Uneven, as a tracked grid always is: five beats spanning 2 s is 120 BPM.
      expect(gridTempoBpm([0, 0.42, 0.92, 1.42, 2.0])).toBe(120);
    });

    it('has nothing to say about a grid of under two beats', () => {
      expect(gridTempoBpm([1.0])).toBeNull();
      expect(gridTempoBpm([])).toBeNull();
    });

    it('has nothing to say about a grid that spans no time', () => {
      expect(gridTempoBpm([1.0, 1.0])).toBeNull();
      expect(gridTempoBpm([0, Number.POSITIVE_INFINITY])).toBeNull();
    });
  });
});

/** Struck notes in `voiceIndex` of every bar of the first staff. */
function notesIn(score: alphaTab.model.Score, voiceIndex: number): number {
  let total = 0;
  for (const bar of score.tracks[0].staves[0].bars) {
    for (const beat of bar.voices[voiceIndex]?.beats ?? []) {
      total += beat.notes.filter(n => !n.isTieDestination).length;
    }
  }
  return total;
}
