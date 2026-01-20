---
name: audio-implementation
description: Use when implementing audio features, adding new instruments, or modifying Tone.js synthesis - ensures proper resource management, prevents memory leaks, and maintains consistent audio quality
---

# Audio Implementation with Tone.js

## Overview

Audio in this project uses Tone.js for synthesis. Improper handling causes memory leaks, audio glitches, and browser crashes.

**Core principle:** Initialize once, reuse always, dispose completely.

## When to Use

- Adding audio playback features
- Creating new instrument sounds
- Modifying audio effects chains
- Fixing audio-related bugs
- Adding new play modes (arpeggios, chords, etc.)

## Audio Architecture

### Current Instruments

**Bass Guitar** (FretboardComponent):
```
FMSynth → EQ3 → Compressor → Reverb → Volume → Destination
```

**Piano** (KeyboardComponent):
```
PolySynth(Synth) → Reverb → Volume → Destination
```

### Initialization Pattern

```typescript
private synth: Tone.PolySynth | null = null;
private reverb: Tone.Reverb | null = null;
private volume: Tone.Volume | null = null;

async initAudio(): Promise<void> {
  // Start audio context (REQUIRED - needs user gesture)
  await Tone.start();

  // Create effects chain (end to start)
  this.volume = new Tone.Volume(-6).toDestination();
  this.reverb = new Tone.Reverb({ decay: 2.5 }).connect(this.volume);

  // Wait for reverb to generate IR
  await this.reverb.ready;

  // Create synth and connect
  this.synth = new Tone.PolySynth(Tone.Synth).connect(this.reverb);

  // Configure synth
  this.synth.set({
    oscillator: { type: 'sine' },
    envelope: {
      attack: 0.005,
      decay: 0.3,
      sustain: 0.2,
      release: 1.5
    }
  });
}
```

### Disposal Pattern (CRITICAL)

```typescript
ngOnDestroy(): void {
  // Dispose in reverse order of creation
  this.synth?.dispose();
  this.reverb?.dispose();
  this.volume?.dispose();

  // Null out references
  this.synth = null;
  this.reverb = null;
  this.volume = null;
}
```

## Playing Notes

### Single Note
```typescript
playNote(noteName: string, duration: string = '8n'): void {
  if (!this.synth) return;

  // triggerAttackRelease handles timing automatically
  this.synth.triggerAttackRelease(noteName, duration);
}
```

### Note with Octave
```typescript
// Convert note value (0-11) and octave to Tone.js format
const noteName = `${CHROMATIC_SHARPS[noteValue]}${octave}`;  // e.g., "C4", "F#3"
this.synth.triggerAttackRelease(noteName, '8n');
```

### Sequence of Notes (Arpeggio)
```typescript
playScale(notes: string[], tempo: number = 120): void {
  const now = Tone.now();
  const noteDuration = 60 / tempo;  // seconds per beat

  notes.forEach((note, index) => {
    this.synth?.triggerAttackRelease(
      note,
      '8n',
      now + (index * noteDuration)
    );
  });
}
```

### Chord (Simultaneous Notes)
```typescript
playChord(notes: string[], duration: string = '2n'): void {
  if (!this.synth) return;

  // PolySynth handles multiple simultaneous notes
  this.synth.triggerAttackRelease(notes, duration);
}
```

## Instrument Profiles

### Bass Sound
```typescript
const bassSynth = new Tone.FMSynth({
  harmonicity: 0.25,
  modulationIndex: 8,
  oscillator: { type: 'sine' },
  envelope: {
    attack: 0.01,
    decay: 0.2,
    sustain: 0.8,
    release: 0.5
  },
  modulation: { type: 'sine' },
  modulationEnvelope: {
    attack: 0.01,
    decay: 0.2,
    sustain: 0.5,
    release: 0.5
  }
});

const bassEQ = new Tone.EQ3({
  low: 8,      // Boost bass frequencies
  mid: -2,     // Slight mid cut
  high: -8     // Cut highs for warmth
});

const bassCompressor = new Tone.Compressor({
  ratio: 8,
  threshold: -24,
  attack: 0.003,
  release: 0.25
});
```

### Piano Sound
```typescript
const pianoSynth = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: 'sine' },
  envelope: {
    attack: 0.005,
    decay: 0.3,
    sustain: 0.2,
    release: 1.5
  }
});

const pianoReverb = new Tone.Reverb({
  decay: 2.5,
  wet: 0.3
});
```

### Guitar Sound (if adding)
```typescript
const guitarSynth = new Tone.PluckSynth({
  attackNoise: 1.5,
  dampening: 4000,
  resonance: 0.95,
  release: 1.2
});
```

## Common Patterns

### User Gesture Requirement
```typescript
// Audio context starts suspended - MUST have user interaction
async handleFirstInteraction(): Promise<void> {
  if (Tone.context.state !== 'running') {
    await Tone.start();
  }
}

// Attach to click handler
<button (click)="handleFirstInteraction(); playNote('C4')">Play</button>
```

### Visual Feedback with Audio
```typescript
playNoteWithFeedback(noteIndex: number, noteName: string): void {
  // Visual highlight
  this.currentlyPlayingPosition = noteIndex;

  // Play audio
  this.synth?.triggerAttackRelease(noteName, '8n');

  // Clear highlight after duration
  setTimeout(() => {
    this.currentlyPlayingPosition = null;
  }, 300);
}
```

### Volume Control
```typescript
setVolume(db: number): void {
  if (this.volume) {
    this.volume.volume.value = db;  // -60 to 0, where 0 is max
  }
}

mute(): void {
  if (this.volume) {
    this.volume.mute = true;
  }
}
```

## Anti-Patterns

| Anti-Pattern | Problem | Correct Approach |
|--------------|---------|------------------|
| `new Tone.Synth()` per note | Memory leak, audio glitches | Initialize once, reuse |
| No disposal in ngOnDestroy | Memory never freed | Always dispose all nodes |
| Forgetting `await Tone.start()` | Silent playback | Call on first interaction |
| Not awaiting `reverb.ready` | Reverb may not work | Always await before connecting |
| Using `setTimeout` for timing | Timing drift | Use Tone.js Transport or `Tone.now()` |
| Connecting nodes out of order | No audio output | Connect from source to destination |

## Debugging Audio Issues

### No Sound
1. Check `Tone.context.state` - must be 'running'
2. Verify connections: synth → effects → destination
3. Check volume levels (not muted, not -Infinity)
4. Ensure note names are valid ('C4' not 'C' or 'c4')

### Clicks/Pops
1. Add attack/release envelope (not 0)
2. Don't stop notes abruptly - use `triggerRelease()`
3. Check for overlapping notes

### Memory Issues
1. Verify disposal in ngOnDestroy
2. Check for event listener cleanup
3. Use Chrome DevTools → Memory → Heap snapshot

## Testing Audio

```typescript
// Mock Tone.js for unit tests
beforeEach(() => {
  spyOn(Tone, 'start').and.returnValue(Promise.resolve());
  // Create mock synth
  mockSynth = jasmine.createSpyObj('PolySynth',
    ['triggerAttackRelease', 'dispose', 'connect', 'set']
  );
  spyOn(Tone, 'PolySynth').and.returnValue(mockSynth);
});

it('should play note', async () => {
  await component.initAudio();
  component.playNote('C4');
  expect(mockSynth.triggerAttackRelease).toHaveBeenCalledWith('C4', '8n');
});
```

## Multiple Audio Sources (Tone.js + alphaTab)

The app uses two audio systems:
- **Tone.js**: Fretboard/keyboard note playback
- **alphaTab**: Guitar Pro file playback (has its own audio context)

### Handling Audio Context Conflicts

alphaTab creates its own Web Audio context. When switching between pages:

```typescript
// GP Viewer Component
export class GpViewerComponent implements OnInit, OnDestroy {
  ngOnInit(): void {
    // alphaTab will create its own audio context
    // Tone.js context remains but is unused
  }

  ngOnDestroy(): void {
    // Dispose alphaTab resources
    this.alphaTabService.dispose();
    // Tone.js resumes automatically when fretboard initializes
  }
}
```

### Key Points

| Context | Managed By | Notes |
|---------|------------|-------|
| Tone.js AudioContext | Tone.js library | Auto-created on first `Tone.start()` |
| alphaTab AudioContext | alphaTab library | Created by `AlphaTabApi` initialization |

- Both contexts can coexist but only one should play at a time
- alphaTab disposes its context when `api.destroy()` is called
- Tone.js context persists across navigation (singleton)
