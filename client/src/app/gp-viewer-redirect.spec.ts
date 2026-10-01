import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { gpViewerRedirect } from './gp-viewer-redirect';

@Component({ standalone: true, template: '' })
class BlankComponent {}

describe('gpViewerRedirect', () => {
  let router: Router;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'gp-viewer', redirectTo: gpViewerRedirect },
          { path: 'composer', component: BlankComponent },
          { path: 'gp-library', component: BlankComponent }
        ])
      ]
    });
    router = TestBed.inject(Router);
    harness = await RouterTestingHarness.create();
  });

  /** Where the router ended up, as a path and the `gp` it carries. */
  function landing(): { path: string; gp: string | undefined } {
    const tree = router.parseUrl(router.url);
    return {
      path: '/' + (tree.root.children['primary']?.segments.map(segment => segment.path).join('/') ?? ''),
      gp: tree.queryParams['gp']
    };
  }

  it("opens an old link to a file in the viewer in the composer, as that file's ?gp=", async () => {
    await harness.navigateByUrl('/gp-viewer?id=abc-123');

    expect(landing()).toEqual({ path: '/composer', gp: 'abc-123' });
  });

  it('carries an id with a slash and a space through whole', async () => {
    await harness.navigateByUrl(`/gp-viewer?id=${encodeURIComponent('songs/my tab')}`);

    expect(landing()).toEqual({ path: '/composer', gp: 'songs/my tab' });
  });

  // The quirk the old string redirect had: Angular reads a redirect's query value that starts with `:` as a
  // reference to one of the old URL's parameters, so `/composer?gp=:abc` looked for a parameter `abc` and came out
  // with no `gp` at all.
  it('carries an id that starts with a colon through as the id, not as a parameter reference', async () => {
    await harness.navigateByUrl(`/gp-viewer?id=${encodeURIComponent(':abc')}`);

    expect(landing()).toEqual({ path: '/composer', gp: ':abc' });
  });

  it('sends an old link to the viewer alone to the gallery', async () => {
    await harness.navigateByUrl('/gp-viewer');

    expect(landing()).toEqual({ path: '/gp-library', gp: undefined });
  });

  it('sends a link with an empty id to the gallery', async () => {
    await harness.navigateByUrl('/gp-viewer?id=');

    expect(landing()).toEqual({ path: '/gp-library', gp: undefined });
  });
});
