import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';

import { ScoreDoc, TimeSignature } from '../../models/composer.model';
import {
  BeatGrid,
  DerivationSettings,
  DetectedNote,
  TranscriptionSession,
  createDefaultDerivationSettings
} from '../../models/transcription.model';
import { ComposerService } from '../../services/composer.service';
import { DetectionResult, NoteDetector } from '../../services/note-detector';
import { deriveScore } from '../../services/score-derivation';
import {
  NOTE_DETECTOR,
  TranscriptionService,
  TranscriptionState
} from '../../services/transcription.service';
import { AudioDropzoneComponent } from './components/audio-dropzone/audio-dropzone.component';
import { TranscriptionReviewComponent } from './components/transcription-review/transcription-review.component';
import { TranscriptionComponent, canTerminate } from './transcription.component';

/**
 * The host is driven through a fake `TranscriptionService`, which is what makes
 * the wiring assertable in both directions: a state goes in and the right child
 * appears, a child emits and the matching service method is called with the
 * value it emitted.
 *
 * The review panel is stubbed by selector. The real one boots alphaTab, and
 * nothing here is about engraving - Task 4's spec covers that. What matters at
 * this level is that its four outputs land on four different service methods,
 * which a stub asserts more directly than a panel full of real controls.
 */

/** Stands in for the review panel: same selector, same four outputs, no engraver. */
@Component({
  selector: 'app-transcription-review',
  standalone: true,
  template: '<p class="stub-review">review</p>',
  changeDetection: ChangeDetectionStrategy.OnPush
})
class StubReviewComponent {
  @Input() state: TranscriptionState | null = null;

  @Output() readonly settingsChanged = new EventEmitter<Partial<DerivationSettings>>();
  @Output() readonly timeSignatureChanged = new EventEmitter<TimeSignature>();
  @Output() readonly tempoChanged = new EventEmitter<number>();
  @Output() readonly downbeatNudged = new EventEmitter<number>();
}

/** Records every call the host makes, and pushes whatever state a test wants. */
class FakeTranscriptionService {
  readonly stateSubject = new BehaviorSubject<TranscriptionState>(IDLE_STATE);

  busy = false;
  transcribeResult: Promise<void> = Promise.resolve();

  readonly transcribed: File[] = [];
  readonly settings: Partial<DerivationSettings>[] = [];
  readonly meters: TimeSignature[] = [];
  readonly tempos: number[] = [];
  readonly nudges: number[] = [];

  getState(): Observable<TranscriptionState> {
    return this.stateSubject.asObservable();
  }

  transcribe(file: File): Promise<void> {
    this.transcribed.push(file);
    return this.transcribeResult;
  }

  updateSettings(partial: Partial<DerivationSettings>): void {
    this.settings.push(partial);
  }

  updateTimeSignature(timeSignature: TimeSignature): void {
    this.meters.push(timeSignature);
  }

  updateTempo(bpm: number): void {
    this.tempos.push(bpm);
  }

  nudgeDownbeat(beats: number): void {
    this.nudges.push(beats);
  }
}

/** A detector that never runs anything, with a `terminate` worth counting. */
class StubDetector implements NoteDetector {
  terminations = 0;

  detect(): Promise<DetectionResult> {
    return Promise.resolve({ notes: [], bendFrameRateHz: 86.13 });
  }

  terminate(): void {
    this.terminations += 1;
  }
}

/** The other legitimate binding: a detector with nothing to terminate. */
class BareDetector implements NoteDetector {
  detect(): Promise<DetectionResult> {
    return Promise.resolve({ notes: [], bendFrameRateHz: 86.13 });
  }
}

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };

const IDLE_STATE: TranscriptionState = {
  phase: 'idle',
  progress: 0,
  session: null,
  derived: null,
  suppressed: [],
  error: null,
  refusal: null
};

const note = (pitch: number, onsetSec: number): DetectedNote => ({
  id: `${pitch}@${onsetSec}`,
  pitch,
  onsetSec,
  offsetSec: onsetSec + 0.4,
  confidence: 1,
  bendCents: []
});

/** Eight beats at 120 BPM: two bars of 4/4. */
const GRID: BeatGrid = {
  beatsSec: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5],
  timeSignature: FOUR_FOUR
};

/** Four beats of line and two more in the second bar, so the score is two bars. */
const NOTES: DetectedNote[] = [
  note(40, 0),
  note(45, 0.5),
  note(50, 1.0),
  note(55, 1.5),
  note(43, 2.0),
  note(38, 2.5)
];

function makeSession(settings: Partial<DerivationSettings> = {}): TranscriptionSession {
  return {
    id: 's1',
    sourceName: 'bassline.wav',
    durationSec: 4,
    notes: NOTES,
    rawNotes: NOTES,
    bendFrameRateHz: 86.13,
    grid: GRID,
    settings: { ...createDefaultDerivationSettings(), ...settings }
  };
}

function readyState(extra: Partial<TranscriptionState> = {}): TranscriptionState {
  const session = makeSession();

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

describe('TranscriptionComponent', () => {
  let fixture: ComponentFixture<TranscriptionComponent>;
  let component: TranscriptionComponent;
  let service: FakeTranscriptionService;
  let detector: StubDetector;
  let composer: ComposerService;
  let navigate: jasmine.Spy;

  function configure(detectorValue: NoteDetector): void {
    TestBed.configureTestingModule({
      imports: [TranscriptionComponent],
      providers: [
        { provide: TranscriptionService, useValue: service },
        { provide: NOTE_DETECTOR, useValue: detectorValue },
        { provide: Router, useValue: { navigate } }
      ]
    });

    TestBed.overrideComponent(TranscriptionComponent, {
      remove: { imports: [TranscriptionReviewComponent] },
      add: { imports: [StubReviewComponent] }
    });

    fixture = TestBed.createComponent(TranscriptionComponent);
    component = fixture.componentInstance;
    composer = TestBed.inject(ComposerService);
    fixture.detectChanges();
  }

  /** Pushes a state the way the service does, then re-renders. */
  function push(state: TranscriptionState): void {
    service.stateSubject.next(state);
    fixture.detectChanges();
  }

  function query(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector) as HTMLElement | null;
  }

  function announcement(): string {
    const region = query('[aria-live="polite"].transcription__announcer');
    return (region?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Hands a file over the way the dropzone does.
   *
   * Through the output rather than by calling the method: the host is `OnPush`,
   * and a template event binding is what marks it dirty. Calling
   * `onFileSelected` directly sets the field and renders nothing, which is a
   * property of the test rather than of the component.
   */
  function chooseFile(file: File): void {
    const dropzone = fixture.debugElement.query(By.directive(AudioDropzoneComponent))
      .componentInstance as AudioDropzoneComponent;

    dropzone.fileSelected.emit(file);
    fixture.detectChanges();
  }

  function reviewStub(): StubReviewComponent {
    return fixture.debugElement.query(By.directive(StubReviewComponent))
      .componentInstance as StubReviewComponent;
  }

  beforeEach(() => {
    service = new FakeTranscriptionService();
    detector = new StubDetector();
    navigate = jasmine.createSpy('navigate').and.resolveTo(true);
    configure(detector);
  });

  // ---------------------------------------------------------------------------
  // Which child is on screen
  // ---------------------------------------------------------------------------

  it('shows the dropzone before there is anything to review', () => {
    expect(query('app-audio-dropzone')).not.toBeNull();
    expect(query('app-transcription-review')).toBeNull();
  });

  it('swaps the dropzone for the review panel once there is a session', () => {
    push(readyState());

    expect(query('app-audio-dropzone')).toBeNull();
    expect(query('app-transcription-review')).not.toBeNull();
  });

  it('hands the state straight to the review panel', () => {
    const state = readyState();
    push(state);

    expect(reviewStub().state).toBe(state);
  });

  it('shows progress while detecting, and neither child in its place', () => {
    push({ ...IDLE_STATE, phase: 'detecting', progress: 0.42 });

    expect(query('app-audio-dropzone')).toBeNull();
    expect(query('.progress')).not.toBeNull();
    expect(component.progressPercent).toBe(42);
    expect(query('.progress__track')?.getAttribute('aria-valuenow')).toBe('42');
  });

  it('reports a failure without a live region shouting it twice', () => {
    push({ ...IDLE_STATE, phase: 'failed', error: 'Could not decode that.' });

    expect(query('.transcription__failure')?.textContent).toContain('Could not decode');
    // Back to the dropzone: a failure leaves nothing to review.
    expect(query('app-audio-dropzone')).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Starting a run
  // ---------------------------------------------------------------------------

  it('transcribes the file the dropzone hands it', () => {
    const file = new File([new Uint8Array(8)], 'bass.wav', { type: 'audio/wav' });
    chooseFile(file);

    expect(service.transcribed).toEqual([file]);
  });

  it('refuses a second file rather than provoking the concurrent rejection', () => {
    service.busy = true;
    chooseFile(new File([new Uint8Array(8)], 'other.wav', { type: 'audio/wav' }));

    expect(service.transcribed).toEqual([]);
    expect(query('.transcription__busy-note')?.textContent).toContain('other.wav');
  });

  it('shows a rejection from transcribe rather than losing it', async () => {
    service.transcribeResult = Promise.reject(new Error('Already transcribing "first.wav"'));
    chooseFile(new File([new Uint8Array(8)], 'second.wav', { type: 'audio/wav' }));

    await service.transcribeResult.catch(() => undefined);
    fixture.detectChanges();

    expect(query('.transcription__busy-note')?.textContent).toContain('Already transcribing');
  });

  // ---------------------------------------------------------------------------
  // The four knobs the panel does not own
  // ---------------------------------------------------------------------------

  it('routes each review output to its own service method', () => {
    push(readyState());
    const review = reviewStub();

    review.settingsChanged.emit({ capo: 3 });
    review.timeSignatureChanged.emit({ numerator: 3, denominator: 4, isCommon: false });
    review.tempoChanged.emit(96);
    review.downbeatNudged.emit(-1);

    expect(service.settings).toEqual([{ capo: 3 }]);
    expect(service.meters).toEqual([{ numerator: 3, denominator: 4, isCommon: false }]);
    expect(service.tempos).toEqual([96]);
    expect(service.nudges).toEqual([-1]);
  });

  // ---------------------------------------------------------------------------
  // Open in Composer
  // ---------------------------------------------------------------------------

  it('sends the derived document - not the preview - and goes to the composer', () => {
    const session = makeSession();
    const derived = deriveScore(session);
    push({
      phase: 'ready',
      progress: 1,
      session,
      derived,
      suppressed: [],
      error: null,
      refusal: null
    });

    (query('.transcription__open') as HTMLButtonElement).click();

    const opened: ScoreDoc[] = [];
    composer.getState().subscribe(composerState => opened.push(composerState.doc)).unsubscribe();

    // Identity, which is the whole assertion: `buildPreviewDoc` clones, so a
    // preview document could never be the same object as `derived.doc`.
    expect(opened[0]).toBe(derived.doc);
    expect(navigate).toHaveBeenCalledWith(['/composer']);
  });

  it('does nothing when there is no score to open', () => {
    component.openInComposer();

    expect(navigate).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // The one polite region
  // ---------------------------------------------------------------------------

  it('says nothing at all while the phases churn', () => {
    push({ ...IDLE_STATE, phase: 'decoding' });
    expect(announcement()).toBe('');

    push({ ...IDLE_STATE, phase: 'detecting', progress: 0.5 });
    expect(announcement()).toBe('');

    push({ ...IDLE_STATE, phase: 'deriving' });
    expect(announcement()).toBe('');
  });

  it('announces the completion once the run finishes', () => {
    push({ ...IDLE_STATE, phase: 'deriving' });
    push(readyState());

    expect(announcement()).toContain('Transcribed bassline.wav');
    expect(announcement()).toContain('2 bars');
  });

  it('does not re-announce the completion on every settings change', () => {
    push({ ...IDLE_STATE, phase: 'deriving' });
    push(readyState());
    expect(announcement()).not.toBe('');

    // A knob turn arrives as another `ready`, with no working phase in front.
    push(readyState());

    expect(announcement()).toBe('');
  });

  it('announces a refusal, and clears it so the same one announces again', () => {
    push({ ...IDLE_STATE, phase: 'deriving' });
    push(readyState());

    const refused = readyState({ refusal: 'Could not apply that change: too coarse.' });
    push(refused);
    expect(announcement()).toContain('too coarse');

    push(readyState());
    expect(announcement()).toBe('');

    push(refused);
    expect(announcement()).toContain('too coarse');
  });

  it('announces a failure', () => {
    push({ ...IDLE_STATE, phase: 'detecting' });
    push({ ...IDLE_STATE, phase: 'failed', error: 'Could not transcribe "bass.wav": bad file.' });

    expect(announcement()).toContain('Could not transcribe');
  });

  it('keeps its refusals separate from the dropzone, which owns its own region', () => {
    const regions = fixture.nativeElement.querySelectorAll('[aria-live]') as NodeListOf<Element>;

    // One here, one inside the dropzone. Neither repeats the other: this one is
    // empty until the service says something, and the dropzone's carries only
    // the files it turned away itself.
    expect(regions.length).toBe(2);
    expect(announcement()).toBe('');
  });

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------

  it('terminates the detector on destroy, cancelling any inference', () => {
    fixture.destroy();

    expect(detector.terminations).toBe(1);
  });

  it('stops listening to the service on destroy', () => {
    const last = component.state;
    fixture.destroy();
    service.stateSubject.next(readyState());

    // The idle state the BehaviorSubject replayed on subscribe, unchanged.
    expect(component.state).toBe(last);
    expect(component.state?.phase).toBe('idle');
  });

  it('survives a detector with nothing to terminate', () => {
    TestBed.resetTestingModule();
    service = new FakeTranscriptionService();
    navigate = jasmine.createSpy('navigate').and.resolveTo(true);
    configure(new BareDetector());

    expect(() => fixture.destroy()).not.toThrow();
  });
});

describe('canTerminate', () => {
  it('recognises a detector that can be stopped', () => {
    expect(canTerminate(new StubDetector())).toBe(true);
  });

  it('turns away one that cannot', () => {
    expect(canTerminate(new BareDetector())).toBe(false);
  });
});
