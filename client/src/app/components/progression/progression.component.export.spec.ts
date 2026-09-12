import { ComponentFixture, TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';
import { BehaviorSubject, Observable } from 'rxjs';

import { ProgressionComponent } from './progression.component';
import { DEFAULT_VELOCITY } from '../../models/progression-normalize';
import {
  ProgressionDoc,
  createDefaultProgression,
  createDegreeSlot
} from '../../models/progression.model';
import { ComposerExportService } from '../../services/composer-export.service';
import { ProgressionPlayerService } from '../../services/progression-player.service';
import { MAX_PREVIEW_BARS } from '../../services/progression-score';
import { ProgressionService } from '../../services/progression.service';

/**
 * The rail's Export block: what the two buttons write, and what they refuse.
 *
 * Separate from `progression.component.spec.ts` because that file is about the
 * page as a composition - the key it takes from the circle, the chord it sends
 * to the fretboard, the documents it feeds the player - and this one is about a
 * file leaving the app. They fail for different reasons, and together they were
 * over the thousand-line bound.
 *
 * ## The player is faked, for the reason the sibling file gives
 *
 * `ProgressionComponent` provides `PROGRESSION_AUDIO` and the player itself, so
 * an unaltered fixture would build a real synth on the headless browser's audio
 * context. `overrideComponent` replaces that provider list with one fake. This
 * fake is thinner than the sibling's: nothing here drives a cue, so it only has
 * to satisfy the three members the page actually calls.
 *
 * ## The exporter is spied rather than faked
 *
 * Both halves matter. `downloadMidiFile` and `downloadGuitarPro` end in a
 * synthesised anchor click, which in a browser is a real download; and what the
 * assertions are about is the `Score` handed over, which a spy captures without
 * anything having to stand in for alphaTab. Everything under the spy - the
 * projection, the mapper - is the real thing.
 */
class FakePlayer {
  private readonly currentSlotSubject = new BehaviorSubject<string | null>(null);

  readonly currentSlot$: Observable<string | null> = this.currentSlotSubject.asObservable();

  stops = 0;

  update(_doc: ProgressionDoc): void {
    // The page hands over every edit; nothing here reads them back.
  }

  stop(): void {
    this.stops++;
    this.currentSlotSubject.next(null);
  }
}

/**
 * B flat major holding its `♭II`, whose root is a C flat.
 *
 * The one letter the twelve chromatic names cannot give, and so the case that
 * separates a projection handed the key's scale from one handed nothing:
 * without the scale that pitch class comes back a plain B. The notation panel's
 * spec builds the same document, for the same claim about the other caller.
 */
function flatTwoInBFlat(): ProgressionDoc {
  const slot = createDegreeSlot(1, 0);
  if (slot.harmony.kind !== 'degree') throw new Error('unreachable');

  return {
    ...createDefaultProgression(),
    key: { tonic: 10, scaleId: 'ionian', preferSharps: false },
    slots: [
      {
        ...slot,
        lengthBeats: 4,
        notes: [{ midi: 71, startBeat: 0, lengthBeats: 4, velocity: DEFAULT_VELOCITY }],
        harmony: {
          kind: 'degree',
          degree: { ...slot.harmony.degree, alter: -1, quality: 'major' }
        }
      }
    ]
  };
}

describe('ProgressionComponent exports', () => {
  let fixture: ComponentFixture<ProgressionComponent>;
  let component: ProgressionComponent;
  let progression: ProgressionService;
  let exporter: ComposerExportService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProgressionComponent]
    })
      .overrideComponent(ProgressionComponent, {
        set: { providers: [{ provide: ProgressionPlayerService, useValue: new FakePlayer() }] }
      })
      .compileComponents();

    progression = TestBed.inject(ProgressionService);
    exporter = TestBed.inject(ComposerExportService);
    spyOn(exporter, 'downloadMidiFile');
    spyOn(exporter, 'downloadGuitarPro');

    fixture = TestBed.createComponent(ProgressionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  /** The score the last MIDI export handed over. */
  function exportedMidi(): alphaTab.model.Score {
    const spy = exporter.downloadMidiFile as jasmine.Spy;
    return spy.calls.mostRecent().args[0] as alphaTab.model.Score;
  }

  /** The score the last Guitar Pro export handed over. */
  function exportedGuitarPro(): alphaTab.model.Score {
    const spy = exporter.downloadGuitarPro as jasmine.Spy;
    return spy.calls.mostRecent().args[0] as alphaTab.model.Score;
  }

  /** A rail button by its label, which is what a user has to find it by. */
  function button(label: string): HTMLButtonElement {
    const page: HTMLElement = fixture.nativeElement;
    const found = Array.from(page.querySelectorAll<HTMLButtonElement>('.rail button')).find(
      candidate => (candidate.textContent ?? '').includes(label)
    );
    if (!found) throw new Error(`the rail has no "${label}" button`);
    return found;
  }

  /** The refusal as a screen reader would reach it, or null when there is none. */
  function announcement(): HTMLElement | null {
    const page: HTMLElement = fixture.nativeElement;
    return page.querySelector<HTMLElement>('.rail [role="alert"]');
  }

  /** The id of the first slot, which is what a length edit names. */
  function firstSlotId(): string {
    const slot = progression.doc.slots[0];
    if (!slot) throw new Error('the progression has no slots');
    return slot.id;
  }

  /**
   * A progression reaching past `MAX_PREVIEW_BARS`.
   *
   * Through `setSlotLength`, which is the only door to it: 512 bars is around
   * twenty minutes of 4/4 at 100 BPM, so nothing a user assembles a chord at a
   * time arrives here. That is the case the bound exists for, and so the case
   * the refusal has to cover.
   */
  function overlong(): void {
    progression.appendSlot(0);
    progression.setSlotLength(firstSlotId(), 4 * (MAX_PREVIEW_BARS + 10));
  }

  it('exports the whole progression as MIDI', () => {
    progression.appendSlot(0);
    progression.appendSlot(4);

    component.exportMidi();

    expect(exporter.downloadMidiFile).toHaveBeenCalled();
    expect(exportedMidi().masterBars.length).toBe(2);
    expect(component.exportError).toBeNull();
  });

  it('exports the whole progression as a Guitar Pro file', () => {
    progression.appendSlot(0);
    progression.appendSlot(4);

    component.exportGuitarPro();

    expect(exportedGuitarPro().masterBars.length).toBe(2);
  });

  it('offers both exports from the rail', () => {
    button('Export MIDI').click();
    expect(exporter.downloadMidiFile).toHaveBeenCalled();

    button('Export .gp').click();
    expect(exporter.downloadGuitarPro).toHaveBeenCalled();
  });

  /**
   * The projection is handed the key's scale, which is what decides the letter
   * a `♭II` is spelled on. The notation panel's spec pins the same wiring for
   * the preview; this pins it for the file, and they are separate assertions
   * because dropping the argument in one caller leaves the other green.
   *
   * Asserted on alphaTab's own note rather than on the `ScoreDoc`, because the
   * spy captures what was actually handed over: a `letter` reaches alphaTab as
   * a forcing mode, and a C flat is `ForceFlat`. Without the scale the pitch
   * class comes back a plain B, whose mode is `Default` - "spell it from the
   * key signature", under a numeral that says lowered second.
   */
  it('spells the file from the key scale, so a flat two exports flat', () => {
    progression.replaceDocument(flatTwoInBFlat());

    component.exportMidi();

    const engraved = exportedMidi().tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
    expect(engraved.accidentalMode).toBe(alphaTab.model.NoteAccidentalMode.ForceFlat);
  });

  /**
   * A file outlives the message beside it, so an export that silently dropped
   * bars would be a file that lies. The preview may draw 512 and say so.
   */
  it('refuses to export a truncated projection', () => {
    overlong();

    component.exportGuitarPro();

    expect(exporter.downloadGuitarPro).not.toHaveBeenCalled();
    expect(component.exportError).toContain('512');
  });

  it('refuses the MIDI export on the same ground', () => {
    overlong();

    component.exportMidi();

    expect(exporter.downloadMidiFile).not.toHaveBeenCalled();
    expect(component.exportError).toContain('512');
  });

  /** The message names the length as well as the cap, so it says how far over. */
  it('names the bar count it refused', () => {
    overlong();

    component.exportMidi();

    expect(component.exportError).toContain(String(MAX_PREVIEW_BARS + 10));
  });

  /**
   * Reachable by a screen reader, not merely visible: a refusal a user cannot
   * perceive is a button that did nothing. Same pattern as the notation panel's
   * error one block down the page.
   */
  it('announces the refusal rather than only showing it', () => {
    overlong();
    fixture.detectChanges();
    expect(announcement()).toBeNull();

    component.exportMidi();
    fixture.detectChanges();

    expect(announcement()?.textContent).toContain('512');
  });

  it('clears the refusal once something exports', () => {
    overlong();
    component.exportMidi();

    progression.setSlotLength(firstSlotId(), 4);
    component.exportMidi();
    fixture.detectChanges();

    expect(exporter.downloadMidiFile).toHaveBeenCalled();
    expect(component.exportError).toBeNull();
    expect(announcement()).toBeNull();
  });
});
