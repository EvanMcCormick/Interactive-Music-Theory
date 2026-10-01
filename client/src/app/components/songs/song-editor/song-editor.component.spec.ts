import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Node } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { createExtensions } from '../../../models/progression-normalize';
import { ChordDegree, ProgressionKey } from '../../../models/progression.model';
import { SongDoc } from '../../../models/song.model';
import { deletedDatabase } from '../../../services/indexed-db.spec-helper';
import { AutosaveClock } from '../../../services/song-autosave';
import { chordSlotOf, chordsOf, sectionsOf, songMetaOf } from '../../../services/song-document';
import { SONG_LIBRARY_DB, SongLibraryService } from '../../../services/song-library.service';
import { songSchema } from '../../../services/song-schema';
import { SONG_PREFERENCES_STORAGE } from '../../../services/song-sheet-preferences.service';
import { SongSheetComponent } from '../song-sheet/song-sheet.component';
import { SONG_AUTOSAVE_CLOCK, SongEditorComponent } from './song-editor.component';

const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const FOUR_FOUR = { numerator: 4, denominator: 4, isCommon: true };

function degreeAt(degree: number): ChordDegree {
  return {
    degree,
    alter: 0,
    extent: 3,
    quality: null,
    inversion: 0,
    suspension: 'none',
    extensions: createExtensions(),
    octave: 0
  };
}

function chord(degree: number): Node {
  return songSchema.node('chord', chordSlotOf(degreeAt(degree), C_MAJOR, IONIAN, FOUR_FOUR));
}

/** "Last Dance" in C major: one verse, C over "Got" and Am over "thinking". */
function lastDance(): Node {
  return songSchema.node(
    'doc',
    { title: 'Last Dance', artist: 'The Band', key: C_MAJOR, tempo: 100, timeSignature: FOUR_FOUR },
    [
      songSchema.node('section', { id: crypto.randomUUID(), label: 'Verse 1', kind: 'verse' }, [
        songSchema.node('lyricLine', null, [
          chord(0),
          songSchema.text('Got me '),
          chord(5),
          songSchema.text('thinking')
        ])
      ])
    ]
  );
}

/** Time moved by hand, starting now so "Saved · just now" reads as it would. */
class FakeClock implements AutosaveClock {
  time = Date.now();
  private timers: { handle: number; at: number; callback: () => void }[] = [];
  private nextHandle = 1;

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const handle = this.nextHandle++;
    this.timers.push({ handle, at: this.time + ms, callback });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter(timer => timer.handle !== handle);
  }

  tick(ms: number): void {
    const until = this.time + ms;
    for (;;) {
      const due = this.timers.filter(timer => timer.at <= until).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter(timer => timer !== due);
      this.time = due.at;
      due.callback();
    }
    this.time = until;
  }
}

/** A promise the spec settles. */
class Deferred<T> {
  resolve: (value: T) => void = () => undefined;
  reject: (error: unknown) => void = () => undefined;
  readonly promise = new Promise<T>((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  });
}

@Component({ standalone: true, template: '<p class="library-stand-in">Library</p>' })
class LibraryStandIn {}

/**
 * The song page, `/songs/:id`: loading, the header and its save status, the toolbar acting on the sheet, autosave's
 * wiring and the page's one live region. Against real routing and a song library of its own in real IndexedDB; time
 * for autosave is moved by hand.
 */
describe('SongEditorComponent', () => {
  let harness: RouterTestingHarness;
  let library: SongLibraryService;
  let clock: FakeClock;
  let dbName: string;

  beforeEach(async () => {
    dbName = `song-editor-spec-${Math.random().toString(36).slice(2)}`;
    clock = new FakeClock();
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'songs/:id', component: SongEditorComponent },
          { path: 'songs', component: LibraryStandIn }
        ]),
        { provide: SONG_LIBRARY_DB, useValue: dbName },
        { provide: SONG_AUTOSAVE_CLOCK, useValue: clock },
        // Preferences for this visit only: nothing a spec chooses is left in the browser's storage.
        { provide: SONG_PREFERENCES_STORAGE, useValue: null }
      ]
    }).compileComponents();
    library = TestBed.inject(SongLibraryService);
    harness = await RouterTestingHarness.create();
  });

  afterEach(async () => {
    harness.fixture.destroy();
    // Let a write the page's destroy started land before the database goes.
    await new Promise(resolve => setTimeout(resolve, 50));
    await deletedDatabase(dbName);
  });

  const host = (): HTMLElement => harness.fixture.nativeElement;
  const text = (selector: string): string => host().querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const status = (): string => text('.save-status');
  const messages = (): string => text('.editor-messages');
  const names = (): string[] =>
    Array.from(host().querySelectorAll('.song-chord-name')).map(name => name.textContent ?? '');

  function element<T extends HTMLElement>(selector: string): T {
    const found = host().querySelector<T>(selector);
    if (!found) throw new Error(`No ${selector} on the page`);
    return found;
  }

  /** Resolves once `done` holds, checking every few milliseconds for up to two seconds: IndexedDB answers outside the zone. */
  async function until(done: () => boolean): Promise<void> {
    for (let waited = 0; waited < 2000; waited += 10) {
      harness.detectChanges();
      if (done()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    harness.detectChanges();
  }

  /** Stores "Last Dance" and returns its record. */
  async function storeSong(): Promise<SongDoc> {
    const created = await library.createSong();
    return library.saveSong({ ...created, content: lastDance().toJSON() });
  }

  /** Opens the song `id` and waits for its sheet. */
  async function open(id: string): Promise<SongEditorComponent> {
    const editor = await harness.navigateByUrl(`/songs/${id}`, SongEditorComponent);
    await until(() => host().querySelector('.ProseMirror') !== null);
    return editor;
  }

  /** The song as the library now holds it. */
  async function stored(id: string): Promise<Node> {
    const loaded = await library.loadSong(id);
    if (loaded?.kind !== 'song') throw new Error('The song did not load');
    return loaded.node;
  }

  function setTitle(title: string): void {
    const input = element<HTMLInputElement>('.song-title');
    input.value = title;
    input.dispatchEvent(new Event('change'));
    harness.detectChanges();
  }

  function choose(selector: string, value: string): void {
    const select = element<HTMLSelectElement>(selector);
    select.value = value;
    select.dispatchEvent(new Event('change'));
    harness.detectChanges();
  }

  function press(selector: string): void {
    element<HTMLButtonElement>(selector).click();
    harness.detectChanges();
  }

  describe('loading', () => {
    it('opens a song: its title, artist, chords and when it was saved', async () => {
      const song = await storeSong();
      await open(song.id);

      expect(element<HTMLInputElement>('.song-title').value).toBe('Last Dance');
      expect(element<HTMLInputElement>('.song-artist').value).toBe('The Band');
      expect(names()).toEqual(['C', 'Am']);
      expect(status()).toBe('Saved · just now');
      expect(element<HTMLAnchorElement>('.back-to-library').getAttribute('href')).toBe('/songs');
    });

    it('says a song that is not there is no longer in the library, with the way back', async () => {
      await library.refresh();
      await harness.navigateByUrl('/songs/no-such-song', SongEditorComponent);
      await until(() => text('.song-missing') !== '');

      expect(text('.song-missing')).toContain('That song is no longer in the library');
      expect(host().querySelector('.song-missing a')?.getAttribute('href')).toBe('/songs');
      expect(host().querySelector('.ProseMirror')).toBeNull();
    });

    it('shows why a song cannot be opened, and never an editable sheet', async () => {
      await library.refresh();
      await putRaw({ id: 'broken', revision: 1, createdAt: 1, updatedAt: 1, content: { type: 'doc', content: [] } });
      await harness.navigateByUrl('/songs/broken', SongEditorComponent);
      await until(() => text('.song-unreadable') !== '');

      expect(text('.song-unreadable')).toContain('This song cannot be opened:');
      expect(host().querySelector('.song-unreadable a')?.getAttribute('href')).toBe('/songs');
      expect(host().querySelector('.ProseMirror')).toBeNull();
      expect(host().querySelector('.song-title')).toBeNull();
    });
  });

  describe('the header', () => {
    it('puts a title edit in the undo history', async () => {
      const song = await storeSong();
      await open(song.id);

      setTitle('First Dance');
      expect(status()).toBe('Unsaved changes');
      expect(element<HTMLButtonElement>('.undo').getAttribute('aria-disabled')).toBe('false');

      press('.undo');
      expect(element<HTMLInputElement>('.song-title').value).toBe('Last Dance');
      press('.redo');
      expect(element<HTMLInputElement>('.song-title').value).toBe('First Dance');
    });

    it('edits the artist through the same history', async () => {
      const song = await storeSong();
      await open(song.id);

      const input = element<HTMLInputElement>('.song-artist');
      input.value = 'Someone Else';
      input.dispatchEvent(new Event('change'));
      harness.detectChanges();
      press('.undo');
      expect(element<HTMLInputElement>('.song-artist').value).toBe('The Band');
    });

    it('says how the save is going, from unsaved to saving to saved', async () => {
      const song = await storeSong();
      await open(song.id);
      const write = new Deferred<SongDoc>();
      const save = spyOn(library, 'saveSong').and.returnValue(write.promise);

      setTitle('First Dance');
      expect(status()).toBe('Unsaved changes');

      clock.tick(800);
      harness.detectChanges();
      expect(status()).toBe('Saving…');
      expect(save).toHaveBeenCalledTimes(1);
      expect(songMetaOf(Node.fromJSON(songSchema, save.calls.mostRecent().args[0].content)).title).toBe('First Dance');

      write.resolve({ ...song, revision: song.revision + 1, updatedAt: clock.now() });
      await until(() => status() === 'Saved · just now');
      expect(status()).toBe('Saved · just now');

      // Re-worded once a minute, counted from when the page opened, so six minutes on it has said "5 minutes ago".
      clock.tick(6 * 60_000);
      harness.detectChanges();
      expect(status()).toBe('Saved · 5 minutes ago');
    });

    it('carries each save’s record into the next, so the second save is not refused', async () => {
      const song = await storeSong();
      await open(song.id);

      setTitle('First Dance');
      clock.tick(800);
      await until(() => status() === 'Saved · just now');
      setTitle('Second Dance');
      clock.tick(800);
      await until(() => status() === 'Saved · just now');

      expect(songMetaOf(await stored(song.id)).title).toBe('Second Dance');
    });

    it('shows a failed save with its reason, and Retry saves again', async () => {
      const song = await storeSong();
      await open(song.id);
      const realSave = library.saveSong.bind(library);
      let calls = 0;
      spyOn(library, 'saveSong').and.callFake(doc => {
        calls++;
        return calls === 1 ? Promise.reject(new Error('The disk is full')) : realSave(doc);
      });

      setTitle('First Dance');
      clock.tick(800);
      await until(() => status().startsWith('Not saved'));
      expect(text('.save-status span')).toBe('Not saved: The disk is full');
      expect(host().querySelector('.retry-save')).not.toBeNull();
      expect(messages()).toBe('Not saved: The disk is full');

      press('.retry-save');
      await until(() => status() === 'Saved · just now');
      expect(status()).toBe('Saved · just now');
      expect(songMetaOf(await stored(song.id)).title).toBe('First Dance');
    });
  });

  describe('the toolbar', () => {
    it('re-spells the chords on the sheet when the key changes or the song is transposed', async () => {
      const song = await storeSong();
      await open(song.id);

      choose('.key-tonic', '7');
      expect(names()).toEqual(['G', 'Em']);

      press('.transpose-up');
      expect(names()).toEqual(['Ab', 'Fm']);
      expect(element<HTMLSelectElement>('.key-tonic').value).toBe('8b');

      choose('.key-scale', 'dorian');
      expect(songMetaOf(await saveNow(song.id)).key.scaleId).toBe('dorian');
    });

    it('offers only scales that can build chords', async () => {
      const song = await storeSong();
      await open(song.id);
      const offered = Array.from(element<HTMLSelectElement>('.key-scale').options).map(option => option.value);
      expect(offered).toContain('ionian');
      expect(offered).toContain('harmonicMinor');
      expect(offered).not.toContain('majorPentatonic');
      expect(offered).not.toContain('minorBlues');
      // A note filter for the fretboard, not a key, though its seven notes would stack.
      expect(offered).not.toContain('naturalNotes');
    });

    it('shows numerals in place of names, and says so on its button', async () => {
      const song = await storeSong();
      await open(song.id);

      press('.numerals-toggle');
      expect(names()).toEqual(['I', 'vi']);
      expect(element('.numerals-toggle').getAttribute('aria-pressed')).toBe('true');
      press('.numerals-toggle');
      expect(names()).toEqual(['C', 'Am']);
    });

    it('steps the lyric size through three sizes', async () => {
      const song = await storeSong();
      await open(song.id);
      const size = (): string | null => element('.song-sheet').getAttribute('data-lyric-size');

      expect(size()).toBe('medium');
      press('.lyric-size');
      expect(size()).toBe('large');
      press('.lyric-size');
      expect(size()).toBe('small');
      press('.lyric-size');
      expect(size()).toBe('medium');
    });

    it('holds the tempo to the range the song can play, and says so', async () => {
      const song = await storeSong();
      await open(song.id);

      const input = element<HTMLInputElement>('.song-tempo');
      input.value = '999';
      input.dispatchEvent(new Event('change'));
      harness.detectChanges();

      expect(input.value).toBe('300');
      expect(messages()).toContain('300');
      expect(songMetaOf(await saveNow(song.id)).tempo).toBe(300);
    });

    it('sets the time signature from its two numbers', async () => {
      const song = await storeSong();
      await open(song.id);

      choose('.meter-numerator', '6');
      choose('.meter-denominator', '8');
      expect(songMetaOf(await saveNow(song.id)).timeSignature).toEqual({ numerator: 6, denominator: 8, isCommon: false });
    });

    it('adds a section of the kind chosen after the one with the caret', async () => {
      const song = await storeSong();
      await open(song.id);

      press('.add-section-toggle');
      press('.add-section [data-kind="verse"]');
      press('.add-section-toggle');
      press('.add-section [data-kind="chorus"]');
      // Ready for the new section's first words.
      expect(document.activeElement).toBe(element('.ProseMirror'));
      expect(sectionsOf(await saveNow(song.id)).map(section => section.label)).toEqual(['Verse 1', 'Verse 2', 'Chorus']);
    });
  });

  describe('saving', () => {
    it('saves what is pending when the page is left', async () => {
      const song = await storeSong();
      await open(song.id);

      setTitle('Left Behind');
      await harness.navigateByUrl('/songs');
      expect(host().querySelector('.library-stand-in')).not.toBeNull();

      // Nothing waited out the autosave delay: only the page's destroy can have saved it.
      let title = '';
      for (let waited = 0; waited < 2000 && title !== 'Left Behind'; waited += 10) {
        title = songMetaOf(await stored(song.id)).title;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(title).toBe('Left Behind');
    });

    it('saves at once when the page is hidden', async () => {
      const song = await storeSong();
      await open(song.id);
      const save = spyOn(library, 'saveSong').and.callThrough();

      setTitle('Hidden');
      spyOnProperty(Document.prototype, 'visibilityState', 'get').and.returnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('saves at once on pagehide', async () => {
      const song = await storeSong();
      await open(song.id);
      const save = spyOn(library, 'saveSong').and.callThrough();

      setTitle('Gone');
      window.dispatchEvent(new Event('pagehide'));
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('asks before the tab closes only while something is unsaved', async () => {
      const song = await storeSong();
      const editor = await open(song.id);
      // Handed to the listener rather than dispatched on `window`, where Karma takes any `beforeunload` for a reload.
      const unload = (): Event => {
        const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
        editor.onBeforeUnload(event);
        return event;
      };

      expect(unload().defaultPrevented).toBeFalse();
      setTitle('Not yet');
      expect(unload().defaultPrevented).toBeTrue();
    });
  });

  describe('chords on the sheet', () => {
    const sheet = (): SongSheetComponent => {
      const found = harness.fixture.debugElement.query(By.directive(SongSheetComponent));
      if (!found) throw new Error('No sheet on the page');
      return found.componentInstance;
    };
    const editorState = (): EditorState => {
      const state = sheet().editorState();
      if (!state) throw new Error('No editor');
      return state;
    };
    const editor = (): HTMLElement => element('.ProseMirror');
    const field = (): HTMLInputElement | null => host().querySelector<HTMLInputElement>('.chord-field-anchor input');
    /** Lets ProseMirror's DOM observer read a change the browser made, which it does on a mutation callback. */
    const settled = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 20));

    /** Puts the caret at `pos` in the lyrics and presses `[` there, as the browser types it. */
    async function bracketAt(pos: number): Promise<void> {
      sheet().focus();
      const state = editorState();
      sheet().run(() => ({ kind: 'edit', tr: state.tr.setSelection(TextSelection.create(state.doc, pos)) }));
      document.execCommand('insertText', false, '[');
      await settled();
      harness.detectChanges();
    }

    function typeInField(text: string): void {
      const input = field();
      if (!input) throw new Error('No chord field');
      input.value = text;
      input.dispatchEvent(new InputEvent('input', { data: text.slice(-1), inputType: 'insertText' }));
      harness.detectChanges();
    }

    function keyIn(target: HTMLElement, key: string, modifiers: { altKey?: boolean } = {}): void {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }));
      harness.detectChanges();
    }

    // "Last Dance": the section opens at 0, its line at 1, C at 2, "Got me " from 3, Am at 10, "thinking" from 11.

    it('opens the chord field at the caret on [, with its hint, and places the chord on Enter as one undo step', async () => {
      const song = await storeSong();
      await open(song.id);
      await bracketAt(7);

      const input = field();
      expect(input).not.toBeNull();
      expect(document.activeElement).toBe(input);
      expect(input?.getAttribute('aria-label')).toBe('Chord name or numeral');
      expect(editorState().doc.textContent).toBe('Got me thinking');

      typeInField('F');
      expect(text('.chord-field-anchor .chord-field-hint')).toBe('F · IV');
      keyIn(field() ?? editor(), 'Enter');

      expect(field()).toBeNull();
      expect(names()).toEqual(['C', 'F', 'Am']);
      expect(document.activeElement).toBe(editor());
      expect(editorState().selection.from).toBe(8);

      sheet().undo();
      harness.detectChanges();
      expect(names()).toEqual(['C', 'Am']);
    });

    it('opens a fresh field for a chord typed straight after one is placed, before the page draws again', async () => {
      const song = await storeSong();
      await open(song.id);
      await bracketAt(7);
      typeInField('F');

      // Enter, and the next `[` at once: no change detection of the spec's own in between, as fast typing allows none.
      field()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await bracketAt(14);

      expect(field()?.value).toBe('');
      expect(document.activeElement).toBe(field());
      typeInField('G]');
      expect(names()).toEqual(['C', 'F', 'Am', 'G']);
    });

    it('places a chord typed the ChordPro way, [F] in the middle of a line', async () => {
      const song = await storeSong();
      await open(song.id);
      await bracketAt(7);

      typeInField('F]');

      expect(field()).toBeNull();
      expect(names()).toEqual(['C', 'F', 'Am']);
      expect(document.activeElement).toBe(editor());
    });

    it('keeps the field open on a chord it cannot read, and places nothing', async () => {
      const song = await storeSong();
      await open(song.id);
      await bracketAt(7);

      typeInField('Hm');
      keyIn(field() ?? editor(), 'Enter');

      expect(field()).not.toBeNull();
      expect(text('.chord-field-anchor .chord-field-hint')).toMatch(/"Hm" is not a note/);
      expect(names()).toEqual(['C', 'Am']);
    });

    it('closes the field on Escape, placing nothing, with the focus back in the lyrics at the caret', async () => {
      const song = await storeSong();
      await open(song.id);
      await bracketAt(7);

      typeInField('F');
      keyIn(field() ?? editor(), 'Escape');

      expect(field()).toBeNull();
      expect(names()).toEqual(['C', 'Am']);
      expect(document.activeElement).toBe(editor());
      expect(editorState().selection.from).toBe(7);
    });

    it('closes the field, placing nothing, when the focus leaves it', async () => {
      const song = await storeSong();
      await open(song.id);
      await bracketAt(7);

      element<HTMLInputElement>('.song-title').focus();
      harness.detectChanges();

      expect(field()).toBeNull();
      expect(names()).toEqual(['C', 'Am']);
      expect(document.activeElement).toBe(element('.song-title'));
    });

    it('opens the chord popover on a click on a name, and on Enter with the chord selected', async () => {
      const song = await storeSong();
      await open(song.id);

      (host().querySelectorAll<HTMLElement>('.song-chord-name')[1]).click();
      harness.detectChanges();
      expect(host().querySelector('.chord-popover-anchor [role="dialog"]')).not.toBeNull();
      expect(element<HTMLInputElement>('.chord-popover-anchor input').value).toBe('Am');

      keyIn(element('.chord-popover-anchor input'), 'Escape');
      expect(host().querySelector('.chord-popover-anchor')).toBeNull();
      expect(document.activeElement).toBe(editor());
      const selection = editorState().selection;
      expect(selection instanceof NodeSelection && selection.from).toBe(10);

      keyIn(editor(), 'Enter');
      expect(host().querySelector('.chord-popover-anchor [role="dialog"]')).not.toBeNull();
    });

    it('changes the chord and its length from the popover, and deletes it', async () => {
      const song = await storeSong();
      await open(song.id);
      (host().querySelectorAll<HTMLElement>('.song-chord-name')[1]).click();
      harness.detectChanges();

      const input = element<HTMLInputElement>('.chord-popover-anchor input');
      input.value = 'Dm';
      input.dispatchEvent(new InputEvent('input', { data: 'm', inputType: 'insertText' }));
      keyIn(input, 'Enter');
      expect(names()).toEqual(['C', 'Dm']);

      press('.chord-popover-anchor .length-longer');
      const chords = sectionsOf(editorState().doc).flatMap(entry => chordsOf(entry.node, entry.pos));
      expect(chords.map(entry => entry.attrs.lengthBeats)).toEqual([4, 5]);

      press('.chord-popover-anchor .delete-chord');
      expect(names()).toEqual(['C']);
      expect(host().querySelector('.chord-popover-anchor')).toBeNull();
      expect(document.activeElement).toBe(editor());
    });

    it('says why Alt+arrow could not move a chord, in the live region', async () => {
      const song = await storeSong();
      await open(song.id);
      host().querySelectorAll<HTMLElement>('.song-chord-name')[0].click();
      harness.detectChanges();
      keyIn(element('.chord-popover-anchor input'), 'Escape');

      keyIn(editor(), 'ArrowLeft', { altKey: true });

      expect(messages()).toBe('The chord is already at the start of its line.');
    });
  });

  it('puts a refused command’s reason in the page’s live region', async () => {
    const song = await storeSong();
    await open(song.id);

    press('.song-section-menu-toggle');
    const remove = Array.from(host().querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
      item => item.textContent?.trim() === 'Delete'
    );
    remove?.click();
    harness.detectChanges();

    expect(messages()).toBe('A song keeps at least one section.');
    expect(host().querySelectorAll('.editor-messages [role="status"]').length).toBe(2);
  });

  /** Saves what is pending now, by the page's own route (pagehide), and returns the song as stored after. */
  async function saveNow(id: string): Promise<Node> {
    window.dispatchEvent(new Event('pagehide'));
    await until(() => status().startsWith('Saved'));
    return stored(id);
  }

  /** Writes `record` straight into the store, past the service: how a corrupt record gets there. */
  async function putRaw(record: unknown): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('songs', 'readwrite');
        transaction.objectStore('songs').put(record);
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };
      };
    });
  }
});
