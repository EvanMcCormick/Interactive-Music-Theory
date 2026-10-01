import { inject } from '@angular/core';
import { RedirectFunction, Router } from '@angular/router';

/**
 * Where an old `/gp-viewer` link goes now the GP Viewer is gone: a link to a file opens that file in the composer, as
 * its `?gp=`, and a link to the viewer alone goes to the gallery.
 *
 * A `UrlTree` rather than a `/composer?gp=…` string, because Angular reads a redirect string's query value that starts
 * with `:` as a reference to one of the old URL's parameters - so an id like `:abc` came out with no `gp` at all - and a
 * tree carries the id as a value, with no encoding to get right. Redirect functions run in an injection context, which
 * is what lets this reach the `Router`.
 */
export const gpViewerRedirect: RedirectFunction = ({ queryParams }) => {
  const id = queryParams['id'];
  return id ? inject(Router).createUrlTree(['/composer'], { queryParams: { gp: id } }) : '/gp-library';
};
