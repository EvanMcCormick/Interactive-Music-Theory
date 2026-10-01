import { Routes } from '@angular/router';

/**
 * The songwriting pages: the library at `/songs` and a song's sheet at `/songs/:id` (design Part 6). `main.ts` spreads
 * these into the app's routes.
 *
 * **In a file of their own** so their spec resolves the very routes the app registers, rather than a copy of them that
 * could drift: `main.ts` bootstraps on import and cannot be imported by a spec.
 *
 * **Both lazy, and this file must stay free of value imports from the pages**, for the reason the other lazy routes in
 * `main.ts` give: what `main.ts` imports statically is in `main`. The library and the sheet both reach ProseMirror -
 * the library through `SongLibraryService`, which reads every song's document to make its card - and the sheet will
 * reach Tone for its audition, so a `component:` here would carry both into the bundle every visitor downloads. Only a
 * dynamic `import()` keeps them in the songs chunks.
 *
 * Two routes rather than a parent with children: the pages share no layout, so a parent would be a component that only
 * hosts an outlet.
 */
export const SONG_ROUTES: Routes = [
  {
    path: 'songs',
    loadComponent: () => import('./song-library-page/song-library-page.component')
      .then(m => m.SongLibraryPageComponent)
  },
  {
    path: 'songs/:id',
    loadComponent: () => import('./song-editor/song-editor.component')
      .then(m => m.SongEditorComponent)
  }
];
