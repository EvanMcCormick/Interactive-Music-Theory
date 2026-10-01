import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';

import { GpLibraryComponent } from './gp-library.component';
import { GP_LIBRARY_DB, GpLibraryService } from '../../services/gp-library.service';

/**
 * The gallery of `.gp` files, which stays when the viewer goes (the GP-composer design, decision 1): its Open goes to the
 * composer, and what it lists, filters, sorts and takes from a drop. Against a library of its own in real IndexedDB.
 */
describe('GpLibraryComponent', () => {
  let fixture: ComponentFixture<GpLibraryComponent>;
  let component: GpLibraryComponent;
  let library: GpLibraryService;
  let dbName: string;

  beforeEach(async () => {
    dbName = `gp-gallery-spec-${Math.random().toString(36).slice(2)}`;
    await TestBed.configureTestingModule({
      imports: [GpLibraryComponent],
      providers: [provideRouter([]), { provide: GP_LIBRARY_DB, useValue: dbName }]
    }).compileComponents();
    library = TestBed.inject(GpLibraryService);
    fixture = TestBed.createComponent(GpLibraryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(async () => {
    fixture.destroy();
    await library.getEntry('none');
    await new Promise<void>(resolve => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  });

  const bytes = (): ArrayBuffer => new Uint8Array([1]).buffer;

  it("opens a file in the composer, as the file, by its id: /composer?gp=<id>", async () => {
    const entry = await library.addBytes(bytes(), 'riff.gp', {});
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);

    component.openFile(entry);

    expect(navigate).toHaveBeenCalledWith(['/composer'], { queryParams: { gp: entry.id } });
  });

  it('lists its files without their bytes, and opens and deletes one from the list', async () => {
    await library.addBytes(bytes(), 'riff.gp', { title: 'Riff' });
    await firstValueFrom(library.getEntries().pipe(filter(list => list.length === 1)));
    const [listed] = component.filteredEntries;
    expect('fileData' in listed).toBeFalse();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    spyOn(window, 'confirm').and.returnValue(true);

    component.openFile(listed);
    expect(navigate).toHaveBeenCalledWith(['/composer'], { queryParams: { gp: listed.id } });

    await component.deleteFile(listed);
    expect(await library.getEntry(listed.id)).toBeNull();
    expect(component.filteredEntries).toEqual([]);
  });

  it('takes the Guitar Pro files of a drop and leaves the rest', async () => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([1])], 'one.gp5'));
    transfer.items.add(new File(['text'], 'notes.txt'));

    await component.onDrop(new DragEvent('drop', { dataTransfer: transfer }));

    const entries = await firstValueFrom(library.getEntries().pipe(filter(list => list.length > 0)));
    expect(entries.map(entry => entry.fileName)).toEqual(['one.gp5']);
  });

  it('lists what the search matches', async () => {
    await library.addBytes(bytes(), 'a.gp', { title: 'Blues in A' });
    await library.addBytes(bytes(), 'b.gp', { title: 'Reel' });
    await firstValueFrom(library.getEntries().pipe(filter(list => list.length === 2)));

    component.onFilterChange({ searchText: 'blues' });

    expect(component.filteredEntries.map(entry => entry.title)).toEqual(['Blues in A']);
  });

  it('sorts a new field in its natural direction, and flips the direction when the same field is chosen again', async () => {
    await library.addBytes(bytes(), 'a.gp', { title: 'Beta' });
    await library.addBytes(bytes(), 'b.gp', { title: 'Alpha' });
    await firstValueFrom(library.getEntries().pipe(filter(list => list.length === 2)));

    component.onSortChange('title');
    expect(component.filteredEntries.map(entry => entry.title)).toEqual(['Alpha', 'Beta']);

    component.onSortChange('title');
    expect(component.filteredEntries.map(entry => entry.title)).toEqual(['Beta', 'Alpha']);
  });

  it('toggles between the grid and the list', () => {
    expect(component.viewMode).toBe('grid');
    component.toggleViewMode();
    expect(component.viewMode).toBe('list');
  });
});
