import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerStatusLineComponent, overBarCountOf } from './composer-status-line.component';
import { createDefaultCursor } from '../../../../models/composer.model';
import { ComposerService } from '../../../../services/composer.service';

describe('ComposerStatusLineComponent', () => {
  let fixture: ComponentFixture<ComposerStatusLineComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerStatusLineComponent] }).compileComponents();
    fixture = TestBed.createComponent(ComposerStatusLineComponent);
  });

  const region = (): HTMLElement => fixture.nativeElement.querySelector('[aria-live="polite"]');

  /** An empty score whose bar `barIndex` starts with a whole rest before its four quarters: over by a whole. */
  function scoreWithBarOver(barIndex: number): ReturnType<typeof ComposerService.createEmptyScore> {
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[barIndex].voices[0].beats[0].duration = 1;
    return doc;
  }

  it('has its polite live region in the tree before there is anything to say', () => {
    fixture.detectChanges();

    expect(region()).not.toBeNull();
    expect(region().textContent?.trim()).toBe('');
  });

  it('says why the last press did nothing', () => {
    fixture.componentRef.setInput('refusal', 'There is no note there to change.');
    fixture.detectChanges();

    expect(region().textContent).toContain('There is no note there to change.');
  });

  it('shows a failed alphaTex apply beside a refusal', () => {
    fixture.componentRef.setInput('refusal', 'Nothing is selected.');
    fixture.componentRef.setInput('texError', 'alphaTex could not be parsed. The score is unchanged.');
    fixture.detectChanges();

    expect(region().textContent).toContain('could not be parsed');
    expect(region().textContent).toContain('Nothing is selected.');
  });

  it('says what Fix bar or a paste did, in the same region', () => {
    fixture.componentRef.setInput('notice', 'Fixed 1 bar, adding 1 bar at the end.');
    fixture.detectChanges();

    expect(region().textContent).toContain('Fixed 1 bar');
  });

  it('replaces the message in the region when the same words are published again, so a screen reader says them again', () => {
    fixture.componentRef.setInput('refusal', 'No selected bar is over its time signature.');
    fixture.componentRef.setInput('messageId', 1);
    fixture.detectChanges();
    const first = region().querySelector('.message');

    fixture.componentRef.setInput('cursor', createDefaultCursor());
    fixture.detectChanges();
    expect(region().querySelector('.message')).withContext('nothing new was published').toBe(first);

    fixture.componentRef.setInput('messageId', 2);
    fixture.detectChanges();
    const second = region().querySelector('.message');

    expect(second?.textContent ?? '').toBe(first?.textContent ?? '');
    expect(second).not.toBe(first);
  });

  it('replaces the alphaTex message when the page says the same words again, so a screen reader says them again', () => {
    fixture.componentRef.setInput('texError', 'Apply or revert the alphaTex draft before saving.');
    fixture.componentRef.setInput('texErrorId', 1);
    fixture.detectChanges();
    const first = region().querySelector('.message');

    fixture.componentRef.setInput('cursor', createDefaultCursor());
    fixture.detectChanges();
    expect(region().querySelector('.message')).withContext('the page said nothing new').toBe(first);

    fixture.componentRef.setInput('texErrorId', 2);
    fixture.detectChanges();
    const second = region().querySelector('.message');

    expect(second?.textContent ?? '').toBe(first?.textContent ?? '');
    expect(second).not.toBe(first);
  });

  it('shows the caret\'s bar and beat, counting from one, outside the live region', () => {
    fixture.componentRef.setInput('cursor', { ...createDefaultCursor(), barIndex: 2, beatIndex: 1 });
    fixture.detectChanges();

    const readout: HTMLElement = fixture.nativeElement.querySelector('.readout');
    expect(readout.textContent).toContain('Bar 3');
    expect(readout.textContent).toContain('Beat 2');
    expect(region().contains(readout)).toBeFalse();
  });

  it('says how many bars the score has beside the caret\'s bar', () => {
    fixture.componentRef.setInput('cursor', { ...createDefaultCursor(), barIndex: 2, beatIndex: 1 });
    fixture.componentRef.setInput('doc', ComposerService.createEmptyScore());
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.readout').textContent).toContain('Bar 3 of 4');
  });

  it('says how many bars are over their time signature on a plain line, outside the live region', () => {
    fixture.componentRef.setInput('doc', ComposerService.createEmptyScore());
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.over-bars')).toBeNull();

    fixture.componentRef.setInput('doc', scoreWithBarOver(1));
    fixture.detectChanges();

    const over: HTMLElement = fixture.nativeElement.querySelector('.over-bars');
    expect(over.textContent?.trim()).toBe('1 bar over its time signature');
    expect(region().contains(over)).toBeFalse();
  });

  it('counts every staff\'s bar that is over, with scoreBarFills', () => {
    const doc = scoreWithBarOver(0);
    doc.tracks[0].staves[0].bars[2].voices[0].beats[0].duration = 1;

    expect(overBarCountOf(ComposerService.createEmptyScore())).toBe(0);
    expect(overBarCountOf(doc)).toBe(2);
  });
});
