import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerToolPopoverComponent, popoverPlacementOf } from './composer-tool-popover.component';
import { ComposerService } from '../../../../services/composer.service';
import { effectiveTimeSignature } from '../../../../models/composer.model';
import { KEY_SIGNATURE_CHOICES } from '../../../../services/composer-bar-choices';
import { PopoverKind } from '../../../../services/composer-tools';

describe('popoverPlacementOf', () => {
  const viewport = { width: 1000, height: 600 };
  const size = { width: 240, height: 200 };

  it('goes to the right of its trigger, level with the trigger\'s top', () => {
    expect(popoverPlacementOf({ left: 10, top: 100, right: 50, bottom: 140 }, size, viewport)).toEqual({ left: 56, top: 100, maxHeight: 494 });
  });

  it('is never taller than the room below its top, so content that grows scrolls inside the window', () => {
    expect(popoverPlacementOf({ left: 10, top: 300, right: 50, bottom: 340 }, size, viewport).maxHeight).toBe(294);
    expect(popoverPlacementOf({ left: 10, top: 300, right: 50, bottom: 340 }, { width: 240, height: 700 }, viewport)).toEqual({
      left: 56,
      top: 6,
      maxHeight: 588
    });
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

  it('keeps a key pressed inside it from the page - a digit, R, an arrow, Space, ? - and lets Tab, Escape and Ctrl through', () => {
    open('alternateEnding');
    const checkbox = panel().querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.focus();
    const seen: string[] = [];
    const listen = (event: KeyboardEvent): void => void seen.push(event.key);
    document.addEventListener('keydown', listen);
    try {
      for (const init of [
        { key: '5', code: 'Digit5' },
        { key: 'r', code: 'KeyR' },
        { key: 'ArrowRight' },
        { key: ' ', code: 'Space' },
        { key: '?', code: 'Slash', shiftKey: true },
        { key: 'Tab' },
        { key: 's', code: 'KeyS', ctrlKey: true },
        { key: 'Escape' }
      ]) {
        checkbox.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
      }
    } finally {
      document.removeEventListener('keydown', listen);
    }

    expect(seen).toEqual(['Tab', 's', 'Escape']);
  });

  it('leaves an Escape something before it claimed', () => {
    open('clef');
    const claim = (event: KeyboardEvent): void => event.preventDefault();
    document.addEventListener('keydown', claim, true);
    try {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    } finally {
      document.removeEventListener('keydown', claim, true);
    }

    expect(closed).toBe(0);
  });

  describe('beside another element', () => {
    let outside: HTMLButtonElement;

    beforeEach(() => {
      outside = document.createElement('button');
      document.body.appendChild(outside);
    });

    afterEach(() => outside.remove());

    const pointerDownOn = (target: Element): void => void target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));

    it('closes on a press outside it and its trigger, and not on a press on either', () => {
      open('clef');

      pointerDownOn(panel().querySelector('select') as HTMLSelectElement);
      pointerDownOn(trigger('clef'));
      expect(closed).toBe(0);

      pointerDownOn(outside);
      expect(closed).toBe(1);
    });

    it('gives the focus back to its trigger only when the focus was inside it', () => {
      open('clef');
      outside.focus();

      open(null);

      expect(document.activeElement).toBe(outside);
    });

    it('leaves the focus to the press that closed it', () => {
      open('clef');
      pointerDownOn(outside);

      open(null);

      expect(document.activeElement).not.toBe(trigger('clef'));
    });
  });

  it('follows its trigger when the window is resized or a box scrolls', async () => {
    const frame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));
    triggers.style.cssText = 'position: fixed; left: 10px; top: 40px;';
    open('clef');
    const left = panel().getBoundingClientRect().left;

    triggers.style.left = '110px';
    window.dispatchEvent(new Event('resize'));
    await frame();
    await frame();
    expect(panel().getBoundingClientRect().left).toBeCloseTo(left + 100, 0);

    triggers.style.top = '140px';
    triggers.dispatchEvent(new Event('scroll'));
    await frame();
    await frame();
    expect(panel().getBoundingClientRect().top).toBeCloseTo(trigger('clef').getBoundingClientRect().top, 0);
  });

  it('reads the first bar of a range selected rightwards, and Apply unchanged leaves the bars as they were', () => {
    // Bar 3 declares 3/4. A range from bar 1 to bar 3 has its head on bar 3, and Time signature writes at bar 1.
    composer.setCursor({ barIndex: 3, beatIndex: 0 });
    composer.setTimeSignature({ numerator: 3, denominator: 4, isCommon: false });
    composer.setCursor({ barIndex: 1, beatIndex: 0 });
    composer.extendSelectionTo({ barIndex: 3, beatIndex: 0 });

    open('timeSignature');
    expect(popover.numerator).toBe(4);
    popover.applyTimeSignature();

    expect([0, 1, 2, 3].map(index => effectiveTimeSignature(composer.doc.masterBars, index).numerator)).toEqual([4, 4, 4, 3]);
  });

  it('shows what the selected bars do not share as mixed, and Apply leaves each bar with its own', () => {
    // Bar 2 on has its own key and clef; bar 2 alone its own section, ending and feel. Bars 1 and 2 share none of them.
    composer.setCursor({ barIndex: 2, beatIndex: 0 });
    composer.setKeySignature({ fifths: 1, mode: 'major' });
    composer.setClef('f4', 'regular');
    composer.setMasterBarValue('section', { marker: 'B', text: 'Chorus' });
    composer.setMasterBarValue('alternateEndings', 0b1);
    composer.setMasterBarValue('tripletFeel', 'triplet8th');
    composer.setCursor({ barIndex: 1, beatIndex: 0 });
    composer.extendSelectionTo({ barIndex: 2, beatIndex: 0 });
    const before = JSON.stringify(composer.doc);

    const applies: Array<[PopoverKind, () => void]> = [
      ['keySignature', () => popover.applyKeySignature()],
      ['clef', () => popover.applyClef()],
      ['section', () => popover.applySection()],
      ['alternateEnding', () => popover.applyEndings()],
      ['tripletFeel', () => popover.applyTripletFeel()]
    ];
    for (const [kind, apply] of applies) {
      open(kind);
      expect(panel().textContent).withContext(kind).toContain('Mixed');
      apply();
      fixture.detectChanges();
      expect(alert().textContent?.trim()).withContext(kind).toBe('');
      open(null);
    }

    expect(JSON.stringify(composer.doc)).toBe(before);
    expect(closed).toBe(applies.length);
  });

  it('starts the key from C major when the bar holds one it does not offer, not from the key it last showed', () => {
    composer.setKeySignature({ fifths: 1, mode: 'major' });
    open('keySignature');
    open(null);
    const doc = structuredClone(composer.doc);
    doc.tracks[0].staves[0].bars[0].keySignature = { fifths: 9, mode: 'major' };
    composer.replaceDocument(doc);

    open('keySignature');

    expect(KEY_SIGNATURE_CHOICES[Number(popover.keyIndex)]?.value).toEqual({ fifths: 0, mode: 'major' });
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

  it('says which tuplet the selection is under: none, one ratio, or mixed', () => {
    const current = (): string => (panel().querySelector('.current') as HTMLElement | null)?.textContent?.trim() ?? '';
    open('tuplet');
    expect(current()).toBe('Now: none');
    open(null);

    composer.setCursor({ barIndex: 0, beatIndex: 0 });
    composer.extendSelectionTo({ barIndex: 0, beatIndex: 2 });
    composer.setTuplet({ numerator: 3, denominator: 2 });
    open('tuplet');
    expect(current()).toBe('Now: 3:2');
    expect(panel().querySelector('[aria-pressed="true"]')?.textContent?.trim()).toBe('3:2');
    open(null);

    composer.setCursor({ barIndex: 0, beatIndex: 0 });
    composer.extendSelectionTo({ barIndex: 0, beatIndex: 3 });
    open('tuplet');
    expect(current()).toBe('Now: mixed');
  });

  it('stays open on a tuplet the selection cannot take, saying why inline and in the status line', () => {
    // One quarter cannot make a whole 5:4 group (`tupletRefusal`).
    composer.setCursor({ barIndex: 0, beatIndex: 0 });
    open('tuplet');

    popover.applyTuplet({ numerator: 5, denominator: 4 });
    fixture.detectChanges();

    expect(closed).toBe(0);
    expect(alert().textContent).toMatch(/tuplet needs/i);
    expect(composer.state.refusal).toMatch(/tuplet needs/i);
  });
});
