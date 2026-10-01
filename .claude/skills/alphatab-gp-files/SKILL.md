---
name: alphatab-gp-files
description: Use when working with Guitar Pro file viewing, alphaTab integration, or the GP Library - covers service patterns, file handling, scale highlighting, and IndexedDB storage
---

# alphaTab and Guitar Pro File Handling

## Overview

The app uses alphaTab library to render and play Guitar Pro files (.gp, .gp3-.gp5, .gpx). This skill covers the service architecture, file handling patterns, and integration with scale/chord highlighting.

**Core principle:** alphaTab manages its own rendering and audio - wrap it in a service with BehaviorSubject state management.

## When to Use

- Modifying how the composer opens and plays a .gp file (its Original state; the GP Viewer is gone, and `/gp-viewer` redirects)
- Adding features to GP library
- Integrating scale/chord highlighting with sheet music
- Handling file upload/storage
- Debugging alphaTab rendering issues

## Architecture

### Files Structure
```
components/
  composer/
    composer.component.ts          # The page: transport, file drop, ?gp=<id>
    components/
      composer-score/              # Owns the alphaTab api: loads, renders, mixer
      composer-track-strip/        # Per-track show/hide, mute, solo
      composer-scale-panel/        # Scale/chord highlight controls
      composer-library-panel/      # Library drawer, Import .gp…
  gp-library/
    gp-library.component.ts        # Library browser (Open goes to /composer?gp=<id>)
    components/
      gp-file-card/                # File card display
      gp-library-filters/          # Search/filter controls

services/
  alpha-tab.service.ts             # alphaTab API wrapper
  gp-file-opener.service.ts        # GpFileOpener: every way a .gp comes into the composer
  gp-file-name.ts                  # GP_FILE_EXTENSIONS, GP_FILE_ACCEPT, isGpFileName (no alphaTab import)
  composer-gp.service.ts           # The file the page is showing (Original), or null
  composer-track-view.service.ts   # Hidden tracks, and the file's mutes and solos
  scale-highlight.ts               # Which drawn note heads a highlight marks
  gp-library.service.ts            # IndexedDB storage

gp-viewer-redirect.ts              # /gp-viewer?id= -> /composer?gp=, else /gp-library

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

A `.gp` comes into the composer through `GpFileOpener`, never straight into alphaTab. Each route - `?gp=<id>` from the gallery (`openEntry`), a Library drawer row (`openEntry`), Import .gp… (`importFile`), a drop on the page (`importDropped`) - parses the bytes first, asks about unsaved work (`confirmDiscard`), writes or corrects the `gp-library` entry, and then hands the file to `ComposerGpService.open`. One open runs at a time; what went wrong goes to the status line (`composer.announce`).

The score component then draws the file's bytes with `loadBytes`, or a composition with `renderScore`:

```typescript
// alpha-tab.service.ts
loadBytes(bytes: ArrayBuffer, trackIndices: readonly number[]): void {
  if (!this.api) {
    throw new Error('alphaTab API not initialized');
  }

  this.updateState({ loadingState: 'loading', errorMessage: null });
  this.api.load(new Uint8Array(bytes), trackIndices.slice());
}

// An in-memory score the composer built from its ScoreDoc
renderScore(score: alphaTab.model.Score, trackIndices?: number[]): void;

// composer-score.component.ts - Original state: the file's bytes, the tracks the strip shows
this.alphaTabService.loadBytes(original.bytes, shown.length > 0 ? shown : ALL_TRACKS);

// Composition state: the document, mapped to a Score
this.alphaTabService.renderScore(score, renderedTracksOf(this.trackRows()));
```

Parse failures do not throw from `loadBytes`: alphaTab parses in a worker and reports through its `error` event, which sets `loadingState: 'error'`. Pass explicit track indices - without them alphaTab draws only the first track. `ALL_TRACKS` (`[-1]`) is alphaTab's "every track" sentinel.

### Drag and Drop

The composer page takes a dropped file and hands every dropped file to the opener, which picks the first Guitar Pro file and says what it left:

```typescript
// composer.component.ts
@HostListener('dragover', ['$event'])
onDragOver(event: DragEvent): void {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
}

@HostListener('drop', ['$event'])
onDrop(event: DragEvent): void {
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length === 0) return;
  event.preventDefault();
  if (this.modalOpen) {
    this.composer.announce(this.dropRefusal(), true);
    return;
  }
  void this.opener.importDropped(files);
}
```

Test a name with `isGpFileName` from `services/gp-file-name.ts`, and give a file input `GP_FILE_ACCEPT`. Import them from that module, not from `gp-file-opener.service.ts`: the opener imports alphaTab at the top, and the gallery route would pull the alphaTab core into its chunk just to check an extension.

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

alphaTab 1.8 renders no `.at-note` elements and no `data-note` attribute, so highlighting cannot query the SVG. The composer's scale panel emits a `HighlightConfig` (`highlightChange`), the page passes it to the score's `highlight` input, and the score draws rings over the engraving from alphaTab's bounds lookup:

```typescript
// composer-score.component.ts
private updateScaleOverlay(): void {
  const element = this.alphaTabContainer?.nativeElement;
  const lookup = element && !this.boundsPending ? this.alphaTabService.getBoundsLookup() : null;
  const highlights = lookup ? noteHighlightsOf(lookup, this.highlightConfig) : [];
  const offset = element && highlights.length > 0 ? this.hitTest.lookupOffsetOf(element) : null;
  const marks = offset ? noteMarksOf(highlights, offset) : [];
  if (sameMarks(marks, this.noteMarks)) return;
  this.noteMarks = marks;
  this.cdr.markForCheck();
}
```

`noteHighlightsOf` (`services/scale-highlight.ts`) is pure: it reads each note head's box from `BeatBounds.notes` and its pitch class from `realValue`, and skips drum hits, dead notes and slash/numbered bands. Note heads are in the lookup only while `core.includeNoteBounds` is on, so the page turns it on when the scale panel first opens:

```typescript
// composer.component.ts
onScalePanelOpened(): void {
  this.alphaTabService.setNoteBounds(true);  // re-lays the score out once
}
```

### Highlight Styles

```scss
// composer-score.component.scss - one absolutely placed ring per marked note head
.scale-mark {
  position: absolute;
  z-index: 2;
  box-sizing: content-box;
  margin: -2px 0 0 -2px;
  border: 2px solid var(--composer-in-scale, #3498db);
  border-radius: 50%;
  pointer-events: none;

  &.root {
    margin: -4px 0 0 -4px;
    border: 4px double var(--composer-root, #e74c3c);
  }
}
```

## Playback Controls

### Basic Controls

`AlphaTabService` has `play()`, `playPause()` and `stop()` - no `pause()`; the composer's transport toggles with `playPause()`. The rest of the transport writes the api and mirrors the value into state:

```typescript
setVolume(volume: number): void {
  if (this.api) {
    this.api.masterVolume = Math.max(0, Math.min(1, volume));
    this.updateState({ volume });
  }
}

setPlaybackSpeed(multiplier: number): void {
  if (this.api) {
    this.api.playbackSpeed = multiplier;
    this.updateState({ tempoMultiplier: multiplier });
  }
}

setLooping(loop: boolean): void;        // api.isLooping, state.isLooping
seekToTime(timeMs: number): void;       // api.timePosition
setMetronomeVolume(volume: number): void;
setCountInVolume(volume: number): void;
```

### Track Controls

There is one mixer call, for every track at once. `setTrackPlayback` takes a `TrackPlayback` (`{ mute, solo }`) per track index, applies it now, and applies it again after every MIDI load - a render reloads the MIDI, and the player forgets mutes and solos then:

```typescript
// composer-score.component.ts
this.alphaTabService.setTrackPlayback(this.trackRows().map(row => ({ mute: row.muted, solo: row.soloed })));
```

Which tracks are drawn is separate: `renderTracks(indices)` redraws the given tracks of the score alphaTab already holds (show/hide in the Original state, with no document to re-render from).

Components do not call either directly from a button. The track strip changes `ComposerTrackViewService` (`toggleShown`, and in Original `toggleMuted`/`toggleSoloed` by track key), and the score subscribes to its `getView()` and calls `renderTracks` and `setTrackPlayback`. The view starts again when what the page shows changes - a file opens with the mutes and solos it declares - and Convert carries the file's hidden tracks into the composition (`carryThroughConvert`).

## Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| No audio | User hasn't interacted | alphaTab auto-handles, but may need click |
| Missing fonts | Webpack plugin not configured | Add AlphaTabWebPackPlugin |
| No soundfont | Path incorrect | Check `/soundfont/sonivox.sf2` exists |
| Rendering blank | Container too small | Ensure container has dimensions |
| Memory leak | Not disposing | Call `api.destroy()` in ngOnDestroy |
| UI not updating | OnPush component not marked | Call ChangeDetectorRef.markForCheck() in the state subscription |
| Assets missing in dev | Only webpack plugin configured | Add assets to angular.json |

## ChangeDetectorRef for UI Updates

alphaTab events fire outside Angular's zone. The service brings each one back in with `NgZone.run()`, so an `OnPush` component only has to mark itself for the zone's next check. `markForCheck()`, not `detectChanges()`: a position event arrives many times a second while playing, and `detectChanges()` ran a second change-detection pass for each one.

```typescript
import { ChangeDetectorRef } from '@angular/core';

@Component({ /* ... */ changeDetection: ChangeDetectionStrategy.OnPush })
export class ComposerComponent implements OnInit {
  constructor(
    private readonly alphaTabService: AlphaTabService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.alphaTabService.getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.playerState = state;
        this.cdr.markForCheck();
      });
  }
}
```

The exception is `onBeatMouseMove`, whose handler runs outside the zone on purpose (alphaTab raises it on every pointer move); a caller enters the zone only for a move that changes state.

## Checklist

When modifying the composer's file handling or the GP library:

- [ ] AlphaTabService wraps all API calls
- [ ] NgZone.run() used for all event handlers in service
- [ ] ChangeDetectorRef.markForCheck() used in OnPush component subscriptions
- [ ] Files go through GpFileOpener, which parses before it writes anything
- [ ] Dispose called in ngOnDestroy
- [ ] IndexedDB transactions properly handled
- [ ] Highlighting re-applied after score renders
- [ ] Loading/error states handled in UI
- [ ] File size considered for IndexedDB storage limits
- [ ] Assets configured in angular.json for dev server
- [ ] Custom webpack config includes AlphaTabWebPackPlugin
