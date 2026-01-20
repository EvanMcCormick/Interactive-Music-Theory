---
name: music-theory-verification
description: Use when implementing or debugging music theory calculations - provides verification methods for intervals, note naming, scale construction, and chord voicings to catch common mathematical errors
---

# Music Theory Verification

## Overview

Music theory code involves modular arithmetic (mod 12) and interval calculations. Small errors produce completely wrong notes that may not be obvious until heard.

**Core principle:** Verify calculations against known musical facts before trusting code.

## When to Use

- Debugging incorrect note display
- Verifying new scale/chord implementations
- Troubleshooting Nashville number display
- Checking fretboard/keyboard generation
- Validating transposition logic

## The Chromatic Scale

```
Index:  0   1    2   3    4   5   6    7   8    9   10   11
Sharp:  C   C#   D   D#   E   F   F#   G   G#   A   A#   B
Flat:   C   Db   D   Eb   E   F   Gb   G   Ab   A   Bb   B
```

## Interval Math

### Note Value Calculation
```typescript
// Adding interval to root
noteValue = (rootValue + interval) % 12;

// Example: G major 3rd
// G = 7, major 3rd = 4
// (7 + 4) % 12 = 11 = B ✓
```

### Fret Note Calculation
```typescript
// Note at fret position
noteValue = (openStringValue + fretNumber) % 12;

// Example: 3rd fret on A string (A = 9)
// (9 + 3) % 12 = 0 = C ✓
```

### Common Errors
```typescript
// WRONG: Forgetting modulo
noteValue = rootValue + interval;  // Can exceed 11!

// WRONG: Wrong modulo base
noteValue = (root + interval) % 11;  // Should be 12

// WRONG: Negative intervals without handling
noteValue = (root - interval) % 12;  // Can be negative!

// CORRECT: Handle negative
noteValue = ((root - interval) % 12 + 12) % 12;
```

## Quick Verification Tests

### Major Scale Test
Starting from C (0), major scale intervals [0,2,4,5,7,9,11] should produce:
```
C(0) D(2) E(4) F(5) G(7) A(9) B(11)
```

Starting from G (7):
```
G(7) A(9) B(11) C(0) D(2) E(4) F#(6)
```

### Minor Scale Test
Starting from A (9), natural minor [0,2,3,5,7,8,10]:
```
A(9) B(11) C(0) D(2) E(4) F(5) G(7)
```

### Chord Test
C Major chord [0,4,7] from C(0):
```
C(0) E(4) G(7) ✓
```

G7 chord [0,4,7,10] from G(7):
```
G(7) B(11) D(2) F(5) ✓
```

## Nashville Number Verification

Nashville numbers represent scale degrees 1-7.

### Calculation
```typescript
// Find position of note in current scale
nashvilleNumber = scaleIntervals.indexOf(
  (noteValue - rootValue + 12) % 12
) + 1;  // +1 because Nashville is 1-indexed

// If not in scale, nashvilleNumber = 0 or null
```

### Test Cases

C Major scale, notes C-D-E-F-G-A-B:
```
C → 1 (root)
D → 2
E → 3
F → 4
G → 5
A → 6
B → 7
C# → null (not in scale)
```

## Mode Derivation Verification

Each mode starts on a different scale degree of the parent scale.

### From C Major (Ionian)
```
Ionian (I):     C D E F G A B  [0,2,4,5,7,9,11]
Dorian (II):    D E F G A B C  [0,2,3,5,7,9,10]
Phrygian (III): E F G A B C D  [0,1,3,5,7,8,10]
Lydian (IV):    F G A B C D E  [0,2,4,6,7,9,11]
Mixolydian (V): G A B C D E F  [0,2,4,5,7,9,10]
Aeolian (VI):   A B C D E F G  [0,2,3,5,7,8,10]
Locrian (VII):  B C D E F G A  [0,1,3,5,6,8,10]
```

### Verify Mode Intervals
If implementing a mode, verify against this transformation:
```typescript
// Mode intervals from parent major scale
function getModeIntervals(modeNumber: number): number[] {
  const major = [0, 2, 4, 5, 7, 9, 11];
  const startIndex = modeNumber - 1;

  return major.map((_, i) => {
    const sourceIndex = (startIndex + i) % 7;
    const interval = (major[sourceIndex] - major[startIndex] + 12) % 12;
    return interval;
  }).sort((a, b) => a - b);
}
```

## Fretboard Verification

### Open String Notes (Standard Guitar Tuning E-A-D-G-B-E)
```
String 6 (low E): E = 4
String 5: A = 9
String 4: D = 2
String 3: G = 7
String 2: B = 11
String 1 (high E): E = 4
```

### Fret Verification Points
```
Fret 5 on low E string: A (9) ✓
Fret 7 on A string: E (4) ✓
Fret 12 on any string: Same note as open (octave) ✓
```

### Octave Calculation
```typescript
// Standard MIDI octave calculation
// Middle C (C4) = MIDI 60
// C0 = 12, C1 = 24, ... C4 = 60

octave = Math.floor(midiNote / 12) - 1;
noteValue = midiNote % 12;

// For fretboard display
baseOctave = getStringBaseOctave(stringIndex);
octave = baseOctave + Math.floor((openNote + fret) / 12);
```

## Piano Keyboard Verification

### Key Position to Note
```typescript
// White keys in octave: C D E F G A B (indices 0,2,4,5,7,9,11)
// Black keys: C# D# F# G# A# (indices 1,3,6,8,10)

function isBlackKey(noteValue: number): boolean {
  return [1, 3, 6, 8, 10].includes(noteValue);
}
```

### 61-Key Keyboard (Standard)
- Starts at C2 (MIDI 36)
- Ends at C7 (MIDI 96)
- Middle C (C4) is key 25

## Debugging Checklist

When notes display incorrectly:

1. [ ] Verify root note value is correct (C=0, C#=1, etc.)
2. [ ] Check interval array is correct for scale/chord
3. [ ] Verify modulo 12 is applied consistently
4. [ ] Check for off-by-one in array indexing
5. [ ] Verify preferSharps is being respected
6. [ ] Test with C root (simplest case) first
7. [ ] Test with F# root (catches many edge cases)
8. [ ] Play the notes - does it sound right?

## Console Debugging Helpers

```typescript
// Add to MusicTheoryService for debugging
debugNote(noteValue: number, preferSharps: boolean = true): string {
  const sharps = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const flats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  return (preferSharps ? sharps : flats)[noteValue % 12];
}

debugScale(rootValue: number, intervals: number[]): void {
  console.log('Scale notes:', intervals.map(i =>
    this.debugNote((rootValue + i) % 12)
  ).join(' '));
}

debugChord(rootValue: number, intervals: number[]): void {
  console.log('Chord notes:', intervals.map(i =>
    this.debugNote((rootValue + i) % 12)
  ).join(' '));
}
```

## Reference Tables

### Circle of Fifths (Clockwise)
```
C(0) → G(7) → D(2) → A(9) → E(4) → B(11) →
F#(6) → C#(1) → G#(8) → D#(3) → A#(10) → F(5) → C
```

### Interval Names to Semitones
| Name | Semitones | Example |
|------|-----------|---------|
| m2 | 1 | C-Db |
| M2 | 2 | C-D |
| m3 | 3 | C-Eb |
| M3 | 4 | C-E |
| P4 | 5 | C-F |
| TT | 6 | C-F# |
| P5 | 7 | C-G |
| m6 | 8 | C-Ab |
| M6 | 9 | C-A |
| m7 | 10 | C-Bb |
| M7 | 11 | C-B |
| P8 | 12 | C-C' |
