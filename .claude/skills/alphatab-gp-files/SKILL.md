---
name: alphatab-gp-files
description: Use when working with Guitar Pro file viewing, alphaTab integration, or the GP Library - covers service patterns, file handling, scale highlighting, and IndexedDB storage
---

# alphaTab and Guitar Pro File Handling

## Overview

The app uses alphaTab library to render and play Guitar Pro files (.gp, .gp3-.gp5, .gpx). This skill covers the service architecture, file handling patterns, and integration with scale/chord highlighting.

**Core principle:** alphaTab manages its own rendering and audio - wrap it in a service with BehaviorSubject state management.

## When to Use

- Modifying GP viewer functionality
- Adding features to GP library
- Integrating scale/chord highlighting with sheet music
- Handling file upload/storage
- Debugging alphaTab rendering issues

## Architecture

### Files Structure
```
components/
  gp-viewer/
    gp-viewer.component.ts         # Main viewer container
    gp-viewer.component.html
    gp-viewer.component.scss
    components/
      gp-scale-highlighter/        # Scale/chord highlight controls
  gp-library/
    gp-library.component.ts        # Library browser
    components/
      gp-file-card/                # File card display
      gp-library-filters/          # Search/filter controls

services/
  alpha-tab.service.ts             # alphaTab API wrapper
  gp-library.service.ts            # IndexedDB storage

models/
  alpha-tab.model.ts               # Interfaces
```

### Service Layer

```typescript
// alpha-tab.service.ts - Key patterns
@Injectable({ providedIn: 'root' })
export class AlphaTabService {
  private api: any = null;  // alphaTab.AlphaTabApi
  private stateSubject = new BehaviorSubject<AlphaTabState>(DEFAULT_STATE);

  constructor(private ngZone: NgZone) {}

  getState(): Observable<AlphaTabState> {
    return this.stateSubject.asObservable();
  }

  initializeApi(element: HTMLElement, settings: AlphaTabSettings): void {
    // Import alphaTab dynamically (it's large)
    import('@coderline/alphatab').then(alphaTab => {
      this.api = new alphaTab.AlphaTabApi(element, settings);

      // Wrap event handlers with NgZone for change detection
      this.api.scoreLoaded.on((score: any) => {
        this.ngZone.run(() => {
          this.updateState({ isLoaded: true, score });
        });
      });

      this.api.playerPositionChanged.on((args: any) => {
        this.ngZone.run(() => {
          this.updateState({
            timePosition: args.currentTime,
            tickPosition: args.currentTick
          });
        });
      });
    });
  }

  dispose(): void {
    this.api?.destroy();
    this.api = null;
    this.stateSubject.next(DEFAULT_STATE);
  }
}
```

## Build Configuration

alphaTab requires custom webpack for WebWorkers and AudioWorklets, plus asset configuration for fonts and soundfonts.

### Webpack Plugin

```javascript
// custom-webpack.config.js
const { AlphaTabWebPackPlugin } = require('@coderline/alphatab-webpack');

module.exports = {
  plugins: [
    new AlphaTabWebPackPlugin()  // Copies fonts and soundfont during build
  ]
};
```

### Angular.json Configuration

**IMPORTANT:** The webpack plugin only copies assets during full builds. For `ng serve` (dev server), you must also configure assets in angular.json:

```json
// angular.json
{
  "architect": {
    "build": {
      "builder": "@angular-builders/custom-webpack:browser",
      "options": {
        "assets": [
          "src/favicon.ico",
          "src/assets",
          {
            "glob": "**/*",
            "input": "node_modules/@coderline/alphatab/dist/font",
            "output": "/font"
          },
          {
            "glob": "**/*",
            "input": "node_modules/@coderline/alphatab/dist/soundfont",
            "output": "/soundfont"
          }
        ],
        "customWebpackConfig": {
          "path": "./custom-webpack.config.js"
        }
      }
    },
    "serve": {
      "builder": "@angular-builders/custom-webpack:dev-server"
    }
  }
}
```

### Asset Paths in Code

When initializing alphaTab, use these paths:
```typescript
this.alphaTabService.initializeApi(element, {
  core: {
    fontDirectory: '/font/',  // Must match angular.json output
    useWorkers: true
  },
  player: {
    soundFont: '/soundfont/sonivox.sf2'  // Must match angular.json output
  }
});
```

## File Handling

### Loading Files

```typescript
async loadFile(file: File): Promise<void> {
  this.updateState({ loadingState: 'loading' });

  try {
    const arrayBuffer = await file.arrayBuffer();
    this.api.load(arrayBuffer);
  } catch (error) {
    this.updateState({
      loadingState: 'error',
      errorMessage: 'Failed to load file'
    });
  }
}
```

### Drag and Drop

```typescript
@HostListener('dragover', ['$event'])
onDragOver(event: DragEvent): void {
  event.preventDefault();
  event.stopPropagation();
  this.isDragging = true;
}

@HostListener('drop', ['$event'])
onDrop(event: DragEvent): void {
  event.preventDefault();
  event.stopPropagation();
  this.isDragging = false;

  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    const file = files[0];
    if (this.isValidGpFile(file)) {
      this.loadFile(file);
    }
  }
}

private isValidGpFile(file: File): boolean {
  const validExtensions = ['.gp', '.gp3', '.gp4', '.gp5', '.gpx'];
  return validExtensions.some(ext =>
    file.name.toLowerCase().endsWith(ext)
  );
}
```

## GP Library (IndexedDB)

### Storage Schema

```typescript
interface GpLibraryEntry {
  id: string;              // Unique ID
  fileName: string;        // Original filename
  fileSize: number;        // Bytes
  fileData: ArrayBuffer;   // The actual file
  title: string;           // From score metadata
  artist?: string;
  album?: string;
  tempo?: number;
  trackCount?: number;
  key?: number;            // Detected key (0-11)
  detectedScales?: string[];
  detectedChords?: string[];
  dateAdded: Date;
}
```

### Service Pattern

```typescript
@Injectable({ providedIn: 'root' })
export class GpLibraryService {
  private db: IDBDatabase | null = null;
  private entriesSubject = new BehaviorSubject<GpLibraryEntry[]>([]);

  constructor(private ngZone: NgZone) {
    this.initDatabase();
  }

  async addFile(file: File, metadata: Partial<GpLibraryEntry>): Promise<GpLibraryEntry> {
    const reader = new FileReader();

    return new Promise((resolve, reject) => {
      reader.onload = () => {
        const entry: GpLibraryEntry = {
          id: this.generateId(),
          fileName: file.name,
          fileSize: file.size,
          fileData: reader.result as ArrayBuffer,
          title: metadata.title || file.name,
          dateAdded: new Date(),
          ...metadata
        };

        const transaction = this.db!.transaction('files', 'readwrite');
        const store = transaction.objectStore('files');
        const request = store.add(entry);

        request.onsuccess = () => {
          this.loadAllEntries();  // Refresh list
          resolve(entry);
        };
      };

      reader.readAsArrayBuffer(file);
    });
  }

  async getFileData(id: string): Promise<ArrayBuffer | null> {
    const entry = await this.getEntry(id);
    return entry?.fileData || null;
  }
}
```

## Scale/Chord Highlighting

### HighlightConfig Interface

```typescript
interface HighlightConfig {
  enabled: boolean;
  rootNote: number;      // 0-11 (C=0)
  intervals: number[];   // Semitones from root
  name: string;          // Display name
  type: 'scale' | 'chord';
}
```

### Applying Highlights

```typescript
onHighlightChange(config: HighlightConfig): void {
  this.highlightConfig = config;
  this.applyHighlighting();
}

private applyHighlighting(): void {
  const container = this.alphaTabContainer.nativeElement;

  // Remove existing highlights
  container.querySelectorAll('.scale-highlight').forEach((el: Element) => {
    el.classList.remove('scale-highlight');
  });

  if (!this.highlightConfig?.enabled) return;

  // Calculate notes to highlight (0-11)
  const highlightedNotes = this.highlightConfig.intervals.map(interval =>
    (this.highlightConfig!.rootNote + interval) % 12
  );

  // Find note elements and apply class
  container.querySelectorAll('.at-note').forEach((noteEl: Element) => {
    const noteValue = noteEl.getAttribute('data-note');
    if (noteValue !== null) {
      const noteNum = parseInt(noteValue, 10) % 12;
      if (highlightedNotes.includes(noteNum)) {
        noteEl.classList.add('scale-highlight');
      }
    }
  });
}
```

### Highlight Styles

```scss
// In component SCSS
.alphatab-container {
  ::ng-deep .at-note.scale-highlight {
    circle, ellipse {
      fill: rgba($accent-color, 0.3) !important;
      stroke: $accent-color !important;
      stroke-width: 2px !important;
    }
  }
}
```

## Playback Controls

### Basic Controls

```typescript
play(): void {
  this.api?.play();
}

pause(): void {
  this.api?.pause();
}

stop(): void {
  this.api?.stop();
}

setVolume(value: number): void {
  if (this.api) {
    this.api.masterVolume = value;  // 0-1
  }
}

setPlaybackSpeed(multiplier: number): void {
  if (this.api) {
    this.api.playbackSpeed = multiplier;  // 0.25 to 2.0
  }
}
```

### Track Controls

```typescript
setTrackMute(trackIndex: number, muted: boolean): void {
  const track = this.api?.score?.tracks[trackIndex];
  if (track) {
    this.api.changeTrackMute([track], muted);
  }
}

setTrackSolo(trackIndex: number, solo: boolean): void {
  const track = this.api?.score?.tracks[trackIndex];
  if (track) {
    this.api.changeTrackSolo([track], solo);
  }
}
```

## Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| No audio | User hasn't interacted | alphaTab auto-handles, but may need click |
| Missing fonts | Webpack plugin not configured | Add AlphaTabWebPackPlugin |
| No soundfont | Path incorrect | Check `/soundfont/sonivox.sf2` exists |
| Rendering blank | Container too small | Ensure container has dimensions |
| Memory leak | Not disposing | Call `api.destroy()` in ngOnDestroy |
| UI not updating | Events outside Angular zone | Use ChangeDetectorRef.detectChanges() |
| Assets missing in dev | Only webpack plugin configured | Add assets to angular.json |

## ChangeDetectorRef for UI Updates

alphaTab events fire outside Angular's zone. Even with NgZone.run() in the service, components may need manual change detection:

```typescript
import { ChangeDetectorRef } from '@angular/core';

export class GpViewerComponent implements OnInit {
  constructor(
    private alphaTabService: AlphaTabService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.alphaTabService.getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.state = state;
        // CRITICAL: Force change detection for alphaTab events
        this.cdr.detectChanges();
      });
  }
}
```

## Checklist

When modifying GP viewer/library:

- [ ] AlphaTabService wraps all API calls
- [ ] NgZone.run() used for all event handlers in service
- [ ] ChangeDetectorRef.detectChanges() used in component subscriptions
- [ ] Files validated before loading
- [ ] Dispose called in ngOnDestroy
- [ ] IndexedDB transactions properly handled
- [ ] Highlighting re-applied after score renders
- [ ] Loading/error states handled in UI
- [ ] File size considered for IndexedDB storage limits
- [ ] Assets configured in angular.json for dev server
- [ ] Custom webpack config includes AlphaTabWebPackPlugin
