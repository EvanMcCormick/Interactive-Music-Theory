# Circle of Fifths — Design

**Date:** 2026-09-07
**Status:** Design agreed, not yet implemented.

A circle of fifths that is a **key selector for the whole app**, not a poster.
The app already keeps `selectedKey` in `MusicTheoryService` and the fretboard
and keyboard both read it, so most of this is projection and wiring rather than
new state.

---

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Purpose | Interactive selector, not a reference chart | The state already exists and every other view reacts to it. A chart teaches; a selector teaches *by doing* — you watch the fretboard relight as you move round the circle |
| Fifths and fourths | One circle, direction toggle | They are one object read two ways. Two components would duplicate the geometry, the hit-testing and the tests for a difference that is one array reversal |
| Contents | Majors, relative minors, key signatures | The relative-minor ring is the relationship people open a circle of fifths to see. Signatures are what make it usable for reading rather than just for picking |
| Placement | Collapsible drawer, any page | The key matters on more than one route, so binding it to one page would mean building it twice |

---

## 1. Architecture

`CircleOfFifthsComponent` — standalone, `OnPush`, under
`components/circle-of-fifths/`. Inline SVG rather than divs: three concentric
rings of twelve wedges need real geometry, and SVG gives exact arcs, text placed
on a curve, and hit-testing through `<path>` for free.

The drawer host is `AppComponent`, the only thing spanning every route. A toggle
sits in the existing header nav and the drawer overlays `<main>` from the right —
overlay rather than push, so no page reflows or needs to know it exists.

**The visibility rule is a decision, not an oversight.** The drawer sets
`selectedKey`. That means nothing on `/gp-viewer` or `/gp-library`, and on
`/transcribe` it is actively misleading — that page has its own key handling
inside `DerivationSettings`, and a global key control that did not drive it would
look broken. So the toggle appears on `/fretboard` and `/composer` only, from an
allow-list in `AppComponent` rather than each page opting in.

State stays entirely in `MusicTheoryService`. The component reads `selectedKey`
and `selectedItem` to decide what is highlighted and calls the existing setters
on click. No new state and no new service, which is why "clicking a minor sets
key *and* mode" costs one extra call rather than a new concept.

Nothing here is instrument-aware, so it never touches tunings or string counts.

## 2. The data

Twelve positions, each carrying a major, its relative minor, and its signature:

```
C · G · D · A · E · B · F♯/G♭ · D♭ · A♭ · E♭ · B♭ · F
0   1♯  2♯  3♯  4♯  5♯   6♯/6♭   5♭   4♭   3♭   2♭  1♭
Am  Em  Bm  F♯m C♯m G♯m  D♯m/E♭m B♭m  Fm   Cm   Gm  Dm
```

**The fourths toggle reverses the array and nothing else.** Same objects, same
geometry, same handlers. That is the whole implementation, and it is the reason
one component was the right call.

**Spelling keeps every signature at six accidentals or fewer**, which is why the
right half is sharp-spelled and the left flat-spelled. Only 6 o'clock is
genuinely ambiguous; it renders as a split wedge — F♯ above G♭ — with two hit
targets, because those are two different keys to a reader even though they are
one pitch.

A property that falls out for free and must not be broken: the service's
`flatKeys` list already decides whether the app spells notes with flats. So
clicking G♭ makes the fretboard display flats and clicking B makes it display
sharps. **The circle's two halves select the correct spelling as well as the
pitch**, with the component doing nothing to arrange it.

`getNoteIndex` already resolves both sharp and flat names, so every key the
circle emits is one the service understands. The data is reference material, so
it is a frozen constant with its intervals stated rather than computed at
runtime.

## 3. Rendering and interaction

Three rings in one `viewBox="0 0 400 400"`, so the whole thing scales to the
drawer width with no breakpoints: an outermost thin band for the signature, a
middle band for majors, an inner band for relative minors. Each wedge is a
`<path>` arc with text at its midpoint angle, **upright rather than rotated** —
rotated labels look right on a poster and are hard to read at drawer width.

**Clicks.** A major wedge or its signature band sets `selectedKey` and
`selectedItem: 'ionian'`. A minor wedge sets the key and `'aeolian'`.

**Highlighting reads the same state back.** The wedge matching `selectedKey` is
filled, and *which ring* is filled depends on whether `selectedItem` is aeolian.
Arriving with A minor already selected lights the inner ring, so the circle
displays app state rather than holding its own idea of what is selected.

**C stays at the top and the circle does not rotate to the selection.** Rotating
is prettier and destroys the one thing the diagram is for: you learn the shape by
its fixed positions, and a circle that moves under you teaches nothing.

**Accessibility is real work here**, because SVG paths are not focusable. Each
wedge gets `role="button"`, `tabindex`, and an `aria-label` naming the key and
its signature; arrow keys move round the circle. The drawer traps focus and
closes on Escape.

## 4. Testing

Four things are worth testing and two are not.

**The reference data, derived rather than restated.** A test that lists the
twelve keys and asserts the component lists the same twelve is the data checking
a copy of itself. Instead: each position is seven semitones above the one before
it (mod 12), each relative minor is nine semitones above its major, and the
signature counts run 0 through 6 sharps and 6 back to 1 flat — all read through
`getNoteIndex`, so the test also proves every name the circle emits is one the
service understands. That is the integration risk, and this is what covers it.

**The fourths toggle**, by the same standard: reversing yields ascending
*fourths*, five semitones apart. One assertion, and it is the one that catches
someone "fixing" the toggle into a second hard-coded array.

**The two click paths**, against a stubbed service: a major sets key and
`ionian`, a minor sets key and `aeolian`. And **highlighting**, driven the other
way: push state in, assert which ring reports itself selected.

**The toggle's visibility rule** — present on `/fretboard` and `/composer`,
absent on `/transcribe`.

Not tested: SVG path geometry and exact coordinates. That is arithmetic which
either renders correctly or obviously does not, and pinning `d` attributes makes
the component unrefactorable for no protection — the same reason `CLAUDE.md`
rules out testing DOM structure.

Roughly 20 specs, all fast, none needing audio or a model.

## Deliberately not in scope

- **Diatonic chords and ii-V-I.** A theory panel beside the circle is the obvious
  next thing and it is a different feature: the chord derivation is real
  music-theory code that wants its own verification, and bolting it on here would
  make a key selector into something else halfway through building it.
- **Modes beyond ionian and aeolian.** The circle has two rings and they mean
  major and minor. A dorian ring is not a circle of fifths.
- **Rotating to the selection**, per above.
- **A route of its own.** The drawer reaches every page that cares; a `/circle`
  route would be a second way to the same component.
