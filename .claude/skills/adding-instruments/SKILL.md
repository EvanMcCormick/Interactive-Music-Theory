---
name: adding-instruments
description: Use when adding new musical instruments (ukulele, mandolin, etc.) to the app - covers data model setup, tuning definitions, rendering considerations, and audio synthesis configuration
---

# Adding New Instruments

## Overview

Instruments in this app fall into two categories: **fretted** (guitar, bass) and **keyboard** (piano). Adding a new instrument requires updates to data models, services, components, and audio.

**Core principle:** Match real instrument characteristics - string count, tuning, range, and sound.

## When to Use

- Adding a new stringed instrument (ukulele, mandolin, banjo)
- Adding a new keyboard instrument (organ, synth)
- Adding alternative configurations for existing instruments
- Creating custom/experimental instruments

## Instrument Data Model

### Location
`client/src/app/services/music-theory.service.ts`

### Structure
```typescript
interface Instrument {
  id: string;
  name: string;
  defaultTuning: number[];        // MIDI note numbers or semitone offsets
  supportedStringCounts: number[];
  type?: 'fretted' | 'keyboard';  // Optional but recommended
}
```

## Step-by-Step: Adding a Fretted Instrument

### 1. Define the Instrument

```typescript
// In MusicTheoryService
const INSTRUMENTS: Instrument[] = [
  // ... existing instruments
  {
    id: 'ukulele',
    name: 'Ukulele',
    defaultTuning: [7, 0, 4, 9],  // G4 C4 E4 A4 (standard re-entrant)
    supportedStringCounts: [4],
    type: 'fretted'
  }
];
```

### 2. Define Tunings

```typescript
const UKULELE_TUNINGS: Tuning[] = [
  {
    name: 'Standard (GCEA)',
    strings: [7, 0, 4, 9]  // Semitones from C (G=7, C=0, E=4, A=9)
  },
  {
    name: 'Baritone (DGBE)',
    strings: [2, 7, 11, 4]  // D G B E
  },
  {
    name: 'Low G',
    strings: [7, 0, 4, 9]  // Same pitches, lower G
  }
];
```

### 3. Register Tunings in Service

```typescript
getTunings(instrumentId: string): Tuning[] {
  switch (instrumentId) {
    case 'guitar': return GUITAR_TUNINGS;
    case 'bass': return BASS_TUNINGS;
    case 'ukulele': return UKULELE_TUNINGS;  // Add this
    default: return [];
  }
}
```

### 4. Update Fretboard Generation

In `generateFretboard()`, handle new instrument:

```typescript
generateFretboard(): FretNote[][] {
  const state = this.stateSubject.value;
  const tuning = this.getCurrentTuning();

  // Adjust fret count for instrument range
  const fretCount = state.instrumentId === 'ukulele' ? 12 : 15;

  // Generate fretboard
  return tuning.strings.map((openNote, stringIndex) => {
    return Array.from({ length: fretCount + 1 }, (_, fret) => {
      return this.getFretNote(openNote, fret, state);
    });
  });
}
```

### 5. Update Component Display

In `FretboardComponent`, handle instrument-specific display:

```typescript
get fretMarkers(): number[] {
  // Ukulele typically has different marker positions
  if (this.instrumentId === 'ukulele') {
    return [3, 5, 7, 10, 12];  // No markers past 12
  }
  return [3, 5, 7, 9, 12, 15];
}

get stringThickness(): number[] {
  switch (this.instrumentId) {
    case 'ukulele': return [0.028, 0.032, 0.040, 0.028];  // Re-entrant
    case 'guitar': return [0.010, 0.013, 0.017, 0.026, 0.036, 0.046];
    // ... etc
  }
}
```

## Step-by-Step: Adding a Keyboard Instrument

### 1. Define the Instrument

```typescript
{
  id: 'organ',
  name: 'Organ',
  defaultTuning: [],  // Keyboards don't use tuning arrays
  supportedStringCounts: [],  // Not applicable
  keyboardSizes: [61, 88],  // Available keyboard sizes
  type: 'keyboard'
}
```

### 2. Create or Extend Component

For significantly different keyboard layout, create new component:

```typescript
@Component({
  selector: 'app-organ-keyboard',
  standalone: true,
  // ...
})
export class OrganKeyboardComponent {
  // Organ-specific: drawbars, stops, pedals
}
```

Or extend KeyboardComponent for similar instruments:

```typescript
// Add organ-specific properties to existing KeyboardComponent
get keyboardLayout(): 'piano' | 'organ' {
  return this.instrumentId === 'organ' ? 'organ' : 'piano';
}
```

### 3. Add Audio Synthesis

```typescript
// Organ sound - use additive synthesis
const organSynth = new Tone.PolySynth(Tone.Synth, {
  oscillator: {
    type: 'sine',
    partials: [1, 0.5, 0.25, 0.125]  // Organ harmonic content
  },
  envelope: {
    attack: 0.01,
    decay: 0.1,
    sustain: 0.9,  // Organ sustains while key held
    release: 0.1   // Quick release
  }
});

// Add Leslie speaker effect for organ
const tremolo = new Tone.Tremolo({
  frequency: 6,  // Leslie speed
  depth: 0.5
}).start();
```

## Audio Synthesis Guidelines

### Matching Real Instruments

| Instrument | Synth Type | Key Characteristics |
|------------|------------|---------------------|
| Guitar | PluckSynth | Quick attack, string resonance |
| Bass | FMSynth | Low harmonics, punch |
| Piano | PolySynth (Sine) | Hammer attack, sustain pedal |
| Ukulele | PluckSynth | Bright, short sustain |
| Organ | Additive | Drawbar harmonics, sustain |
| Mandolin | PluckSynth | Very bright, tremolo |

### Note Range Mapping

```typescript
// Get note range for instrument
getNoteRange(instrumentId: string): { low: string; high: string } {
  switch (instrumentId) {
    case 'guitar': return { low: 'E2', high: 'E6' };
    case 'bass': return { low: 'E1', high: 'G4' };
    case 'ukulele': return { low: 'G4', high: 'A6' };
    case 'piano': return { low: 'A0', high: 'C8' };
    default: return { low: 'C2', high: 'C6' };
  }
}
```

## Common Instruments Reference

### Ukulele
- Strings: 4
- Standard: G4-C4-E4-A4 (re-entrant - G is high)
- Frets: 12-17 typically
- Sound: Bright, percussive

### Mandolin
- Strings: 8 (4 courses of 2)
- Standard: G3-D4-A4-E5
- Frets: 17-24
- Sound: Very bright, tremolo playing common

### Banjo (5-string)
- Strings: 5 (one short drone string)
- Standard: G4-D3-G3-B3-D4
- Frets: 22
- Sound: Bright, twangy

### 7-String Guitar
- Strings: 7
- Standard: B1-E2-A2-D3-G3-B3-E4
- Frets: 24
- Sound: Extended bass range

## Checklist

When adding a new instrument:

- [ ] Define instrument in `INSTRUMENTS` array
- [ ] Add all common tunings
- [ ] Register tunings in `getTunings()` method
- [ ] Update `generateFretboard()` or `generateKeyboard()` for range
- [ ] Add fret/key markers appropriate for instrument
- [ ] Create audio synthesis matching instrument character
- [ ] Test note range plays correctly
- [ ] Verify UI displays appropriately (string thickness, layout)
- [ ] Add to instrument selection dropdown
- [ ] Test all tuning variations

## Anti-Patterns

| Don't | Why | Do Instead |
|-------|-----|------------|
| Copy-paste guitar tuning math | Different instruments have different characteristics | Understand each instrument's unique properties |
| Use same synth for all instruments | Sounds wrong | Create instrument-appropriate synthesis |
| Hardcode string counts | Limits flexibility | Use `supportedStringCounts` array |
| Ignore re-entrant tunings | Some instruments have them | Handle non-ascending string pitches |
