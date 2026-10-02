import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { ProgressionComponent } from './progression.component';
import { createExtensions } from '../../models/progression-normalize';
import { ChordDegree, ProgressionDoc, ProgressionKey } from '../../models/progression.model';
import { MusicTheoryService } from '../../services/music-theory.service';
import {
  PROGRESSION_HANDOFF_STORAGE,
  ProgressionHandoffService,
  SectionHandoff
} from '../../services/progression-handoff.service';
import { ProgressionPlayerService } from '../../services/progression-player.service';
import { ProgressionService } from '../../services/progression.service';
import { chordSlotOf } from '../../services/song-document';

/**
 * The Progression page while a song's section is open on it (Open in Progression, brief decision 7): the banner, the
 * key that holds, and the way back. Beside `progression.component.spec.ts` rather than in it, which is near the
 * thousand-line bound on its own. The page's player is a silent fake, for the reason that file gives.
 */
const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const FOUR_FOUR = { numerator: 4, denominator: 4, isCommon: true };

function degreeAt(degree: number): ChordDegree {
  return {
    degree,
    alter: 0,
    extent: 3,
    quality: null,
    inversion: 0,
    suspension: 'none',
    extensions: createExtensions(),
    octave: 0
  };
}

/** Verse 1 of "Last Dance", C then Am, as the song page would send it. */
function verse(): SectionHandoff {
  const progression: ProgressionDoc = {
    id: 'v1',
    revision: 0,
    name: 'Last Dance — Verse 1',
    key: C_MAJOR,
    tempo: 100,
    timeSignature: FOUR_FOUR,
    slots: [0, 5].map((degree, index) => ({
      ...chordSlotOf(degreeAt(degree), C_MAJOR, IONIAN, FOUR_FOUR),
      startBeat: index * 4
    }))
  };
  return {
    songId: 'song-1',
    songTitle: 'Last Dance',
    sectionId: 'v1',
    sectionLabel: 'Verse 1',
    sectionKind: 'verse',
    progression
  };
}

describe('ProgressionComponent with a song section open', () => {
  let fixture: ComponentFixture<ProgressionComponent>;
  let progression: ProgressionService;
  let musicTheory: MusicTheoryService;
  let handoff: ProgressionHandoffService;
  let navigate: jasmine.Spy;

  beforeEach(async () => {
    const player = {
      currentSlot$: new BehaviorSubject<string | null>(null),
      isLooping: false,
      update: (): void => undefined,
      stop: (): void => undefined,
      setLoop: (): void => undefined,
      play: (): Promise<void> => Promise.resolve()
    };
    await TestBed.configureTestingModule({
      imports: [ProgressionComponent],
      providers: [provideRouter([]), { provide: PROGRESSION_HANDOFF_STORAGE, useValue: null }]
    })
      .overrideComponent(ProgressionComponent, {
        set: { providers: [{ provide: ProgressionPlayerService, useValue: player }] }
      })
      .compileComponents();

    progression = TestBed.inject(ProgressionService);
    musicTheory = TestBed.inject(MusicTheoryService);
    handoff = TestBed.inject(ProgressionHandoffService);
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
  });

  afterEach(() => fixture?.destroy());

  function openPage(): void {
    fixture = TestBed.createComponent(ProgressionComponent);
    fixture.detectChanges();
  }

  const page = (): HTMLElement => fixture.nativeElement;
  const banner = (): string =>
    page().querySelector('app-progression-handoff-banner')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const backButton = (): HTMLButtonElement | null =>
    page().querySelector<HTMLButtonElement>('app-progression-handoff-banner .handoff-back');

  it("shows no banner over the user's own progression", () => {
    openPage();
    expect(banner()).toBe('');
    expect(backButton()).toBeNull();
  });

  it("names the section and the song over the section's progression, with the way back", () => {
    progression.appendSlot(0);
    handoff.open(verse());
    openPage();

    expect(banner()).toContain('Editing Verse 1 of “Last Dance”');
    expect(backButton()?.textContent?.trim()).toBe('Back to song');
  });

  it("takes the banner away when the user undoes back to their own progression, and brings it back on redo", () => {
    progression.appendSlot(0);
    handoff.open(verse());
    openPage();

    progression.undo();
    fixture.detectChanges();
    expect(banner()).toBe('');

    progression.redo();
    fixture.detectChanges();
    expect(banner()).toContain('Editing Verse 1');
  });

  it("does not re-key the section when the circle turns, and says the song's key holds", () => {
    handoff.open(verse());
    openPage();
    const revision = progression.doc.revision;

    musicTheory.selectKeyAndMode('D', 'diatonicModes', 'ionian');
    fixture.detectChanges();

    expect(progression.doc.key).toEqual(C_MAJOR);
    expect(progression.doc.revision).toBe(revision);
    expect(banner()).toContain("The song's key is C Ionian (Major); it is set on the song.");

    // Back on the song's key, there is nothing to explain.
    musicTheory.selectKeyAndMode('C', 'diatonicModes', 'ionian');
    fixture.detectChanges();
    expect(banner()).not.toContain("The song's key");
  });

  it("does not re-key the section on arrival when the circle is in another key", () => {
    musicTheory.selectKeyAndMode('A', 'diatonicModes', 'aeolian');
    handoff.open(verse());
    openPage();

    expect(progression.doc.key).toEqual(C_MAJOR);
    expect(banner()).toContain("The song's key is C Ionian (Major)");
  });

  it("takes the circle's key again once the section has gone home", async () => {
    handoff.open(verse());
    openPage();
    await handoff.cancel();

    musicTheory.selectKeyAndMode('D', 'diatonicModes', 'ionian');
    expect(progression.doc.key.tonic).toBe(2);
  });

  it("goes back to the song on Back to song, with the user's own progression back on the page", async () => {
    progression.appendSlot(4);
    const own = progression.doc;
    handoff.open(verse());
    openPage();
    navigate.calls.reset();

    backButton()?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledOnceWith(['/songs', 'song-1']);
    expect(progression.doc.slots).toEqual(own.slots);
    expect(banner()).toBe('');
  });
});
