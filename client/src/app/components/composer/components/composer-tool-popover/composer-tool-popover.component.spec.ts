import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerToolPopoverComponent, popoverPlacementOf } from './composer-tool-popover.component';
import { ComposerService } from '../../../../services/composer.service';
import { KEY_SIGNATURE_CHOICES } from '../../../../services/composer-bar-choices';
import { PopoverKind } from '../../../../services/composer-tools';

describe('popoverPlacementOf', () => {
  const viewport = { width: 1000, height: 600 };
  const size = { width: 240, height: 200 };

  it('goes to the right of its trigger, level with the trigger\'s top', () => {
    expect(popoverPlacementOf({ left: 10, top: 100, right: 50, bottom: 140 }, size, viewport)).toEqual({ left: 56, top: 100, maxHeight: 588 });
  });

  it('goes to the left when the right has no room', () => {
    expect(popoverPlacementOf({ left: 900, top: 100, right: 940, bottom: 140 }, size, viewport).left).toBe(654);
  });

  it('moves up to keep its bottom in the window, and scrolls in a window shorter than itself', () => {
    expect(popoverPlacementOf({ left: 10, top: 550, right: 50, bottom: 590 }, size, viewport).top).toBe(394);
    expect(popoverPlacementOf({ left: 10, top: 50, right: 50, bottom: 90 }, size, { width: 1000, height: 150 })).toEqual({
      left: 56,
      top: 6,
      maxHeight: 138
    });
  });
});

describe('ComposerToolPopoverComponent', () => {
  let fixture: ComponentFixture<ComposerToolPopoverComponent>;
  let popover: ComposerToolPopoverComponent;
  let composer: ComposerService;
  let closed: number;
  let triggers: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerToolPopoverComponent] }).compileComponents();
    composer = TestBed.inject(ComposerService);
    fixture = TestBed.createComponent(ComposerToolPopoverComponent);
    popover = fixture.componentInstance;
    closed = 0;
    popover.closed.subscribe(() => closed++);

    // The palette's buttons, as the popover finds them: one per valued tool, marked `data-tool`.
    triggers = document.createElement('div');
    for (const kind of ['timeSignature', 'keySignature', 'clef', 'section', 'alternateEnding', 'tuplet', 'tripletFeel']) {
      const button = document.createElement('button');
      button.dataset['tool'] = kind;
      triggers.appendChild(button);
    }
    document.body.appendChild(triggers);
    fixture.componentRef.setInput('triggers', triggers);
  });

  afterEach(() => triggers.remove());

  function open(kind: PopoverKind | null): void {
    fixture.componentRef.setInput('kind', kind);
    fixture.componentRef.setInput('state', composer.state);
    fixture.detectChanges();
  }

  const alert = (): HTMLElement => fixture.nativeElement.querySelector('[role="alert"]');
  const panel = (): HTMLElement => fixture.nativeElement.querySelector('.popover');
  const trigger = (kind: PopoverKind): HTMLElement => triggers.querySelector(`[data-tool="${kind}"]`) as HTMLElement;

  it('opens in the top layer beside its trigger, and focuses its first control', () => {
    open('clef');

    expect(panel().matches(':popover-open')).toBeTrue();
    expect(panel().getBoundingClientRect().left).toBeGreaterThanOrEqual(trigger('clef').getBoundingClientRect().right);
    expect(document.activeElement).toBe(panel().querySelector('select'));
  });

  it('gives focus back to its trigger when it closes', () => {
    open('clef');
    open(null);

    expect(panel().matches(':popover-open')).toBeFalse();
    expect(document.activeElement).toBe(trigger('clef'));
  });

  it('keeps what is being typed while the state moves on, and starts again for another kind', () => {
    open('timeSignature');
    popover.numerator = 7;

    composer.setCursor({ beatIndex: 1 });
    open('timeSignature');
    expect(popover.numerator).toBe(7);

    open('keySignature');
    open('timeSignature');
    expect(popover.numerator).toBe(4);
  });

  it('closes on Escape and claims it, so the page does not also go back to Select', () => {
    open('clef');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

    document.activeElement?.dispatchEvent(escape);

    expect(escape.defaultPrevented).toBeTrue();
    expect(closed).toBe(1);
  });

  it('starts from the caret\'s meter', () => {
    composer.setTimeSignature({ numerator: 3, denominator: 4, isCommon: false });

    open('timeSignature');

    expect(popover.numerator).toBe(3);
  });

  it('refuses an invalid time signature inline, commits nothing, and stays open', () => {
    open('timeSignature');
    const before = JSON.stringify(composer.doc);

    popover.numerator = 0;
    popover.applyTimeSignature();
    fixture.detectChanges();

    expect(alert().textContent).toMatch(/numerator/i);
    expect(JSON.stringify(composer.doc)).toBe(before);
    expect(closed).toBe(0);
  });

  it('sets a valid time signature and closes', () => {
    // The empty score is in common time, so the popover opens with the box ticked.
    open('timeSignature');
    expect(popover.isCommon).toBeTrue();

    popover.numerator = 6;
    popover.denominator = 8;
    popover.isCommon = false;
    popover.applyTimeSignature();

    expect(composer.scoreMeter).toEqual({ numerator: 6, denominator: 8, isCommon: false });
    expect(closed).toBe(1);
  });

  it('refuses common time for a meter alphaTab does not draw with a C', () => {
    open('timeSignature');

    popover.numerator = 3;
    popover.denominator = 4;
    popover.isCommon = true;
    popover.applyTimeSignature();

    expect(popover.fault).toMatch(/4\/4/);
    expect(closed).toBe(0);
  });

  it('offers every key and sets the one chosen', () => {
    open('keySignature');
    expect(popover.keyChoices.length).toBe(30);

    popover.keyIndex = KEY_SIGNATURE_CHOICES.findIndex(choice => choice.value.fifths === 7 && choice.value.mode === 'minor');
    popover.applyKeySignature();

    expect(composer.doc.tracks[0].staves[0].bars[0].keySignature).toEqual({ fifths: 7, mode: 'minor' });
  });

  it('refuses a section with no name, and sets one with a name', () => {
    open('section');

    popover.sectionText = '   ';
    popover.applySection();
    fixture.detectChanges();
    expect(alert().textContent).toMatch(/name/i);

    popover.sectionText = 'Chorus';
    popover.sectionMarker = 'B';
    popover.applySection();
    expect(composer.doc.masterBars[0].section).toEqual({ marker: 'B', text: 'Chorus' });
  });

  it('sets alternate endings from the boxes ticked', () => {
    open('alternateEnding');

    popover.endings[0] = true;
    popover.endings[1] = true;
    popover.applyEndings();

    expect(composer.doc.masterBars[0].alternateEndings).toBe(0b11);
  });

  it('puts the selected beats under the tuplet chosen', () => {
    // Three quarters, so the 3:2 makes a whole group; fewer is refused (`tupletRefusal`).
    composer.setCursor({ barIndex: 0, beatIndex: 0 });
    composer.extendSelectionTo({ barIndex: 0, beatIndex: 2 });
    open('tuplet');

    popover.applyTuplet({ numerator: 3, denominator: 2 });

    const beats = composer.doc.tracks[0].staves[0].bars[0].voices[0].beats;
    expect(beats.slice(0, 3).map(beat => beat.tuplet)).toEqual([0, 1, 2].map(() => ({ numerator: 3, denominator: 2 })));
    expect(closed).toBe(1);
  });
});
