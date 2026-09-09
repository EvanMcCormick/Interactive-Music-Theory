# Interactive Music Theory

A comprehensive web application for exploring scales, modes, chords, and music theory concepts on guitar, bass guitar, and piano/keyboard.

> **SaaS Platform in Development**: We're building a B2B music education platform for teachers and students. See [docs/ROADMAP.md](docs/ROADMAP.md) for progress and [docs/plans/2026-01-20-saas-platform-design.md](docs/plans/2026-01-20-saas-platform-design.md) for the full design.

## Features

### Interactive Instrument Display
- **Fretboard View**: Visual fretboard display with 16 frets (0-15) for guitar/bass
- **Keyboard View**: Realistic piano keyboard with black and white keys
- Click on notes/keys to hear them played with instrument-specific sounds
- Real-time highlighting of notes being played
- Root notes highlighted in red, scale/chord tones in blue
- Dimmed display for notes not in the current scale/mode

### Instrument Support
- **Guitar**: 6, 7, and 8 string configurations
- **Bass Guitar**: 4, 5, and 6 string configurations
- **Piano/Keyboard**: 25, 37, 49, 61 (standard), and 88-key (full piano) configurations

### Side Navigation Interface
- Modern collapsible sidebar with dark theme
- Organized settings sections for Instrument and Music Theory
- Context-sensitive controls (shows only relevant options for selected instrument)
- Responsive design that adapts to screen size

### Tunings

#### Bass Guitar Tunings
- Standard (E-A-D-G)
- Drop D
- Half Step Down
- Whole Step Down
- All Fifths

#### Guitar Tunings
- Standard (E-A-D-G-B-E)
- Drop D
- Half Step Down
- Whole Step Down
- Open D
- Open G

### Scales & Modes

#### Fretboard Notes
- All Notes (Sharps)
- All Notes (Flats)
- Natural Notes Only
- Sharp Notes Only
- Flat Notes Only

#### Diatonic Modes
- Ionian (Major)
- Dorian
- Phrygian
- Lydian
- Mixolydian
- Aeolian (Natural Minor)
- Locrian

#### Pentatonic Scales
- Major Pentatonic
- Minor Pentatonic

#### Blues Scales
- Major Blues
- Minor Blues

#### Other Scales
- Harmonic Minor
- Melodic Minor
- Whole Tone
- Diminished (H-W)
- Augmented

#### Exotic & World Scales
- Hungarian Minor
- Hungarian Major
- Double Harmonic (Byzantine)
- Phrygian Dominant
- Neapolitan Minor
- Neapolitan Major
- Enigmatic
- Persian
- Arabic (Major Locrian)
- Japanese (Hirajoshi)
- In-Sen
- Iwato

#### Melodic Minor Modes
- Melodic Minor
- Dorian b2 (Phrygian #6)
- Lydian Augmented
- Lydian Dominant
- Mixolydian b6
- Locrian natural 2 (Half-Diminished)
- Super Locrian (Altered)

#### Harmonic Minor Modes
- Harmonic Minor
- Locrian natural 6
- Ionian Augmented
- Dorian #4 (Romanian)
- Phrygian Dominant
- Lydian #2
- Ultra Locrian

#### Bebop Scales
- Bebop Dominant
- Bebop Major
- Bebop Minor
- Bebop Dorian

### Chords

#### Triads
- Major, Minor, Diminished, Augmented
- Suspended 2nd, Suspended 4th

#### Seventh Chords
- Major 7th, Dominant 7th, Minor 7th
- Minor Major 7th, Diminished 7th
- Half Diminished 7th, Augmented 7th
- Augmented Major 7th

#### Extended Chords
- Major/Dominant/Minor 9th
- Major/Dominant/Minor 11th
- Major/Dominant/Minor 13th

#### Altered Chords
- 7th flat 9, 7th sharp 9
- 7th flat 5, 7th sharp 5
- Add 9, Minor Add 9
- 6th, Minor 6th

### Circle of Fifths
- Collapsible drawer, reachable from the header on the pages that read the key
- Three rings: key signatures outside, majors in the middle, relative minors inside
- Toggle between fifths and fourths — the same twelve positions read the other way round
- Clicking a key sets it for the fretboard and the progression composer at once
- Choosing G♭ puts the app into flats and B into sharps, so the half you pick from
  selects the spelling as well as the pitch

### Progression Composer
- **Chord palette**: the seven diatonic chords of the current key, as Roman numerals
  over concrete chord names — turn the circle and the numerals hold while the names
  move underneath
- **Borrowed chords and secondary dominants**: ♭II, ♭III, iv, ♭VI, ♭VII and V/V, V/vi,
  V/IV, V/ii, V/iii, each labelled with its function rather than as a raw chord symbol
- **Alternates row**: every named quality on the selected chord's own root
- **Progression strip**: click chords into a timeline; drag to reorder, drag an edge to
  resize
- **Piano roll**: free timing and velocity — drag notes in pitch and time, resize them,
  draw a rhythm
- **Edits survive a key change**: the roll tracks which dimensions you own, so a groove
  written in C keeps its rhythm when you switch to A minor while the chords re-voice
  underneath it
- **Loop playback**: edits are applied when the loop turns over, so the next pass plays
  what you see
- **Notation preview**: the progression engraved as sheet music, ties across bar lines
  and all
- The sounding chord lights up on the fretboard as the progression plays

### Sheet Music Composer
- Multi-track score editing with standard notation and guitar tab side by side
- Note entry directly on the staff or the tab
- Key and time signature changes, dynamics, repeats
- Score model shaped after Guitar Pro 7, engraved and played by alphaTab
- Undo/redo, and an alphaTex escape hatch for editing the source directly
- Export to MIDI and to a real `.gp` file

### Audio Transcription
- Drop in an audio file and get notation back
- Note detection with Spotify's Basic Pitch, run in a web worker so the page stays live
- Beat tracking, metrical-level inference, and quantisation into bars that sum exactly
- Harmonic suppression to drop partials the detector mistook for notes
- Review panel: correct the tempo, the downbeat and the metrical level, and toggle any
  suppressed note back in — discards are shown as ghost notes rather than hidden
- Optional server tier running the same model under ONNX Runtime

### Guitar Pro File Viewer
- **GP File Support**: Load and play Guitar Pro files (.gp, .gp3, .gp4, .gp5, .gpx)
- **Full Playback**: Play/pause, tempo control, seeking, and looping
- **Track Controls**: Mute/solo individual tracks
- **Scale Highlighting**: Highlight notes matching selected scales/chords
- **Drag & Drop**: Easy file loading via drag-and-drop or file dialog
- **Save to Library**: Store GP files locally for quick access

### GP Library
- **Local Storage**: IndexedDB-backed library for storing Guitar Pro files
- **Metadata Display**: View title, artist, album, tempo, and track count
- **Search & Filter**: Find files by name or metadata
- **Quick Loading**: Open files directly from library into viewer

### Audio Playback
- **Guitar/Bass**: Authentic bass guitar sound with FM synthesis
  - Optimized harmonicity and modulation for bass-like timbre
  - 3-band EQ (bass boost, mid/high cut)
  - Compression for punchy sound
  - Reverb for depth
- **Piano**: Realistic piano sound with polyphonic capability
  - Polyphonic synthesizer (play multiple notes simultaneously)
  - Piano-specific envelope (quick attack, long release)
  - Reverb for ambience
  - Register-sensitive sustain (longer for lower notes)
- Play scales/modes with ergonomic finger positioning (4-fret hand position for guitar/bass)
- Play chords as arpeggios
- Audio synthesis powered by Tone.js
- Visual note highlighting during playback

### Nashville Number System
- Toggle Nashville numbers on/off
- Display intervals relative to the root note
- Visible on both fretboard and keyboard displays
- Helpful for understanding scale degrees and transposition

### Keyboard-Specific Features
- 61-key keyboard optimized for 1080p screens (default)
- Keyboard size selector for different screen sizes and preferences
- Black keys displayed at top, white keys extend downward (standard piano layout)
- Note names and octave numbers visible on white keys
- Color-coded highlighting matches fretboard (root = red, in-mode = blue)
- Horizontal scrolling for larger keyboards (88-key)

## Tech Stack

### Frontend (Client)
- **Framework**: Angular 21, standalone components, TypeScript 5.9 in strict mode
- **State**: RxJS 7.8
- **Audio**: Tone.js 15 for sound synthesis
- **Sheet Music**: alphaTab 1.8 for engraving and playback
- **Note detection**: Spotify Basic Pitch, running on TensorFlow.js in a web worker
- **Styling**: SCSS with responsive design

### Backend (Server)
- **Framework**: ASP.NET Core 10 (C#)
- **Architecture**: RESTful API
- **Data**: Entity Framework Core with SQL Server
- **Auth**: ASP.NET Identity with JWT bearer tokens

## Getting Started

### Prerequisites
- Node.js 20 or higher
- npm
- .NET SDK 10.0
- Docker, for the development database (or your own SQL Server)

### Client Setup

1. Navigate to the client directory:
   ```bash
   cd client
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   ng serve
   ```

4. Open your browser to `http://localhost:4200`

### Server Setup

1. Navigate to the server directory:
   ```bash
   cd server
   ```

2. Restore dependencies:
   ```bash
   dotnet restore
   ```

3. Start a database:
   ```bash
   cp .env.example .env
   ```
   Put a password in `.env` — SQL Server wants 8+ characters from three of
   uppercase, lowercase, digits and symbols — then:
   ```bash
   docker compose up -d
   ```
   `.env` is gitignored. The first start takes a minute or so while SQL Server
   initialises; `docker compose ps` shows when it reports healthy.

4. Provide the two settings that are not in source control.

   The database connection string and the JWT signing key are deliberately
   absent from `appsettings.json`, so that neither can be committed and no
   placeholder key can quietly reach production. The app fails at startup with
   a message naming the missing setting rather than starting in a broken state.

   For the Docker database above, this reads the password out of `.env` and
   writes both settings to
   [user secrets](https://learn.microsoft.com/aspnet/core/security/app-secrets),
   which live outside the repository:
   ```bash
   pwsh -File ./scripts/set-local-secrets.ps1
   ```

   To point somewhere else, set them by hand instead:
   ```bash
   cd MusicTheory.API
   dotnet user-secrets set "ConnectionStrings:DefaultConnection" "Server=YOUR_SERVER,1433;Database=MusicTheoryDb;User Id=YOUR_LOGIN;Password=YOUR_PASSWORD;TrustServerCertificate=True"
   dotnet user-secrets set "Jwt:Key" "A_RANDOM_STRING_OF_AT_LEAST_32_CHARACTERS"
   ```

   In a deployment, set the same two as environment variables instead —
   `ConnectionStrings__DefaultConnection` and `Jwt__Key`.

   Against a shared server, use a least-privilege SQL login rather than `sa`:
   the application needs `db_datareader`, `db_datawriter` and rights to run
   migrations on one database, and nothing else. The Docker setup uses `sa`
   because the container is disposable and reachable only from this machine.

5. Run the application:
   ```bash
   dotnet run
   ```

## Project Structure

```
MusicTheory/
├── client/                          # Angular 21 frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/          # UI components
│   │   │   │   ├── fretboard/       # Main fretboard/keyboard component
│   │   │   │   ├── keyboard/        # Piano keyboard component
│   │   │   │   ├── circle-of-fifths/# App-wide key selector
│   │   │   │   ├── progression/     # Progression composer: palette, strip,
│   │   │   │   │                    #   piano roll, transport, notation
│   │   │   │   ├── composer/        # Sheet music composer
│   │   │   │   ├── transcription/   # Audio transcription and its review panel
│   │   │   │   ├── gp-viewer/       # Guitar Pro file viewer
│   │   │   │   └── gp-library/      # GP file library browser
│   │   │   ├── models/              # TypeScript interfaces (auth, user, music,
│   │   │   │                        #   composer, progression, transcription)
│   │   │   ├── services/            # Music theory, harmony, voicing, playback,
│   │   │   │                        #   detection, auth, alphaTab
│   │   │   ├── workers/             # Web worker for note detection
│   │   │   ├── guards/              # Route guards (auth, role)
│   │   │   └── interceptors/        # HTTP interceptor for JWT
│   │   ├── environments/            # Environment configs
│   │   └── assets/
│   └── package.json
│
├── server/                          # ASP.NET Core 10 backend
│   └── MusicTheory.API/
│       ├── Controllers/             # Auth, Users (+ future endpoints)
│       ├── Data/                    # DbContext
│       ├── Models/
│       │   ├── Entities/            # Domain models (User, Profile, etc.)
│       │   ├── DTOs/                # Request/response DTOs
│       │   └── Enums/               # UserRole, EnrollmentStatus, etc.
│       ├── Services/                # JWT, Auth, User services
│       └── Migrations/              # EF Core migrations
│
└── docs/                            # Documentation
    ├── ROADMAP.md                   # Development progress tracker
    └── plans/                       # Design documents and implementation plans
```

## Usage

1. **Select an Instrument**: Choose between Guitar, Bass Guitar, or Piano/Keyboard
2. **Configure Instrument**:
   - For Guitar/Bass: Set the number of strings and tuning
   - For Piano: Select keyboard size (25, 37, 49, 61, or 88 keys)
3. **Choose a Key**: Select the root note (C, C#, D, etc.)
4. **Select Category**: Pick from scales, modes, or chord types
5. **Choose Scale/Chord**: Select the specific scale or chord to display
6. **Toggle Nashville Numbers**: Optional display of interval numbers
7. **Play**: Click the Play button to hear the scale or chord
8. **Explore**: Click individual notes on the fretboard or keys on the keyboard to hear them

### The other pages

The header switches between six views, and the **Circle of Fifths** drawer sets the key
for the ones that read it:

| Page | What it is for |
|---|---|
| **Fretboard** | The scale and chord explorer above |
| **Composer** | Writing sheet music from scratch, notation and tab |
| **Progression** | Building a chord progression and editing its notes in a piano roll |
| **Transcribe** | Turning an audio file into notation |
| **GP Viewer** | Reading and playing a Guitar Pro file |
| **GP Library** | The Guitar Pro files you have saved |

A quick tour of the progression composer: open the **Circle of Fifths** and pick a key,
click a few chords from **Chords in this key** to build a progression, press **Play** with
**Loop** on, then drag a note in the roll and watch the change arrive on the next pass.
Change the key while it plays and the chords follow it while your rhythm stays put.

## Recent Updates

### Progression Composer (September 2026)
- ✨ **New**: Progression composer at `/progression` — diatonic chord palette, a
  drag-and-drop progression strip, and a piano roll with free timing and velocity
- ✨ **New**: Borrowed chords (♭II, ♭III, iv, ♭VI, ♭VII) and secondary dominants
  (V/V, V/vi, V/IV, V/ii, V/iii), each named by its function
- ✨ **New**: Per-aspect edit protection — a key change re-voices the chords you did not
  touch and transposes the ones you did, so a hand-drawn rhythm survives it
- ✨ **New**: Notation preview of a progression, with ties across bar lines
- 🎵 **Enhanced**: Playback applies edits at the loop boundary, so a change is audible on
  the next pass rather than clicking mid-chord
- 🎸 **Enhanced**: The fretboard lights up the sounding chord during playback, and gives
  back your own key when it stops
- 🐛 **Fixed**: A heptatonic minor now engraves the key signature it actually has
- 🧪 **Tests**: 1,855 passing

### Circle of Fifths (September 2026)
- ✨ **New**: Circle of fifths drawer that selects the key for the whole app, with key
  signatures, majors and relative minors in three rings, and a fourths toggle
- 🐛 **Fixed**: A minor key is now spelled from its own signature rather than the scale's
  default, so E minor stops coming back with a G♭ in it

### Audio Transcription (September 2026)
- ✨ **New**: Transcription page at `/transcribe` — drop in audio, get notation
- ✨ **New**: Note detection with Spotify Basic Pitch in a web worker, beat tracking, and
  quantisation into bars that sum exactly
- ✨ **New**: Harmonic suppression, with every discarded note shown as a ghost you can
  toggle back in rather than silently dropped
- ✨ **New**: Review panel for correcting tempo, downbeat and metrical level
- ✨ **New**: Optional server tier running the same model under ONNX Runtime

### Sheet Music Composer (September 2026)
- ✨ **New**: Composer page at `/composer` — multi-track scores with notation and tab,
  key and time signature changes, dynamics and repeats
- ✨ **New**: Note entry directly on the staff and on the tab
- ✨ **New**: Export to MIDI and to a real `.gp` file, with an alphaTex escape hatch

### SaaS Platform - Phase 1 Complete (January 2026)
- 🚀 **Backend**: ASP.NET Core 9 API with Identity and JWT authentication
- 🔐 **Auth System**: Register, login, refresh tokens, logout
- 👥 **User Profiles**: Teacher and student profiles with role-based access
- 📊 **Database**: Entity Framework Core 9 with SQL Server
- 🔗 **API Endpoints**: Auth controller, Users controller with /me endpoint
- 🅰️ **Angular Integration**: Auth service, HTTP interceptor, route guards
- 📋 **Next Phase**: Teacher-student core (invitations, courses, lessons)

### Version 2.1 (January 2026)
- ✨ **New**: Guitar Pro File Viewer with alphaTab integration
- ✨ **New**: GP Library for storing and managing Guitar Pro files locally
- ✨ **New**: Scale/chord highlighting on GP sheet music
- ✨ **New**: Full playback controls (play/pause, tempo, seeking, looping)
- ✨ **New**: Track mute/solo controls for multi-track GP files
- ⬆️ **Upgraded**: Angular 19 → 21
- 🔧 **Technical**: Custom webpack configuration for alphaTab WebWorkers

### Version 2.0 (December 2025)
- ✨ **New**: Piano/Keyboard instrument support with 5 keyboard sizes
- ✨ **New**: Realistic piano sound synthesis with polyphonic capability
- ✨ **New**: Modern side navigation interface with collapsible sidebar
- ✨ **New**: Context-sensitive controls (shows only relevant options per instrument)
- 🎨 **Improved**: Responsive design optimized for different screen sizes
- 🎨 **Improved**: 61-key keyboard as default for optimal 1080p display
- 🎵 **Enhanced**: Authentic bass guitar sound with professional effects chain
- 🐛 **Fixed**: Octave calculation for accurate note frequencies across all instruments

## Contributing

Contributions are welcome! Before contributing, please note:

1. **Read the [Contributor License Agreement](CLA.md)** - By submitting a pull request, you agree to grant the project owner rights to your contributions
2. **Fork the repository** and create your branch from `main`
3. **Follow existing code style** and patterns in the codebase
4. **Test your changes** thoroughly before submitting
5. **Submit a pull request** with a clear description of your changes

### Why a CLA?

This project may be commercialized in the future. The CLA ensures the project owner can continue to develop and potentially monetize the software while still accepting community contributions.

## License

This project is licensed under the **MIT License with Commons Clause**.

This means you can:
- View, fork, and modify the code
- Use it for personal and educational purposes
- Contribute improvements back to the project

However, you **cannot**:
- Sell the software or derivatives
- Offer paid hosting or services based on this software
- Commercially exploit the software without permission

See the [LICENSE](LICENSE) file for full details.
