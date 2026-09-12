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
 * answerable for, and it is four things:
 *
 *  - **Which name the badge says.** `mergeGeneratedTrack` deliberately keeps
 *    the incumbent track's name across an Update so a user's rename is never
 *    silently reverted, which means `track.name` can be older than the
 *    progression while `generated.progressionName` is always the marker's own
 *    current copy. A badge reading the wrong one of those would be right until
 *    the first rename and quietly wrong afterwards.
 *  - **What the row says the state is.** The status beside the badge is the
 *    only place the four answers are readable without focusing a control, and
 *    it is the reason the labels below can be short. It has to tell the two
 *    halves of stale apart: a moved revision and a score edit that moved the
 *    track are not the same sentence, and only one of them is about the
 *    progression having changed.
 *  - **Which controls refuse.** Update refuses unless the score's copy is
 *    behind the progression, and "Add progression track" refuses on exactly the
 *    same reading, so the panel cannot do from one button what the button
 *    beside it is greyed out to prevent. Both refuse with `aria-disabled` and
 *    an early return rather than `disabled`, so a refusal keeps its focus and
 *    its tooltip; a refused press must therefore commit nothing. Remove never
 *    refuses, and the caret can still land on a generated row.
 *  - **What a screen reader is told.** The badge sits *beside* Update rather
 *    than inside it, so nothing carries it into the button's accessible name on
 *    its own. Every label leads with the word on the button, because an
 *    accessible name that drops the visible one is a speech-input user saying
 *    "click Update" and matching nothing (WCAG 2.1 SC 2.5.3). The labels are
 *    asserted; the styling is not.
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

  /** A control's accessible name, which is the `aria-label` on all of these. */
  function label(parent: HTMLElement, selector: string): string {
    return button(parent, selector).getAttribute('aria-label') ?? '';
  }

  /** Whether a control is refusing, which these say with `aria-disabled`. */
  function refuses(parent: HTMLElement, selector: string): boolean {
    return button(parent, selector).getAttribute('aria-disabled') === 'true';
  }

  /** The status the row shows beside the badge, trimmed of the template's space. */
  function status(index: number): string {
    return within(row(index), '.track-status')?.textContent?.trim() ?? '';
  }

  /** The panel's own send button, which is not inside any row. */
  function addProgression(): HTMLButtonElement {
    return button(fixture.nativeElement, '.add-progression-track');
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

  /**
   * Opens a progression that is not the one the score's track came from.
   *
   * The state the app cannot reach today and the component guards anyway:
   * `ProgressionDoc.id` is minted once per service, nothing else calls
   * `replaceDocument` with a new one, markers do not survive save and load, and
   * the two pages are separate routes. A progression library is what would make
   * it live, and this is the shape it would arrive in - so the branch is tested
   * here rather than left as the one of four with nobody reading it.
   *
   * The id is a literal rather than a `randomUUID`, because nothing here needs
   * it to be unique - it needs it to be *not the marker's*, and a name says so
   * where a UUID would only imply it.
   */
  function openAnotherProgression(): void {
    progression.replaceDocument({
      ...progression.doc,
      id: 'some-other-progression',
      name: 'Chorus'
    });
    fixture.detectChanges();
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
  // The status beside the badge
  // -------------------------------------------------------------------------

  it('shows no status on an ordinary track', () => {
    expect(within(row(0), '.track-status')).toBeNull();
  });

  it('says on screen that the track matches the progression', () => {
    sendAProgression();

    expect(status(generatedIndex())).toBe('up to date');
  });

  it('says on screen that the track is behind the progression', () => {
    sendAProgression();

    progression.appendSlot(1);
    fixture.detectChanges();

    expect(status(generatedIndex())).toBe('behind the progression');
  });

  /**
   * The half of stale the label used to lie about. A bar inserted into the
   * score moves the track's content and leaves the progression exactly as it
   * was, so a row saying the progression had changed would be telling a user
   * something false about a document they had not touched.
   */
  it('says on screen that a score edit moved the track', () => {
    sendAProgression();

    composer.insertBar(1);
    fixture.detectChanges();

    expect(status(generatedIndex())).toBe('moved by a score edit');
  });

  it('says on screen that the track came from a progression that is not open', () => {
    sendAProgression();

    openAnotherProgression();

    expect(status(generatedIndex())).toBe('progression not open');
  });

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  it('offers no Update on an ordinary track', () => {
    expect(within(row(0), '.track-update')).toBeNull();
  });

  /**
   * `aria-disabled` and not `disabled`, and the difference is the whole point
   * of the branch: `disabled` takes the button out of the tab order, which puts
   * its `aria-label` out of reach of the keyboard, and browsers suppress the
   * `title` tooltip on it as well. A refusal that hides its own reason from
   * everyone but a screen reader in browse mode is the reason the row now says
   * the state out loud too.
   */
  it('refuses Update while the track is current, and stays focusable', () => {
    sendAProgression();

    expect(refuses(row(generatedIndex()), '.track-update')).toBeTrue();
    expect(button(row(generatedIndex()), '.track-update').disabled).toBeFalse();
  });

  it('offers Update once the progression has moved on', () => {
    sendAProgression();

    progression.appendSlot(1);
    fixture.detectChanges();

    expect(refuses(row(generatedIndex()), '.track-update')).toBeFalse();
  });

  /**
   * Divergence is the other half of stale, and the panel must not have learned
   * only the revision half: a score-wide bar insertion moves the track's
   * content without moving the progression's revision.
   */
  it('offers Update when the score itself has moved the track', () => {
    sendAProgression();

    composer.insertBar(1);
    fixture.detectChanges();

    expect(refuses(row(generatedIndex()), '.track-update')).toBeFalse();
  });

  it('refuses Update for a track built from a progression that is not open', () => {
    sendAProgression();

    openAnotherProgression();

    expect(refuses(row(generatedIndex()), '.track-update')).toBeTrue();
  });

  /**
   * A refusal that is only advisory has to be honoured by the handler, and this
   * is the case that would go wrong quietly: the open progression is not the
   * one this row came from, so a press that fell through to the send would
   * append a *second* generated track rather than refreshing this one.
   */
  it('commits nothing when a refused Update is pressed', () => {
    sendAProgression();
    openAnotherProgression();
    const before = composer.doc;

    button(row(generatedIndex()), '.track-update').click();
    fixture.detectChanges();

    expect(composer.doc).toBe(before);
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

    const current = label(row(generatedIndex()), '.track-update');
    expect(current).toContain(generatedTrack().name);
    expect(current).toContain('Verse');
    expect(current).toMatch(/already matches/i);

    progression.appendSlot(1);
    fixture.detectChanges();

    const stale = label(row(generatedIndex()), '.track-update');
    expect(stale).toContain(generatedTrack().name);
    expect(stale).toContain('Verse');
    expect(stale).toMatch(/changed/i);
  });

  /**
   * The one label that used to state something false. `'stale'` has two halves
   * and the marker keeps them apart precisely so a reader can be told which
   * one; saying the progression had changed after `insertBar` told a
   * screen-reader user the opposite of what happened.
   */
  it('says a score edit moved the track rather than that the progression changed', () => {
    nameProgression('Verse');
    sendAProgression();

    composer.insertBar(1);
    fixture.detectChanges();

    const moved = label(row(generatedIndex()), '.track-update');
    expect(moved).toMatch(/score edit/i);
    expect(moved).not.toMatch(/progression Verse, which has changed/i);
  });

  it('says which progression is in the way when it is not the one open', () => {
    nameProgression('Verse');
    sendAProgression();

    openAnotherProgression();

    const foreign = label(row(generatedIndex()), '.track-update');
    expect(foreign).toContain('Verse');
    expect(foreign).toMatch(/not the progression that is open/i);
  });

  /**
   * WCAG 2.1 SC 2.5.3. An accessible name that does not contain the visible one
   * is a speech-input user saying "click Update" and matching nothing, so every
   * answer the button can give has to lead with the word printed on it - the
   * refusals included, since they are focusable now.
   */
  it('leads every Update label with the word on the button', () => {
    nameProgression('Verse');
    sendAProgression();
    expect(label(row(generatedIndex()), '.track-update')).toMatch(/^Update\b/);

    progression.appendSlot(1);
    fixture.detectChanges();
    expect(label(row(generatedIndex()), '.track-update')).toMatch(/^Update\b/);

    composer.insertBar(1);
    fixture.detectChanges();
    expect(label(row(generatedIndex()), '.track-update')).toMatch(/^Update\b/);

    openAnotherProgression();
    expect(label(row(generatedIndex()), '.track-update')).toMatch(/^Update\b/);
  });

  /**
   * Update is the control with a conditional refusal, so it is the one whose
   * `stopPropagation` can regress without the suite noticing - and it has to
   * hold in both states, because a refused press still runs the handler now.
   */
  it('does not select the track when Update is pressed', () => {
    sendAProgression();
    component.selectTrack(0);
    fixture.detectChanges();

    button(row(generatedIndex()), '.track-update').click();
    fixture.detectChanges();
    expect(component.state?.cursor.trackIndex).toBe(0);

    progression.appendSlot(1);
    fixture.detectChanges();
    button(row(generatedIndex()), '.track-update').click();
    fixture.detectChanges();
    expect(component.state?.cursor.trackIndex).toBe(0);
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
    fixture.detectChanges();

    addProgression().click();
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
    fixture.detectChanges();

    addProgression().click();
    fixture.detectChanges();

    expect(composer.doc.tracks.filter(track => track.generated !== null).length).toBe(1);
  });

  /**
   * The two buttons read one state. Left always enabled, this one would commit
   * a byte-identical merge - an undo entry and a dirty document for no change
   * on the page - which is the thing the Update beside it is refusing to do.
   */
  it('refuses to send a progression the score already holds unchanged', () => {
    sendAProgression();
    const before = composer.doc;

    expect(addProgression().getAttribute('aria-disabled')).toBe('true');
    expect(addProgression().disabled).toBeFalse();

    addProgression().click();
    fixture.detectChanges();

    expect(composer.doc).toBe(before);
  });

  it('offers itself again once the progression has moved on', () => {
    sendAProgression();

    progression.appendSlot(1);
    fixture.detectChanges();

    expect(addProgression().getAttribute('aria-disabled')).toBe('false');
  });

  /**
   * WCAG 2.1 SC 2.5.3 again, and the failure it names exactly: the button says
   * "Add progression track" and used to answer to "Add the current progression
   * to this score as a track", which shares no phrase with it.
   */
  it('keeps its visible label inside its accessible name', () => {
    const add = addProgression();
    const visible = add.textContent?.trim() ?? '';

    expect(visible).toBe('Add progression track');
    expect(add.getAttribute('aria-label')).toContain(visible);
    expect(add.getAttribute('aria-label')).toMatch(/^Add progression track\b/);
  });
});
