import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerComponent } from './composer.component';
import { ComposerLibraryPanelComponent } from './components/composer-library-panel/composer-library-panel.component';
import { ComposerScoreComponent } from './components/composer-score/composer-score.component';
import { ComposerService } from '../../services/composer.service';
import { ProgressionService } from '../../services/progression.service';
import { TrackDoc } from '../../models/composer.model';

/**
 * The Tracks panel, and the four controls a generated track adds to it.
 *
 * `composer.service.generated.spec.ts` has already pinned what the three
 * commands do to a document, and `progression-track.spec.ts` what the merge,
 * the flatten and the staleness read do as pure functions. Nothing here
 * re-checks any of that. What is pinned below is only what the panel is
 * answerable for, and it is three things:
 *
 *  - **Which name the badge says.** `mergeGeneratedTrack` deliberately keeps
 *    the incumbent track's name across an Update so a user's rename is never
 *    silently reverted, which means `track.name` can be older than the
 *    progression while `generated.progressionName` is always the marker's own
 *    current copy. A badge reading the wrong one of those would be right until
 *    the first rename and quietly wrong afterwards.
 *  - **Which controls refuse.** Update offers itself only when the score's copy
 *    is behind the progression; Remove never refuses, because removing a track
 *    is not an edit of the progression; and the caret can still land on a
 *    generated row, because a read-only track the caret cannot reach is worse
 *    than useless.
 *  - **What a screen reader is told.** The badge sits *beside* Update rather
 *    than inside it, so nothing carries it into the button's accessible name on
 *    its own. The labels are asserted; the styling is not.
 *
 * ## The two children are stubbed
 *
 * `ComposerScoreComponent` owns the alphaTab instance and engraves on
 * `AfterViewInit`; `ComposerLibraryPanelComponent` reads IndexedDB. Neither is
 * involved in a track row, and building either for real would make every test
 * in this file depend on a renderer and a database. `overrideComponent` swaps
 * both for empty standalone components wearing the same selectors, so the
 * template still compiles against known elements rather than a loosened schema.
 */
@Component({ selector: 'app-composer-score', standalone: true, template: '' })
class StubScoreComponent {}

@Component({ selector: 'app-composer-library-panel', standalone: true, template: '' })
class StubLibraryPanelComponent {}

describe('ComposerComponent tracks panel', () => {
  let fixture: ComponentFixture<ComposerComponent>;
  let component: ComposerComponent;
  let composer: ComposerService;
  let progression: ProgressionService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComposerComponent]
    })
      .overrideComponent(ComposerComponent, {
        remove: { imports: [ComposerScoreComponent, ComposerLibraryPanelComponent] },
        add: { imports: [StubScoreComponent, StubLibraryPanelComponent] }
      })
      .compileComponents();

    composer = TestBed.inject(ComposerService);
    progression = TestBed.inject(ProgressionService);

    fixture = TestBed.createComponent(ComposerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** The track rows, in the order the panel draws them. */
  function rows(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.track-item'));
  }

  function row(index: number): HTMLElement {
    const found = rows()[index];
    if (!found) throw new Error(`the panel drew no row ${index}`);
    return found;
  }

  function within(parent: HTMLElement, selector: string): HTMLElement | null {
    return parent.querySelector(selector);
  }

  /** A control that must be there, as the button it is. */
  function button(parent: HTMLElement, selector: string): HTMLButtonElement {
    const found = parent.querySelector(selector);
    if (!(found instanceof HTMLButtonElement)) {
      throw new Error(`the row holds no ${selector}`);
    }
    return found;
  }

  /**
   * The progression under a name of its own.
   *
   * Nothing renames a progression through the service today - the model's
   * `UNTITLED_PROGRESSION_NAME` docstring says as much - so the document is
   * replaced wholesale. A name that is not `Untitled` is what lets the badge
   * assertions below distinguish the marker's copy from the row's own label.
   */
  function nameProgression(name: string): void {
    progression.replaceDocument({ ...progression.doc, name });
  }

  /**
   * A progression with something in it, sent into the score.
   *
   * `appendSlot` is what moves `revision`, so the send below marks the track
   * with 1 rather than with the empty document's 0 - which is what lets a
   * second append make it stale without any other setup.
   */
  function sendAProgression(): void {
    progression.appendSlot(0);
    component.addProgressionTrack();
    fixture.detectChanges();
  }

  /** The score's generated track, or a failure. */
  function generatedTrack(): TrackDoc {
    const found = composer.doc.tracks.find(track => track.generated !== null);
    if (!found) throw new Error('the score holds no generated track');
    return found;
  }

  /** Index of that track, which is what the row controls take. */
  function generatedIndex(): number {
    return composer.doc.tracks.findIndex(track => track.generated !== null);
  }

  // -------------------------------------------------------------------------
  // Adding
  // -------------------------------------------------------------------------

  it('adds the progression as a track carrying its marker', () => {
    progression.appendSlot(0);

    component.addProgressionTrack();
    fixture.detectChanges();

    const track = generatedTrack();
    expect(track.generated?.progressionId).toBe(progression.doc.id);
    expect(track.generated?.source).toEqual({ kind: 'revision', revision: progression.doc.revision });
  });

  it('leaves the tracks that were already there alone', () => {
    const before = composer.doc.tracks[0].id;

    sendAProgression();

    expect(composer.doc.tracks.length).toBe(2);
    expect(composer.doc.tracks[0].id).toBe(before);
  });

  // -------------------------------------------------------------------------
  // The badge
  // -------------------------------------------------------------------------

  it('draws no badge on an ordinary track', () => {
    expect(within(row(0), '.track-badge')).toBeNull();
  });

  it('badges a generated track with the progression it came from', () => {
    nameProgression('Verse');
    sendAProgression();

    const badge = within(row(generatedIndex()), '.track-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('Verse');
  });

  /**
   * The rule the marker exists for. `mergeGeneratedTrack` keeps the incumbent
   * name across an Update so a rename survives, so `track.name` is the user's
   * word for the row and `generated.progressionName` is the progression's own -
   * a badge that read the first would say "Rhythm gtr came from Rhythm gtr".
   */
  it('says the progression\'s name and not the renamed track\'s', () => {
    nameProgression('Verse');
    sendAProgression();

    const renamed = composer.doc.tracks.map(track =>
      track.generated ? { ...track, name: 'Rhythm gtr' } : track
    );
    composer.replaceDocument({ ...composer.doc, tracks: renamed });
    fixture.detectChanges();

    const generatedRow = row(generatedIndex());
    expect(within(generatedRow, '.track-name')!.textContent).toContain('Rhythm gtr');
    expect(within(generatedRow, '.track-badge')!.textContent).toContain('Verse');
    expect(within(generatedRow, '.track-badge')!.textContent).not.toContain('Rhythm gtr');
  });

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  it('offers no Update on an ordinary track', () => {
    expect(within(row(0), '.track-update')).toBeNull();
  });

  it('disables Update while the track is current', () => {
    sendAProgression();

    expect(button(row(generatedIndex()), '.track-update').disabled).toBeTrue();
  });

  it('enables Update once the progression has moved on', () => {
    sendAProgression();

    progression.appendSlot(1);
    fixture.detectChanges();

    expect(button(row(generatedIndex()), '.track-update').disabled).toBeFalse();
  });

  /**
   * Divergence is the other half of stale, and the panel must not have learned
   * only the revision half: a score-wide bar insertion moves the track's
   * content without moving the progression's revision.
   */
  it('enables Update when the score itself has moved the track', () => {
    sendAProgression();

    composer.insertBar(1);
    fixture.detectChanges();

    expect(button(row(generatedIndex()), '.track-update').disabled).toBeFalse();
  });

  it('refreshes the marker when Update is pressed', () => {
    sendAProgression();
    const first = progression.doc.revision;

    progression.appendSlot(1);
    fixture.detectChanges();
    button(row(generatedIndex()), '.track-update').click();
    fixture.detectChanges();

    expect(generatedTrack().generated?.source).toEqual({
      kind: 'revision',
      revision: progression.doc.revision
    });
    expect(progression.doc.revision).not.toBe(first);
  });

  it('names the track and the reason in Update\'s accessible label', () => {
    nameProgression('Verse');
    sendAProgression();

    const current = button(row(generatedIndex()), '.track-update').getAttribute('aria-label') ?? '';
    expect(current).toContain(generatedTrack().name);
    expect(current).toContain('Verse');
    expect(current).toMatch(/up to date/i);

    progression.appendSlot(1);
    fixture.detectChanges();

    const stale = button(row(generatedIndex()), '.track-update').getAttribute('aria-label') ?? '';
    expect(stale).toContain(generatedTrack().name);
    expect(stale).toContain('Verse');
    expect(stale).toMatch(/changed/i);
  });

  // -------------------------------------------------------------------------
  // Flatten
  // -------------------------------------------------------------------------

  it('offers no Flatten on an ordinary track', () => {
    expect(within(row(0), '.track-flatten')).toBeNull();
  });

  it('detaches the track from its progression when Flatten is pressed', () => {
    sendAProgression();
    const index = generatedIndex();
    const before = composer.doc.tracks.length;

    button(row(index), '.track-flatten').click();
    fixture.detectChanges();

    expect(composer.doc.tracks.length).toBe(before);
    expect(composer.doc.tracks[index].generated).toBeNull();
    expect(within(row(index), '.track-badge')).toBeNull();
  });

  it('names the track and the progression in Flatten\'s accessible label', () => {
    nameProgression('Verse');
    sendAProgression();

    const label =
      button(row(generatedIndex()), '.track-flatten').getAttribute('aria-label') ?? '';
    expect(label).toContain(generatedTrack().name);
    expect(label).toContain('Verse');
  });

  // -------------------------------------------------------------------------
  // What a generated track does not take away
  // -------------------------------------------------------------------------

  /** Removing the track is not an edit of the progression. */
  it('leaves Remove enabled on a generated track', () => {
    sendAProgression();

    expect(button(row(generatedIndex()), '.track-remove').disabled).toBeFalse();
  });

  it('removes a generated track when Remove is pressed', () => {
    sendAProgression();

    button(row(generatedIndex()), '.track-remove').click();
    fixture.detectChanges();

    expect(composer.doc.tracks.every(track => track.generated === null)).toBeTrue();
  });

  /**
   * The caret can rest on a generated track. Only note- and beat-level edits
   * are refused, and that refusal lives in the service; a row the caret could
   * not reach would leave the user unable to read the track through the cursor
   * at all.
   */
  it('still selects a generated track when its row is clicked', () => {
    sendAProgression();
    const index = generatedIndex();

    row(index).click();
    fixture.detectChanges();

    expect(component.state?.cursor.trackIndex).toBe(index);
  });

  it('does not select the track when a row control is pressed', () => {
    sendAProgression();
    component.selectTrack(0);
    fixture.detectChanges();

    button(row(generatedIndex()), '.track-flatten').click();
    fixture.detectChanges();

    expect(component.state?.cursor.trackIndex).toBe(0);
  });

  // -------------------------------------------------------------------------
  // The panel's own button
  // -------------------------------------------------------------------------

  it('offers Add progression track beside Add track', () => {
    const panel: HTMLElement = fixture.nativeElement;
    const add = panel.querySelector('.add-progression-track');

    expect(add).not.toBeNull();
    expect(panel.querySelector('.add-track')!.contains(add)).toBeTrue();
  });

  it('sends the progression when Add progression track is pressed', () => {
    progression.appendSlot(0);

    (fixture.nativeElement.querySelector('.add-progression-track') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(generatedTrack().generated?.progressionId).toBe(progression.doc.id);
  });

  /**
   * Pressed twice, it is a Send and then an Update - `sendProgression` merges
   * in place on `progressionId`. A second row would be a second engraving of
   * one progression that Update could then only refresh one of.
   */
  it('refreshes rather than appending a second copy', () => {
    sendAProgression();
    progression.appendSlot(1);

    (fixture.nativeElement.querySelector('.add-progression-track') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(composer.doc.tracks.filter(track => track.generated !== null).length).toBe(1);
  });
});
