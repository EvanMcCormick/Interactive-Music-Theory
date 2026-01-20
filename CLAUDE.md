# MusicTheory Project Guidelines

This is an interactive music theory learning application built with Angular 21 and ASP.NET Core.

## Project Structure

```
client/               # Angular 21 frontend
  src/app/
    components/       # Standalone Angular components (FretboardComponent, KeyboardComponent)
    services/         # MusicTheoryService (centralized state management with RxJS)
    models/           # TypeScript interfaces for domain objects
server/               # ASP.NET Core API backend (mostly scaffolding)
```

## Tech Stack (ALWAYS use these versions/patterns)

- **Angular 21** with standalone components (NO NgModules for new components)
- **TypeScript 5.9** with strict mode enabled
- **Tone.js 15.0** for audio synthesis
- **RxJS 7.8** for reactive state management
- **ASP.NET Core 10.0** for backend (when applicable)

---

# ALWAYS-ACTIVE GUARDRAILS

These rules apply automatically to ALL work in this codebase. No invocation needed.

---

## 1. Angular Architecture Guardrails

### Standalone Components Only
- ALL new components MUST use `standalone: true`
- NEVER create NgModule-based components
- Import dependencies directly in component decorator

```typescript
// CORRECT - Standalone component
@Component({
  selector: 'app-my-component',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './my-component.component.html'
})

// WRONG - NgModule-based
@NgModule({
  declarations: [MyComponent],  // DON'T DO THIS
  imports: [...]
})
```

### State Management Pattern
- Use `MusicTheoryService` for ALL state management
- Use `BehaviorSubject` for state that needs initial values
- Subscribe in components, unsubscribe on destroy
- NEVER store application state in components directly

### Component Communication
- Parent-to-child: `@Input()` properties
- Child-to-parent: `@Output()` EventEmitters
- Sibling/unrelated: Through `MusicTheoryService`

---

## 2. Music Theory Domain Guardrails

### Interval Representation
- Intervals are ALWAYS semitones from root (0-11)
- Scale/chord intervals are arrays: `[0, 2, 4, 5, 7, 9, 11]` for major scale
- Note values are 0-11 representing C through B

### Note Naming Conventions
- Use BOTH sharps and flats arrays for chromatic scale
- Respect `preferSharps` property on scales/chords
- Nashville numbers: 1-7 relative to scale root

```typescript
// Chromatic scales - ALWAYS maintain both
const CHROMATIC_SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CHROMATIC_FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
```

### Scale/Chord Data Integrity
- NEVER modify existing scale/chord interval arrays - they are reference data
- When adding new scales/chords, verify intervals against music theory references
- Common mistake: Wrong modes (Dorian is [0,2,3,5,7,9,10], NOT major intervals)

### Instrument Handling
- Guitar/Bass: fret-based, use `generateFretboard()`
- Piano: key-based, use `generateKeyboard()`
- ALWAYS check instrument type before rendering

---

## 3. Audio/Tone.js Guardrails

### Audio Context Management
- NEVER create multiple Tone.js audio contexts
- Initialize synths once, reuse them
- ALWAYS dispose of audio resources in `ngOnDestroy`

```typescript
// CORRECT - Reuse synths
private synth: Tone.PolySynth;

ngOnInit() {
  this.synth = new Tone.PolySynth(Tone.Synth).toDestination();
}

ngOnDestroy() {
  this.synth?.dispose();
}

// WRONG - Creating synths repeatedly
playNote() {
  new Tone.Synth().toDestination().triggerAttackRelease(...); // Memory leak!
}
```

### Audio Chain Pattern (For Each Instrument)
- Bass: `FMSynth -> EQ3 -> Compressor -> Reverb -> Volume`
- Piano: `PolySynth -> Reverb -> Volume`
- ALWAYS include volume control at end of chain

### User Interaction Requirement
- Tone.js requires user gesture before audio
- ALWAYS call `Tone.start()` on first user interaction
- Handle suspended audio context gracefully

---

## 4. TypeScript Strict Mode Guardrails

### No Implicit Any
- ALWAYS explicitly type function parameters
- ALWAYS define return types for non-trivial functions
- Use interfaces from `music-theory.model.ts`

```typescript
// CORRECT
function calculateNote(fret: number, stringTuning: number): FretNote {
  ...
}

// WRONG
function calculateNote(fret, stringTuning) {  // implicit any
  ...
}
```

### Null Safety
- Use optional chaining (`?.`) for potentially undefined values
- Use nullish coalescing (`??`) for defaults
- NEVER use `!` assertion without justification

### Interface Consistency
- Use existing interfaces: `Scale`, `Chord`, `MusicTheoryItem`, `FretNote`, `Tuning`, `Instrument`
- NEVER create duplicate interfaces for same concepts
- Extend interfaces rather than recreating

---

## 5. Testing Guardrails (WHEN ADDING TESTS)

### Test File Location
- Component tests: `*.component.spec.ts` alongside component
- Service tests: `*.service.spec.ts` alongside service
- Use Jasmine/Karma (already configured)

### What to Test
- Music theory calculations (interval math, note naming)
- State transitions in MusicTheoryService
- Component inputs/outputs
- Audio initialization (mock Tone.js)

### What NOT to Test
- DOM structure details (too brittle)
- Third-party library internals
- Visual styling

---

## 6. Code Style Guardrails

### File Organization
- One component/service per file
- Related files in same directory
- Max 500 lines per file (refactor if larger)

### Naming Conventions
- Components: `PascalCase` + `Component` suffix
- Services: `PascalCase` + `Service` suffix
- Interfaces: `PascalCase` (no `I` prefix)
- Methods: `camelCase`, verb-first (`calculateNote`, `playScale`)

### SCSS Patterns
- Component-scoped styles ONLY
- Use CSS variables for theming
- Color scheme: Dark nav (#2c3e50, #34495e), Root note (red), In-mode notes (blue)

---

## 7. Performance Guardrails

### Change Detection
- Use `OnPush` change detection for performance-critical components
- Avoid computations in templates - use methods or pipes
- Track large lists with `trackBy`

### Memory Management
- Unsubscribe from ALL observables in `ngOnDestroy`
- Dispose ALL Tone.js resources
- Use `takeUntil` pattern for multiple subscriptions

```typescript
private destroy$ = new Subject<void>();

ngOnInit() {
  this.service.state$.pipe(
    takeUntil(this.destroy$)
  ).subscribe(...);
}

ngOnDestroy() {
  this.destroy$.next();
  this.destroy$.complete();
}
```

---

## 8. Git Workflow Guardrails

### Commit Messages
- Format: `<type>: <description>`
- Types: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`
- Example: `feat: Add harmonic minor mode support`

### Branch Naming
- Feature: `feature/<short-description>`
- Bug fix: `fix/<issue-description>`
- Refactor: `refactor/<scope>`

---

## 9. Common Mistakes to Avoid

| Mistake | Correct Approach |
|---------|------------------|
| NgModule components | Always use standalone: true |
| State in components | Use MusicTheoryService |
| Creating new synths per note | Reuse synth instances |
| Modifying interval arrays | Create new arrays if needed |
| Ignoring preferSharps | Check and use appropriate chromatic scale |
| Missing audio disposal | Always dispose in ngOnDestroy |
| Implicit any types | Explicitly type everything |
| Direct DOM manipulation | Use Angular bindings |

---

## 10. Quick Reference

### Adding a New Scale
1. Add to appropriate category in `MusicTheoryService`
2. Define intervals as semitones from root
3. Set `preferSharps` based on key signature conventions
4. Add `type: 'scale'` discriminator

### Adding a New Instrument
1. Define in `instruments` array with `supportedStringCounts`
2. Add tunings to appropriate tuning category
3. Update rendering logic in FretboardComponent or create new component
4. Add audio synthesis configuration

### Adding a New Component
1. Create with `ng generate component --standalone`
2. Import in parent component's imports array
3. Use MusicTheoryService for state
4. Handle audio cleanup in ngOnDestroy

---

## Build Commands

```bash
cd client && npm start      # Development server (localhost:4200)
cd client && npm run build  # Production build
cd client && npm test       # Run tests
```
