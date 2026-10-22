import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChordPaletteComponent } from './chord-palette.component';
import { ProgressionService } from '../../../../services/progression.service';

/**
 * The next-chord hints, through the real service: the toggle, the marks, and
 * the caption following the selection. Which chords are hinted is
 * `progression-next-chords.spec.ts`'s question and where they land is
 * `chord-palette-hints-view.spec.ts`'s; this checks the wiring.
 */
describe('ChordPaletteComponent next-chord hints', () => {
  let fixture: ComponentFixture<ChordPaletteComponent>;
  let component: ChordPaletteComponent;
  let progression: ProgressionService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ChordPaletteComponent] }).compileComponents();
    fixture = TestBed.createComponent(ChordPaletteComponent);
    component = fixture.componentInstance;
    progression = TestBed.inject(ProgressionService);
    fixture.detectChanges();
  });

  function hinted(): string[] {
    return [...component.chords, ...component.borrowed]
      .filter(button => button.hinted)
      .map(button => button.numeral);
  }

  it('starts on, and marks what follows the chord just added', () => {
    progression.setKey(0, 'ionian');
    progression.appendSlot(4);
    fixture.detectChanges();

    expect(component.suggestNext).toBeTrue();
    expect(hinted()).toEqual(['I', 'vi']);
    expect(component.hintCaption).toBe('After V (G Maj): I — dominant to tonic · vi — deceptive');
  });

  it('follows the selection to a chord in the middle', () => {
    progression.setKey(0, 'ionian');
    progression.appendSlot(1);
    progression.appendSlot(4);
    progression.selectSlot(progression.doc.slots[0].id);
    fixture.detectChanges();

    expect(hinted()).toEqual(['V', 'vii°']);
  });

  it('marks the borrowed V after iv in a minor key', () => {
    progression.setKey(9, 'aeolian');
    progression.appendSlot(3);
    fixture.detectChanges();

    expect(hinted()).toContain('V');
    expect(component.chords.find(chord => chord.numeral === 'v')?.hinted).toBeFalse();
  });

  it('clears everything when the toggle is turned off', () => {
    progression.setKey(0, 'ionian');
    progression.appendSlot(4);
    component.toggleSuggestNext();
    fixture.detectChanges();

    expect(component.suggestNext).toBeFalse();
    expect(hinted()).toEqual([]);
    expect(component.hintCaption).toBeNull();
  });

  it('shows nothing with nothing selected', () => {
    progression.setKey(0, 'ionian');
    progression.appendSlot(4);
    progression.selectSlot(null);
    fixture.detectChanges();

    expect(hinted()).toEqual([]);
    expect(component.hintCaption).toBeNull();
  });

  /**
   * Every append selects, so the caption appears with the click. Drawn above
   * the chords it pushed them down under the pointer; it sits below the append
   * rows so that it cannot. Measured from the panel, as the main spec's
   * Borrowed-row version of this test argues.
   */
  it('leaves a diatonic button where it was when it is clicked', () => {
    progression.setKey(0, 'ionian');
    fixture.detectChanges();

    const panel: HTMLElement = fixture.nativeElement.querySelector('.chord-palette');
    const button: HTMLElement = fixture.nativeElement.querySelectorAll('button.chord')[4];
    const fromPanelTop = (element: HTMLElement): number =>
      element.getBoundingClientRect().top - panel.getBoundingClientRect().top;
    const before = fromPanelTop(button);

    button.click();
    fixture.detectChanges();

    expect(component.hintCaption).not.toBeNull();
    expect(fromPanelTop(button)).toBe(before);
  });

  it('puts the caption on the page', () => {
    progression.setKey(0, 'ionian');
    progression.appendSlot(4);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('After V (G Maj)');
  });
});
