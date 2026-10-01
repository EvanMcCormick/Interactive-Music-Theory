import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { SongEditorComponent } from './song-editor/song-editor.component';
import { SongLibraryPageComponent } from './song-library-page/song-library-page.component';
import { SONG_ROUTES } from './songs.routes';
import { deletedDatabase } from '../../services/indexed-db.spec-helper';
import { SONG_LIBRARY_DB } from '../../services/song-library.service';

/**
 * The two song routes `main.ts` registers, resolved through the router as the app resolves them - lazily - so a typo in
 * an import path or an export name fails here rather than on the first click in the nav.
 */
describe('SONG_ROUTES', () => {
  let harness: RouterTestingHarness;
  let dbName: string;

  beforeEach(async () => {
    dbName = `song-routes-spec-${Math.random().toString(36).slice(2)}`;
    TestBed.configureTestingModule({
      providers: [provideRouter(SONG_ROUTES), { provide: SONG_LIBRARY_DB, useValue: dbName }]
    });
    harness = await RouterTestingHarness.create();
  });

  afterEach(async () => {
    harness.fixture.destroy();
    await deletedDatabase(dbName);
  });

  it('shows the library at /songs', async () => {
    const page = await harness.navigateByUrl('/songs', SongLibraryPageComponent);

    expect(page).toBeInstanceOf(SongLibraryPageComponent);
  });

  it('shows the song editor at /songs/<id>, with its way back to the library', async () => {
    const editor = await harness.navigateByUrl('/songs/x', SongEditorComponent);

    expect(editor).toBeInstanceOf(SongEditorComponent);
    const back = (harness.routeNativeElement as HTMLElement).querySelector('a.back-to-library');
    expect(back?.getAttribute('href')).toBe('/songs');
    expect(back?.textContent?.trim()).toBe('← Library');
  });
});
