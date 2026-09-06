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
import { AlphaTabSettings } from '../../../../models/alpha-tab.model';
import { AlphaTabService } from '../../../../services/alpha-tab.service';
import {
  NoteIndex,
  RenderedNote,
  buildPreviewDoc
} from '../../../../services/preview-score';
import { DropReason, deriveScore } from '../../../../services/score-derivation';
import { ScoreDocMapperService } from '../../../../services/score-doc-mapper.service';
import {
  DEFAULT_HARMONIC_OPTIONS,
  HarmonicOptions,
  NO_NOTE_DECISIONS
} from '../../../../services/transcription-harmonics';
import { TranscriptionState } from '../../../../services/transcription.service';
import { FoldedNote } from '../../../../services/transcription-octave';
import {
  MAX_LISTED_ROWS,
  derivationRemedies,
  describeFolds,
  describeToggle,
  drawnIds,
  gridTempoBpm,
  groupDiscards,
  pitchName,
  restoredRows
} from './review-controls';
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
  /**
   * Every note-click handler registered, rather than the last one.
   *
   * The count is the assertion: a handler added per render would fire one
   * click once per render that had happened, and a single `push` of a new
   * state would hide that. See "the click handler outlives the renders".
   */
  readonly noteHandlers: ((note: RenderedNote) => void)[] = [];
  /** What the component asked the engraver for; `includeNoteBounds` matters. */
  settings: AlphaTabSettings | undefined;
  private api: object | null = null;

  initializeApi(_element: HTMLElement, settings?: AlphaTabSettings): void {
    this.initialised += 1;
    this.settings = settings;
    this.api = {};
  }

  onNoteMouseDown(handler: (note: RenderedNote) => void): void {
    this.noteHandlers.push(handler);
  }

  /** Fires every registered handler, exactly as alphaTab's event would. */
  clickNote(note: RenderedNote): void {
    for (const handler of this.noteHandlers) handler(note);
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

/**
 * The index the component builds for a state, rebuilt here to read keys off.
 *
 * `buildPreviewDoc` is pure in exactly these three arguments, so this is the
 * same map the component holds - which is what lets a spec name a rendered
 * note without reaching into a private field.
 */
function previewIndex(state: TranscriptionState): NoteIndex {
  return buildPreviewDoc(state.session!, state.derived!, state.suppressed).index;
}

/** The index key that names `id`, or fails loudly if the index has no such note. */
function keyFor(index: NoteIndex, id: string): string {
  const found = [...index].find(([, value]) => value === id);
  expect(found).withContext(`no rendered note for ${id}`).toBeDefined();

  return found![0];
}

/**
 * The `Note` alphaTab would report for an index key.
 *
 * The string number is flipped on the way in, because `detectionAt` flips it
 * back: the index speaks the tab's numbering, where 1 is the highest-pitched
 * string, and an `alphaTab.model.Note` speaks the opposite one. A spec that
 * skipped the flip would pass against a symmetrical fixture and lie about
 * every other one.
 */
function clickTarget(key: string, strings: number): RenderedNote {
  const [bar, voice, beat, string] = key.split(':').map(Number);

  return {
    string: strings - string + 1,
    beat: {
      index: beat,
      voice: {
        index: voice,
        bar: {
          index: bar,
          staff: { tuning: new Array<number>(strings).fill(0) }
        }
      }
    }
  };
}

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
    trackedGrid: grid,
    harmonics: DEFAULT_HARMONIC_OPTIONS,
    decisions: NO_NOTE_DECISIONS,
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
  let toggleEmits: string[];
  let harmonicsEmits: Partial<HarmonicOptions>[];

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
    toggleEmits = [];
    harmonicsEmits = [];
    component.settingsChanged.subscribe(v => settingsEmits.push(v));
    component.timeSignatureChanged.subscribe(v => meterEmits.push(v));
    component.tempoChanged.subscribe(v => tempoEmits.push(v));
    component.downbeatNudged.subscribe(v => nudgeEmits.push(v));
    component.noteToggled.subscribe(v => toggleEmits.push(v));
    component.harmonicsChanged.subscribe(v => harmonicsEmits.push(v));

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

    it('names every discarded note, with a control to restore it', () => {
      push(
        readyState(makeSession(), {
          suppressed: [note(43, 0.25, 1, 'p1'), note(38, 2.75, 1, 'p2')]
        })
      );

      const rows = fixture.nativeElement.querySelectorAll('.discards__row');
      expect(rows.length).toBe(2);
      expect(text('.discards')).toContain('G2 at 0.25 s');
      expect(text('.discards')).toContain('D2 at 2.75 s');
      expect(
        fixture.nativeElement.querySelectorAll('.discards__action').length
      ).toBe(2);
    });

    it('restores a note from its row, by the same route as a click', () => {
      push(
        readyState(makeSession(), { suppressed: [note(43, 0.25, 1, 'p1')] })
      );

      query<HTMLButtonElement>('.discards__action').click();

      expect(toggleEmits).toEqual(['p1']);
    });

    // Found in the browser, on the real panel: pressing "Restore" on a note
    // below the confidence floor *removed* it from the score. `toggleNote`
    // moves a note across the suppression line, and a note derivation dropped
    // never crossed it - it is still in `session.notes`, so toggling it
    // suppresses it. The label said the opposite of what the button did.
    it('offers no toggle on a discard a toggle cannot undo', () => {
      push(readyState(makeSession({ confidenceFloor: 0.9 }, GRID, [
        note(40, 0, 1, 'loud'),
        note(45, 0.5, 0.2, 'quiet')
      ])));

      expect(fixture.nativeElement.querySelectorAll('.discards__action').length).toBe(0);
      // ...and says what does address it, rather than leaving a bare row.
      expect(text('.discards')).toContain('Lower the confidence floor');
    });

    it('marks exactly the two suppression reasons as restorable', () => {
      const grouped = groupDiscards(
        [
          { note: note(40, 0, 1, 'a'), reason: 'belowConfidence' },
          { note: note(41, 0.1, 1, 'b'), reason: 'unplayable' },
          { note: note(42, 0.2, 1, 'c'), reason: 'beforeGrid' },
          { note: note(43, 0.3, 1, 'd'), reason: 'stringTaken' }
        ],
        [note(80, 0.4, 1, 'e'), note(81, 0.5, 1, 'f')],
        { keep: [], drop: ['f'] },
        new Set<string>()
      );

      const restorable = grouped
        .filter(group => group.restorable)
        .map(group => group.reason);

      expect(restorable.sort()).toEqual(['suppressed', 'youSuppressed']);
      // The four a toggle cannot help all name the knob that can.
      for (const group of grouped) {
        expect(group.restorable ? group.remedy === null : group.remedy !== null)
          .withContext(group.reason)
          .toBeTrue();
      }
    });

    it('separates what the user suppressed from what the algorithm did', () => {
      const session = makeSession();
      const dropped = note(40, 0, 1, '40@0');
      push(
        readyState(
          {
            ...session,
            notes: session.notes.filter(candidate => candidate.id !== '40@0'),
            decisions: { keep: [], drop: ['40@0'] }
          },
          { suppressed: [dropped, note(80, 0.2, 1, 'p1')] }
        )
      );

      // Two groups, because a decision the user made is a decision to take
      // back rather than one to judge.
      expect(text('.discards')).toContain('1 suppressed by you');
      expect(text('.discards')).toContain('1 harmonic partials');
      expect(text('.discards')).toContain('Undo');
    });

    it('lists what the user restored, which no discard list would mention', () => {
      const session = makeSession();
      const restored = note(43, 0.25, 1, 'r1');
      push(
        readyState({
          ...session,
          notes: [...session.notes, restored],
          rawNotes: [...session.notes, restored],
          decisions: { keep: ['r1'], drop: [] }
        })
      );

      expect(text('.restored')).toContain('Restored by you');
      expect(text('.restored')).toContain('G2 at 0.25 s');

      query<HTMLButtonElement>('.restored .discards__action').click();
      expect(toggleEmits).toEqual(['r1']);
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

    // The one failure this whole design is arranged to prevent: the staff and
    // the list are two views of one decision, so they are read off one
    // structure - the index the preview built while it was writing the
    // document - rather than computed twice from the same inputs.
    it('marks a row undrawn exactly when the score has no ghost for it', () => {
      const crowded = [
        note(40, 0, 1, 'a'),
        note(45, 0, 1, 'b'),
        note(50, 0, 1, 'c'),
        note(55, 0, 1, 'd'),
        note(60, 0, 1, 'e')
      ];
      const state = readyState(makeSession(), { suppressed: crowded });
      push(state);

      const drawn = drawnIds(previewIndex(state));
      const rows = component.discards.flatMap(group => group.rows);

      expect(rows.length).toBe(5);
      for (const row of rows) expect(row.drawn).toBe(drawn.has(row.id));

      // Five partials struck together on a four-string bass cannot all be
      // drawn, so this is not a vacuous comparison.
      expect(rows.some(row => !row.drawn)).toBeTrue();
      expect(component.omittedCount).toBe(rows.filter(row => !row.drawn).length);
    });

    it('totals every reason it lists, in reading order', () => {
      const grouped = groupDiscards(
        [
          { note: note(40, 0, 1, 'a'), reason: 'belowConfidence' },
          { note: note(41, 0.1, 1, 'b'), reason: 'belowConfidence' },
          { note: note(42, 0.2, 1, 'c'), reason: 'unplayable' },
          { note: note(43, 0.3, 1, 'd'), reason: 'stringTaken' }
        ],
        [note(80, 0.4, 1, 'e'), note(81, 0.5, 1, 'f')],
        { keep: [], drop: ['f'] },
        new Set<string>()
      );

      expect(grouped.map(group => group.reason)).toEqual([
        'youSuppressed',
        'belowConfidence',
        'unplayable',
        'stringTaken',
        'suppressed'
      ]);
      expect(grouped.map(group => group.count)).toEqual([1, 2, 1, 1, 1]);
    });

    it('leaves out the reasons that cost nothing', () => {
      const grouped = groupDiscards(
        [{ note: note(42, 0, 1, 'c'), reason: 'unplayable' }],
        [],
        { keep: [], drop: [] },
        new Set<string>()
      );

      expect(grouped.length).toBe(1);
    });

    // A long stem discards thousands of partials, and a row each would be a
    // wall of text that is also a wall of DOM.
    it('stops listing a group past the cap, and says how many it stopped at', () => {
      const many = Array.from({ length: MAX_LISTED_ROWS + 7 }, (_, i) =>
        note(80, i * 0.01, 1, `p${i}`)
      );
      // Every one of them a ghost on the staff, which is the condition the cap
      // rests on: what it stops printing is still one click away over there.
      const drawn = new Set(many.map(candidate => candidate.id));
      const grouped = groupDiscards([], many, { keep: [], drop: [] }, drawn);

      expect(grouped[0].count).toBe(MAX_LISTED_ROWS + 7);
      expect(grouped[0].rows.length).toBe(MAX_LISTED_ROWS);
      expect(grouped[0].hidden).toBe(7);
    });

    /*
     * What the cap must not do.
     *
     * The panel prints two sentences about notes it does not list: an omitted
     * one is "only reachable from here", and a capped one is "still a ghost on
     * the staff, and still one click away there". A note the preview could not
     * draw, sitting past position 40 of its group, satisfied neither - the
     * list stopped before it and there is no glyph to click. Thirteen of
     * thirty-three ghost candidates vanish that way on the pinned fixture at a
     * 0.7 floor, so the arithmetic is not hypothetical.
     */
    it('never lets the cap displace a row that is reachable from nowhere else', () => {
      const many = Array.from({ length: MAX_LISTED_ROWS + 7 }, (_, i) =>
        note(80, i * 0.01, 1, `p${i}`)
      );
      // The last five could not be drawn, and they are the ones the old
      // ordering discarded: past the cap, and not on the staff either.
      const drawn = new Set(
        many.slice(0, MAX_LISTED_ROWS + 2).map(candidate => candidate.id)
      );
      const grouped = groupDiscards([], many, { keep: [], drop: [] }, drawn);

      const listed = new Set(grouped[0].rows.map(row => row.id));
      expect(grouped[0].rows.length).toBe(MAX_LISTED_ROWS);
      expect(grouped[0].omitted).toBe(5);
      for (const missing of many.slice(MAX_LISTED_ROWS + 2)) {
        expect(listed.has(missing.id)).withContext(missing.id).toBeTrue();
      }

      // ...and everything the list did stop at is on the staff, which is the
      // other sentence.
      const notListed = many.filter(candidate => !listed.has(candidate.id));
      expect(notListed.length).toBe(grouped[0].hidden);
      expect(notListed.every(candidate => drawn.has(candidate.id))).toBeTrue();
    });

    it('lets the cap go rather than leave a whole group unreachable', () => {
      const many = Array.from({ length: MAX_LISTED_ROWS + 7 }, (_, i) =>
        note(80, i * 0.01, 1, `p${i}`)
      );
      // Nothing drawn at all. Every row is then the only record of its note,
      // so there is nothing the cap could hide that is reachable elsewhere.
      const grouped = groupDiscards([], many, { keep: [], drop: [] }, new Set<string>());

      expect(grouped[0].rows.length).toBe(MAX_LISTED_ROWS + 7);
      expect(grouped[0].hidden).toBe(0);
    });

    it('skips a restore decision naming no detection rather than printing a blank', () => {
      const session = makeSession();

      expect(
        restoredRows(
          { ...session, decisions: { keep: ['ghost-of-a-ghost'], drop: [] } },
          new Set<string>()
        )
      ).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // (e) The suppression thresholds.
  // ---------------------------------------------------------------------------

  describe('the suppression thresholds', () => {
    // fakeAsync because `NgModel` writes to the view in a microtask rather than
    // in the change-detection pass that read the new value - so a synchronous
    // spec reads the box before Angular has filled it, and would fail on a
    // control that is perfectly correct in a browser.
    it('shows the thresholds the session ran with', fakeAsync(() => {
      push(
        readyState({
          ...makeSession(),
          harmonics: {
            toleranceSec: 0.05,
            unisonConfidenceRatio: 0.7,
            unisonDurationRatio: 0.4,
            partialConfidenceRatio: 0.8
          }
        })
      );
      tick(SETTLE_MS);

      expect(control<HTMLInputElement>(component.id.partialRatio).value).toBe('0.8');
      expect(control<HTMLInputElement>(component.id.tolerance).value).toBe('0.05');
      expect(control<HTMLInputElement>(component.id.unisonConfidence).value).toBe('0.7');
      expect(control<HTMLInputElement>(component.id.unisonDuration).value).toBe('0.4');
    }));

    it('sends the measured ratio on its own', () => {
      type(component.id.partialRatio, '0.4');

      expect(harmonicsEmits).toEqual([{ partialConfidenceRatio: 0.4 }]);
    });

    it('sends each unmeasured threshold on its own', () => {
      type(component.id.tolerance, '0.05');
      type(component.id.unisonConfidence, '0.9');
      type(component.id.unisonDuration, '0.6');

      expect(harmonicsEmits).toEqual([
        { toleranceSec: 0.05 },
        { unisonConfidenceRatio: 0.9 },
        { unisonDurationRatio: 0.6 }
      ]);
    });

    // The failure Task 1 flagged: a NaN loses every comparison it is in, so a
    // blank box would suppress nothing at all, with no error anywhere.
    it('refuses a threshold that is not a number, beside its own control', () => {
      type(component.id.tolerance, '');

      expect(harmonicsEmits).toEqual([]);
      expect(text('.advanced .control__refusal')).toContain('Needs a number');
    });

    /*
     * The half the spec below cannot see, because it never pushes a state
     * between the refusal and the check.
     *
     * `ngOnChanges` rewrites `harmonics` from the arriving session and clears
     * the messages. If the mirror had gone on holding the last good number
     * through the refusal, the bound expression would read 0.03 at both ends
     * of that - so `NgModel` would find nothing changed, never call
     * `writeValue`, and leave an empty box with no message beside it and a
     * score derived at a threshold nothing on screen states. Which is the
     * failure `snapRefusedControlsBack` exists to prevent, reached by another
     * route.
     */
    it('refills a refused box from the next state that arrives', fakeAsync(() => {
      type(component.id.tolerance, '');
      tick(SETTLE_MS);
      expect(control<HTMLInputElement>(component.id.tolerance).value).toBe('');
      expect(text('.advanced .control__refusal')).toContain('Needs a number');

      // Any other control moving. The session that comes back carries the
      // threshold still in force, which the box has to be shown again.
      push(readyState(makeSession({ capo: 2 })));
      tick(SETTLE_MS);

      expect(control<HTMLInputElement>(component.id.tolerance).value).toBe(
        `${DEFAULT_HARMONIC_OPTIONS.toleranceSec}`
      );
      expect(text('.advanced .control__refusal')).toBe('');
    }));

    it('goes on refusing until the box holds a number again', () => {
      type(component.id.unisonConfidence, '');
      expect(harmonicsEmits).toEqual([]);

      type(component.id.unisonConfidence, '0.9');

      expect(harmonicsEmits).toEqual([{ unisonConfidenceRatio: 0.9 }]);
      expect(text('.advanced .control__refusal')).toBe('');
    });

    it('says the ratio is the measured one and the other three are not', () => {
      expect(text(`#${component.id.partialRatioHint}`)).toContain('120 candidate pairs');
      expect(text(`#${component.id.partialRatioHint}`)).toContain('Lower keeps more');
      expect(text('.advanced__note')).toContain('Unmeasured');
    });

    it('attaches the hint to the control that it explains', () => {
      expect(
        control<HTMLInputElement>(component.id.partialRatio).getAttribute(
          'aria-describedby'
        )
      ).toBe(component.id.partialRatioHint);
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

      // Nine knobs less the two downbeat buttons, plus the four suppression
      // thresholds. A control added without a label fails the loop below; this
      // number is what catches one added without being counted at all.
      expect(controls.length).toBe(12);
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

  // ---------------------------------------------------------------------------
  // (d) Clicking a note overrules the pipeline on it.
  // ---------------------------------------------------------------------------

  describe('overruling one note', () => {
    /** In `rawNotes` and suppressed: the ghost a click is meant to restore. */
    const GHOST = note(43, 0.25, 1, 'ghost-1');

    /** A session whose raw detection carries `GHOST` as well as the kept notes. */
    function withGhost(): TranscriptionSession {
      const session = makeSession();

      return { ...session, rawNotes: [...session.notes, GHOST] };
    }

    it('asks the engraver for note bounds, without which no click is reported', () => {
      // alphaTab hit-tests the beat and only asks for the note inside it when
      // note bounds were recorded, so `noteMouseDown` never fires without this
      // - and it fails silently, with a handler that is simply never called.
      expect(alphaTabStub.settings?.core?.includeNoteBounds).toBeTrue();
    });

    it('resolves a click on a ghost to the detection behind it', fakeAsync(() => {
      const state = readyState(withGhost(), { suppressed: [GHOST] });
      push(state);
      tick(SETTLE_MS);

      alphaTabStub.clickNote(clickTarget(keyFor(previewIndex(state), 'ghost-1'), 4));

      expect(toggleEmits).toEqual(['ghost-1']);
    }));

    it('resolves a click on a note in the score to its detection', fakeAsync(() => {
      const state = readyState(withGhost(), { suppressed: [GHOST] });
      push(state);
      tick(SETTLE_MS);

      // Voice 1's half of the index, which is what makes suppressing a kept
      // note possible at all rather than only restoring a ghost.
      alphaTabStub.clickNote(clickTarget(keyFor(previewIndex(state), '40@0'), 4));

      expect(toggleEmits).toEqual(['40@0']);
    }));

    it('says nothing about a note with no detection behind it', fakeAsync(() => {
      push(readyState(withGhost(), { suppressed: [GHOST] }));
      tick(SETTLE_MS);

      // alphaTab's "not on a string", which is what a pitched note on the
      // notation staff reports. No key can be computed for it, so no answer.
      alphaTabStub.clickNote({
        string: -1,
        beat: {
          index: 0,
          voice: { index: 0, bar: { index: 0, staff: { tuning: [43, 38, 33, 28] } } }
        }
      });

      // A bar the index does not describe, which is where a click against a
      // stale render lands.
      alphaTabStub.clickNote({
        string: 1,
        beat: {
          index: 0,
          voice: { index: 0, bar: { index: 99, staff: { tuning: [43, 38, 33, 28] } } }
        }
      });

      // A staff with no tuning at all: the flip has nothing to work from.
      alphaTabStub.clickNote({
        string: 1,
        beat: { index: 0, voice: { index: 0, bar: { index: 0, staff: { tuning: [] } } } }
      });

      expect(toggleEmits).toEqual([]);
    }));

    it('has nothing to resolve against when the preview would not build', fakeAsync(() => {
      const state = readyState(withGhost(), { suppressed: [GHOST] });
      push(state);
      tick(SETTLE_MS);
      const key = keyFor(previewIndex(state), 'ghost-1');

      // A document with no bars is the one state that leaves the previous
      // score on screen with nothing behind it. An index carried over from the
      // last derivation would answer a click on those old pixels confidently
      // and wrongly.
      const derived = deriveScore(withGhost());
      push({
        ...state,
        derived: { ...derived, doc: { ...derived.doc, masterBars: [], tracks: [] } }
      });
      tick(SETTLE_MS);

      alphaTabStub.clickNote(clickTarget(key, 4));

      expect(toggleEmits).toEqual([]);
    }));

    // The failure a unit test of the handler alone cannot see: the preview
    // re-renders on every knob turn, and a handler registered per render fires
    // one click as many times as the score had been drawn.
    it('registers the click handler once, whatever the preview does', fakeAsync(() => {
      const state = readyState(withGhost(), { suppressed: [GHOST] });
      push(state);
      tick(SETTLE_MS);
      push(readyState(withGhost(), { suppressed: [GHOST] }));
      tick(SETTLE_MS);
      push(state);
      tick(SETTLE_MS);

      expect(alphaTabStub.noteHandlers.length).toBe(1);
      expect(alphaTabStub.rendered.length).toBeGreaterThan(1);

      alphaTabStub.clickNote(clickTarget(keyFor(previewIndex(state), 'ghost-1'), 4));

      expect(toggleEmits).toEqual(['ghost-1']);
    }));

    /*
     * The index answers for the pixels, not for the newest state.
     *
     * `ngOnChanges` builds an index for every derivation that arrives, and two
     * paths through `renderPreview` then draw nothing: a container with no
     * width, which alphaTab refuses and never retries, and a `toScore` that
     * throws, which leaves the previous score drawn and clickable under an
     * error. In both the previous score is what the reader is looking at, so
     * the previous index is the one that names what they click. The promotion
     * happens after the draw for exactly this.
     */
    describe('the index and the pixels', () => {
      it('answers for the score still drawn when a render throws', fakeAsync(() => {
        const state = readyState(withGhost(), { suppressed: [GHOST] });
        push(state);
        tick(SETTLE_MS);
        const key = keyFor(previewIndex(state), 'ghost-1');

        spyOn(TestBed.inject(ScoreDocMapperService), 'toScore').and.throwError(
          'no staff to write on'
        );
        // A derivation with no ghost at all, so its index has nothing at this
        // key: reading through it would answer the visible notehead with null.
        push(readyState(makeSession()));
        tick(SETTLE_MS);
        expect(text('.review__render-error')).toContain('Could not draw');

        alphaTabStub.clickNote(clickTarget(key, 4));

        expect(toggleEmits).toEqual(['ghost-1']);
      }));

      it('answers for it too while the container has no width to draw into', fakeAsync(() => {
        const state = readyState(withGhost(), { suppressed: [GHOST] });
        push(state);
        tick(SETTLE_MS);
        const key = keyFor(previewIndex(state), 'ghost-1');

        query<HTMLElement>('.review__score').style.display = 'none';
        push(readyState(makeSession()));
        tick(SETTLE_MS);

        alphaTabStub.clickNote(clickTarget(key, 4));

        expect(toggleEmits).toEqual(['ghost-1']);
      }));

      // The other side of it: once the new score is actually on the page, the
      // old keys stop meaning anything. Without this the promotion could be
      // omitted entirely and the two above would still pass.
      it('stops answering for it once the new score is drawn', fakeAsync(() => {
        const state = readyState(withGhost(), { suppressed: [GHOST] });
        push(state);
        tick(SETTLE_MS);
        const key = keyFor(previewIndex(state), 'ghost-1');

        push(readyState(makeSession()));
        tick(SETTLE_MS);

        alphaTabStub.clickNote(clickTarget(key, 4));

        expect(toggleEmits).toEqual([]);
      }));
    });

    it('reads what the click did off the state that came back', fakeAsync(() => {
      const state = readyState(withGhost(), { suppressed: [GHOST] });
      push(state);
      tick(SETTLE_MS);
      alphaTabStub.clickNote(clickTarget(keyFor(previewIndex(state), 'ghost-1'), 4));

      // What the host's `toggleNote` produces: the ghost is in the kept set now.
      const session = makeSession();
      push(
        readyState({
          ...session,
          notes: [...session.notes, GHOST],
          rawNotes: [...session.notes, GHOST]
        })
      );
      tick(SETTLE_MS);

      expect(text('.review__toggle')).toContain('Restored G2 at 0.25 s');
    }));

    it('says the other direction when the click suppressed a note', fakeAsync(() => {
      const state = readyState(withGhost(), { suppressed: [GHOST] });
      push(state);
      tick(SETTLE_MS);
      alphaTabStub.clickNote(clickTarget(keyFor(previewIndex(state), '40@0'), 4));

      const session = makeSession();
      const kept = session.notes.filter(candidate => candidate.id !== '40@0');
      push(
        readyState({ ...session, notes: kept }, { suppressed: [note(40, 0, 1, '40@0')] })
      );
      tick(SETTLE_MS);

      expect(text('.review__toggle')).toContain('Suppressed E2 at 0.00 s');
    }));

    it('drops the sentence on the next change that is not a click', fakeAsync(() => {
      const state = readyState(withGhost(), { suppressed: [GHOST] });
      push(state);
      tick(SETTLE_MS);
      alphaTabStub.clickNote(clickTarget(keyFor(previewIndex(state), 'ghost-1'), 4));

      const session = makeSession();
      push(
        readyState({
          ...session,
          notes: [...session.notes, GHOST],
          rawNotes: [...session.notes, GHOST]
        })
      );
      tick(SETTLE_MS);
      expect(text('.review__toggle')).not.toBe('');

      // A knob turn. The sentence described one derivation and this is a
      // different one, so it goes rather than standing over a score it no
      // longer describes.
      type(component.id.capo, '2');
      push(readyState(makeSession({ capo: 2 })));
      tick(SETTLE_MS);

      expect(text('.review__toggle')).toBe('');
    }));

    it('states the gesture, so a grey notehead is not the only clue', () => {
      expect(text('.review__click-hint')).toContain('Click a note');
      expect(text('.review__click-hint')).toContain('ghost');
      // ...and does not promise the gesture on the ghosts it does not work on.
      expect(text('.review__click-hint')).toContain('not suppression');
    });

    /*
     * The staff's half of `DiscardGroup.restorable`.
     *
     * Two kinds of ghost are drawn and a notehead does not distinguish them.
     * A `belowConfidence` note is still in `session.notes`, so `toggleNote`
     * reads it as kept and *suppresses* it: nothing visible happens, the kept
     * set moves enough to re-track the beat grid, and the note gains a `drop`
     * override that outranks the very floor the panel is telling the user to
     * lower. The list refuses that gesture by withholding a button; the staff
     * has no button to withhold, so it has to refuse the click itself.
     */
    describe('a ghost suppression did not remove', () => {
      /** Loud enough to keep, quiet enough to ghost, and a suppressed partial. */
      function mixed(): TranscriptionState {
        const session = makeSession({ confidenceFloor: 0.9 }, GRID, [
          note(40, 0, 1, 'loud'),
          note(45, 0.5, 0.2, 'quiet')
        ]);

        return readyState(
          { ...session, rawNotes: [...session.notes, GHOST] },
          { suppressed: [GHOST] }
        );
      }

      it('is not toggled, and says which control moves it instead', fakeAsync(() => {
        const state = mixed();
        push(state);
        tick(SETTLE_MS);

        alphaTabStub.clickNote(clickTarget(keyFor(previewIndex(state), 'quiet'), 4));
        fixture.detectChanges();

        // No emit at all, so the host never reaches `toggleNote` and no
        // decision is recorded against the note.
        expect(toggleEmits).toEqual([]);
        expect(text('.review__toggle')).toContain('Lower the confidence floor');
      }));

      // The other half: the refusal is about provenance, not about ghosts.
      it('leaves a ghost suppression did remove toggling as before', fakeAsync(() => {
        const state = mixed();
        push(state);
        tick(SETTLE_MS);

        alphaTabStub.clickNote(clickTarget(keyFor(previewIndex(state), 'ghost-1'), 4));
        fixture.detectChanges();

        expect(toggleEmits).toEqual(['ghost-1']);
        expect(text('.review__toggle')).not.toContain('Lower the confidence floor');
      }));

      it('goes on refusing after the state has moved on', fakeAsync(() => {
        push(mixed());
        tick(SETTLE_MS);

        const next = mixed();
        push(next);
        tick(SETTLE_MS);

        alphaTabStub.clickNote(clickTarget(keyFor(previewIndex(next), 'quiet'), 4));

        expect(toggleEmits).toEqual([]);
      }));
    });
  });

  describe('derivationRemedies', () => {
    const dropped = (reason: DropReason, id: string) => ({
      note: note(40, 0, 1, id),
      reason
    });

    it('names the knob for every reason derivation drops a note for', () => {
      const remedies = derivationRemedies([
        dropped('belowConfidence', 'a'),
        dropped('unplayable', 'b'),
        dropped('beforeGrid', 'c'),
        dropped('stringTaken', 'd')
      ]);

      expect([...remedies.keys()].sort()).toEqual(['a', 'b', 'c', 'd']);
      expect(remedies.get('a')).toContain('confidence floor');
      // The same table the list prints under the group, so the two agree.
      expect(remedies.get('c')).toContain('Nudge the downbeat');
    });

    // A click lands on any ghost the staff drew, and the staff does not stop
    // at `MAX_LISTED_ROWS`. A map built from the printed rows would let every
    // click past the cap through to the toggle it must not make.
    it('covers a group past the row cap the list stops at', () => {
      const many = Array.from({ length: MAX_LISTED_ROWS + 5 }, (_, index) =>
        dropped('belowConfidence', `d${index}`)
      );

      expect(derivationRemedies(many).size).toBe(MAX_LISTED_ROWS + 5);
    });

    it('has nothing to decline for a derivation that dropped nothing', () => {
      expect(derivationRemedies([]).size).toBe(0);
    });
  });

  describe('describeToggle', () => {
    it('has nothing to say about an id the session does not carry', () => {
      expect(describeToggle(makeSession(), 'not-a-note')).toBeNull();
    });
  });

  describe('pitchName', () => {
    it('names a MIDI pitch in scientific notation', () => {
      expect(pitchName(28)).toBe('E1');
      expect(pitchName(60)).toBe('C4');
      expect(pitchName(58)).toBe('A#3');
    });

    it('names a pitch below MIDI 0 rather than indexing off the table', () => {
      // `isCorrectablePitch` spans ten octaves either side, so this reaches the
      // list; a signed `%` would have read past the front of the table.
      expect(pitchName(-2)).toBe('A#-2');
    });

    it('says so when a pitch is not a number it can name', () => {
      expect(pitchName(Number.NaN)).toBe('?');
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
