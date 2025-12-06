# Interactive Music Theory

A comprehensive web application for exploring scales, modes, chords, and music theory concepts on guitar and bass guitar fretboards.

## Features

### Interactive Fretboard
- Visual fretboard display with 16 frets (0-15)
- Click on notes to hear them played
- Real-time highlighting of notes being played
- Root notes highlighted in red, scale/chord tones in blue

### Instrument Support
- **Guitar**: 6, 7, and 8 string configurations
- **Bass Guitar**: 4, 5, and 6 string configurations

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

### Audio Playback
- Play scales/modes with ergonomic finger positioning (4-fret hand position)
- Play chords as arpeggios
- Audio synthesis powered by Tone.js
- Visual note highlighting during playback

### Nashville Number System
- Toggle Nashville numbers on/off
- Display intervals relative to the root note
- Helpful for understanding scale degrees and transposition

## Tech Stack

### Frontend (Client)
- **Framework**: Angular 19
- **Audio**: Tone.js for sound synthesis
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

3. Run the application:
   ```bash
   dotnet run
   ```

## Project Structure

```
MusicTheory/
├── client/                          # Angular frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/
│   │   │   │   └── fretboard/       # Main fretboard component
│   │   │   ├── models/              # TypeScript interfaces
│   │   │   └── services/            # Music theory service
│   │   ├── assets/
│   │   └── styles.css
│   ├── angular.json
│   └── package.json
│
└── server/                          # C# backend
    ├── MusicTheory.API/
    │   ├── Controllers/
    │   ├── Models/
    │   └── Services/
    └── MusicTheory.sln
```

## Usage

1. **Select an Instrument**: Choose between Guitar or Bass Guitar
2. **Configure Strings & Tuning**: Set the number of strings and tuning
3. **Choose a Key**: Select the root note (C, C#, D, etc.)
4. **Select Category**: Pick from scales, modes, or chord types
5. **Choose Scale/Chord**: Select the specific scale or chord to display
6. **Play**: Click the Play button to hear the scale or chord
7. **Explore**: Click individual notes on the fretboard to hear them

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
