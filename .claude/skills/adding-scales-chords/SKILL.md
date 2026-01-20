---
name: adding-scales-chords
description: Use when adding new scales, modes, or chord types to MusicTheory - ensures correct interval math, proper categorization, and sharp/flat preferences based on music theory conventions
---

# Adding Scales and Chords

## Overview

Scales and chords in this project are defined by their **interval structure** (semitones from root). Getting intervals wrong breaks the entire musical representation.

**Core principle:** Verify intervals against authoritative music theory sources before implementing.

## When to Use

- Adding a new scale or mode
- Adding a new chord type
- Modifying existing scale/chord intervals
- Creating a new category of scales/chords

## Interval System

Intervals are **semitones from root note** (0-11):

| Interval Name | Semitones | Example from C |
|---------------|-----------|----------------|
| Unison (Root) | 0 | C |
| Minor 2nd | 1 | Db |
| Major 2nd | 2 | D |
| Minor 3rd | 3 | Eb |
| Major 3rd | 4 | E |
| Perfect 4th | 5 | F |
| Tritone | 6 | F#/Gb |
| Perfect 5th | 7 | G |
| Minor 6th | 8 | Ab |
| Major 6th | 9 | A |
| Minor 7th | 10 | Bb |
| Major 7th | 11 | B |

## Adding a Scale

### Location
`client/src/app/services/music-theory.service.ts` in the appropriate category within `UNIFIED_CATEGORIES`

### Structure
```typescript
{
  id: 'scale-name-lowercase',
  name: 'Display Name',
  intervals: [0, 2, 4, 5, 7, 9, 11],  // Semitones from root
  preferSharps: true,                  // Sharp or flat key signature
  type: 'scale' as const
}
```

### preferSharps Rules

| Key Center | preferSharps | Reason |
|------------|--------------|--------|
| Major scales (C, G, D, A, E, B) | true | Natural sharps in key signature |
| Flat keys (F, Bb, Eb, Ab) | false | Natural flats in key signature |
| Minor scales | Match relative major | |
| Modes | Match parent scale | |
| Exotic scales | true (default) | Unless traditionally notated with flats |

### Common Scale Intervals

```typescript
// Diatonic Modes (from major scale)
Ionian:     [0, 2, 4, 5, 7, 9, 11]  // Major
Dorian:     [0, 2, 3, 5, 7, 9, 10]
Phrygian:   [0, 1, 3, 5, 7, 8, 10]
Lydian:     [0, 2, 4, 6, 7, 9, 11]
Mixolydian: [0, 2, 4, 5, 7, 9, 10]
Aeolian:    [0, 2, 3, 5, 7, 8, 10]  // Natural Minor
Locrian:    [0, 1, 3, 5, 6, 8, 10]

// Common Variations
Harmonic Minor:  [0, 2, 3, 5, 7, 8, 11]
Melodic Minor:   [0, 2, 3, 5, 7, 9, 11]
Pentatonic Maj:  [0, 2, 4, 7, 9]
Pentatonic Min:  [0, 3, 5, 7, 10]
Blues:           [0, 3, 5, 6, 7, 10]
```

## Adding a Chord

### Location
Same file, chord categories within `UNIFIED_CATEGORIES`

### Structure
```typescript
{
  id: 'chord-name-lowercase',
  name: 'Display Name',
  intervals: [0, 4, 7],     // Semitones from root
  symbol: 'maj',            // Chord symbol suffix
  preferSharps: true,
  type: 'chord' as const
}
```

### Common Chord Intervals

```typescript
// Triads
Major:      [0, 4, 7]
Minor:      [0, 3, 7]
Diminished: [0, 3, 6]
Augmented:  [0, 4, 8]
Sus2:       [0, 2, 7]
Sus4:       [0, 5, 7]

// Seventh Chords
Major 7th:      [0, 4, 7, 11]
Dominant 7th:   [0, 4, 7, 10]
Minor 7th:      [0, 3, 7, 10]
Diminished 7th: [0, 3, 6, 9]
Half-Dim 7th:   [0, 3, 6, 10]

// Extended Chords
Major 9th:   [0, 4, 7, 11, 14]  // Note: 14 = 2 + 12 (2nd + octave)
Dominant 9th: [0, 4, 7, 10, 14]
```

## Verification Checklist

Before committing any scale/chord addition:

- [ ] Intervals verified against music theory reference (not memory)
- [ ] Root note (0) is first in array
- [ ] Intervals are in ascending order
- [ ] No duplicate intervals
- [ ] preferSharps matches convention
- [ ] Type discriminator is correct ('scale' or 'chord')
- [ ] ID is lowercase with hyphens
- [ ] Name is proper display case
- [ ] Symbol (for chords) follows standard notation
- [ ] Tested by selecting in UI and verifying note display

## Common Mistakes

| Mistake | Impact | Prevention |
|---------|--------|------------|
| Wrong mode intervals | Completely wrong notes displayed | Verify against reference |
| Missing root (0) | Scale doesn't start on root | Always include 0 first |
| Intervals > 11 | Works but inconsistent | Use 0-11, extended intervals wrap |
| Wrong preferSharps | Enharmonic confusion (C# vs Db) | Check key signature conventions |

## Quick Test

After adding, select the new scale/chord in the UI:
1. Set root to C
2. Verify notes match expected (C major = C D E F G A B)
3. Set root to F# - verify sharps/flats display correctly
4. Play through to hear if it sounds correct
