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
- **Framework**: Angular 21
- **Audio**: Tone.js for sound synthesis
- **Sheet Music**: alphaTab for Guitar Pro file rendering and playback
- **Styling**: SCSS with responsive design

### Backend (Server)
- **Framework**: ASP.NET Core (C#)
- **Architecture**: RESTful API

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm
- .NET SDK (6.0 or higher)

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
│   │   │   │   ├── gp-viewer/       # Guitar Pro file viewer
│   │   │   │   └── gp-library/      # GP file library browser
│   │   │   ├── models/              # TypeScript interfaces (auth, user, music)
│   │   │   ├── services/            # Music theory, auth, alphaTab services
│   │   │   ├── guards/              # Route guards (auth, role)
│   │   │   └── interceptors/        # HTTP interceptor for JWT
│   │   ├── environments/            # Environment configs
│   │   └── assets/
│   └── package.json
│
├── server/                          # ASP.NET Core 9 backend
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

## Recent Updates

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
