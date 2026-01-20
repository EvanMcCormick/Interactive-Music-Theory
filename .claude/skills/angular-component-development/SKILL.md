---
name: angular-component-development
description: Use when creating or modifying Angular components in MusicTheory - ensures standalone component pattern, proper RxJS subscription management, and integration with MusicTheoryService
---

# Angular Component Development

## Overview

All components in MusicTheory use Angular 19's standalone component pattern. This skill ensures consistency with existing architecture and proper integration.

**Core principle:** Standalone components, centralized state in MusicTheoryService, proper cleanup.

## When to Use

- Creating a new component
- Modifying existing component structure
- Adding new features to components
- Fixing component-related bugs
- Refactoring component architecture

## Standalone Component Template

```typescript
import { Component, OnInit, OnDestroy, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { MusicTheoryService } from '../../services/music-theory.service';
import { MusicTheoryState } from '../../models/music-theory.model';

@Component({
  selector: 'app-my-component',
  standalone: true,
  imports: [CommonModule],  // Add other imports as needed
  templateUrl: './my-component.component.html',
  styleUrls: ['./my-component.component.scss']
})
export class MyComponent implements OnInit, OnDestroy {
  // Inputs from parent
  @Input() someInput: string = '';

  // Outputs to parent
  @Output() someEvent = new EventEmitter<void>();

  // Destroy subject for cleanup
  private destroy$ = new Subject<void>();

  // State from service
  state: MusicTheoryState | null = null;

  constructor(private musicTheoryService: MusicTheoryService) {}

  ngOnInit(): void {
    // Subscribe to service state
    this.musicTheoryService.getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.state = state;
        this.onStateChange(state);
      });
  }

  ngOnDestroy(): void {
    // CRITICAL: Always clean up subscriptions
    this.destroy$.next();
    this.destroy$.complete();
  }

  private onStateChange(state: MusicTheoryState): void {
    // React to state changes
  }
}
```

## File Structure

```
components/
  my-component/
    my-component.component.ts      # Component class
    my-component.component.html    # Template
    my-component.component.scss    # Styles (component-scoped)
    my-component.component.spec.ts # Tests (optional but recommended)
```

## State Management Pattern

### Reading State
```typescript
// Get current state value (one-time)
const currentState = this.musicTheoryService.getState().value;

// Subscribe to state changes (reactive)
this.musicTheoryService.getState()
  .pipe(takeUntil(this.destroy$))
  .subscribe(state => {
    // React to changes
  });
```

### Updating State
```typescript
// Use service methods - NEVER modify state directly
this.musicTheoryService.setSelectedKey(newKey);
this.musicTheoryService.setSelectedCategory(categoryId);
this.musicTheoryService.setInstrument(instrumentId);
```

### State Interface
```typescript
interface MusicTheoryState {
  selectedKey: string;        // Current root note (C, C#, D, etc.)
  selectedCategoryId: string; // Scale/chord category
  selectedItemId: string;     // Specific scale or chord
  instrumentId: string;       // guitar, bass, piano
  tuningName: string;         // Current tuning
  stringCount: number;        // For stringed instruments
  showNashvilleNumbers: boolean;
}
```

## Template Patterns

### Conditional Rendering
```html
<!-- Use *ngIf for conditional blocks -->
<div *ngIf="state?.instrumentId === 'piano'" class="keyboard-container">
  <app-keyboard></app-keyboard>
</div>

<!-- Use @if for new control flow (Angular 17+) -->
@if (state?.instrumentId === 'piano') {
  <app-keyboard></app-keyboard>
}
```

### List Rendering with trackBy
```html
<!-- Always use trackBy for performance -->
<div *ngFor="let note of notes; trackBy: trackByIndex" class="note">
  {{ note.name }}
</div>

<!-- In component -->
trackByIndex(index: number): number {
  return index;
}

<!-- Or track by unique property -->
trackByNoteId(index: number, note: FretNote): string {
  return `${note.fret}-${note.noteValue}`;
}
```

### Event Binding
```html
<!-- Click events -->
<button (click)="onNoteClick(note)">{{ note.name }}</button>

<!-- Prevent default -->
<a (click)="handleClick($event)">Link</a>

<!-- In component -->
handleClick(event: Event): void {
  event.preventDefault();
  // Handle click
}
```

## Styling Patterns

### Component-Scoped SCSS
```scss
// my-component.component.scss
:host {
  display: block;  // Set host display
}

.container {
  // Scoped to this component only
}

// Use CSS variables for theming
.theme-element {
  background-color: var(--nav-bg-color, #2c3e50);
  color: var(--text-color, white);
}
```

### Existing Color Scheme
```scss
// Dark navigation
$nav-bg-primary: #2c3e50;
$nav-bg-hover: #34495e;

// Note highlighting
$root-note-color: #e74c3c;      // Red for root
$in-mode-note-color: #3498db;  // Blue for scale tones
$out-of-mode-color: #95a5a6;   // Gray for chromatic
```

## Integration with Audio

### Component with Audio Playback
```typescript
import * as Tone from 'tone';

export class AudioComponent implements OnDestroy {
  private synth: Tone.PolySynth | null = null;

  async initAudio(): Promise<void> {
    await Tone.start();
    this.synth = new Tone.PolySynth(Tone.Synth).toDestination();
  }

  playNote(note: string): void {
    this.synth?.triggerAttackRelease(note, '8n');
  }

  ngOnDestroy(): void {
    // CRITICAL: Dispose audio resources
    this.synth?.dispose();
    this.synth = null;
  }
}
```

## Common Patterns

### Loading State
```typescript
export class DataComponent implements OnInit {
  isLoading = true;
  data: any[] = [];

  ngOnInit(): void {
    this.loadData();
  }

  private async loadData(): Promise<void> {
    this.isLoading = true;
    try {
      this.data = await this.service.getData();
    } finally {
      this.isLoading = false;
    }
  }
}
```

### Form Handling
```typescript
import { FormsModule } from '@angular/forms';

@Component({
  // ...
  imports: [CommonModule, FormsModule]
})
export class FormComponent {
  selectedValue = '';

  onSelectionChange(value: string): void {
    this.selectedValue = value;
    this.musicTheoryService.setSelectedKey(value);
  }
}
```

```html
<select [(ngModel)]="selectedValue" (ngModelChange)="onSelectionChange($event)">
  <option *ngFor="let option of options" [value]="option.id">
    {{ option.name }}
  </option>
</select>
```

## Anti-Patterns

| Anti-Pattern | Problem | Correct Approach |
|--------------|---------|------------------|
| NgModule components | Inconsistent with codebase | Use standalone: true |
| Direct state mutation | Bypasses change detection | Use service methods |
| Missing takeUntil | Memory leaks | Always use destroy$ pattern |
| Computations in template | Performance issues | Use methods or pipes |
| Missing trackBy | Poor list performance | Always provide trackBy |
| Audio without disposal | Memory/resource leak | Dispose in ngOnDestroy |

## Checklist

When creating/modifying a component:

- [ ] Uses `standalone: true`
- [ ] Imports are in component decorator (not module)
- [ ] Has `OnDestroy` implementation
- [ ] Uses `takeUntil(this.destroy$)` for subscriptions
- [ ] Cleans up subscriptions in ngOnDestroy
- [ ] Disposes audio resources if applicable
- [ ] Uses MusicTheoryService for state (not local state)
- [ ] Uses trackBy for *ngFor loops
- [ ] Template avoids complex computations
- [ ] SCSS is component-scoped
- [ ] Follows existing naming conventions

## Lazy-Loaded Routes

For larger components (like GP viewer), use lazy loading to reduce initial bundle size:

```typescript
// app-routing.module.ts
const routes: Routes = [
  { path: 'fretboard', component: FretboardComponent },  // Eager load core feature
  {
    path: 'gp-viewer',
    loadComponent: () => import('./components/gp-viewer/gp-viewer.component')
      .then(m => m.GpViewerComponent)  // Lazy load
  },
  {
    path: 'gp-library',
    loadComponent: () => import('./components/gp-library/gp-library.component')
      .then(m => m.GpLibraryComponent)
  }
];
```

## Query Parameters with ActivatedRoute

For deep linking (e.g., opening a file from library):

```typescript
import { ActivatedRoute } from '@angular/router';

export class MyComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    // Subscribe to query params
    this.route.queryParams
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        if (params['id']) {
          this.loadItem(params['id']);
        }
      });
  }
}
```

Navigate with query params:
```typescript
this.router.navigate(['/gp-viewer'], {
  queryParams: { id: entry.id }
});
```

## IndexedDB Service Integration

For client-side storage (like GP Library):

```typescript
@Injectable({ providedIn: 'root' })
export class MyStorageService {
  private db: IDBDatabase | null = null;
  private entriesSubject = new BehaviorSubject<MyEntry[]>([]);

  constructor(private ngZone: NgZone) {
    this.initDatabase();
  }

  getEntries(): Observable<MyEntry[]> {
    return this.entriesSubject.asObservable();
  }

  private initDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('my-db', 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('items')) {
          const store = db.createObjectStore('items', { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: false });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.loadAllEntries();
        resolve();
      };
    });
  }

  // IMPORTANT: Wrap callbacks with NgZone.run() for change detection
  private loadAllEntries(): void {
    const request = this.db!.transaction('items', 'readonly')
      .objectStore('items').getAll();

    request.onsuccess = () => {
      this.ngZone.run(() => {
        this.entriesSubject.next(request.result || []);
      });
    };
  }
}
```

## Generating Components

Use Angular CLI:

```bash
# Generate standalone component
ng generate component components/my-component --standalone

# This creates:
# - my-component.component.ts
# - my-component.component.html
# - my-component.component.scss
# - my-component.component.spec.ts
```
