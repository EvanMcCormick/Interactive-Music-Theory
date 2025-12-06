import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FretNote } from '../../models/music-theory.model';
import * as Tone from 'tone';

@Component({
  selector: 'app-keyboard',
  templateUrl: './keyboard.component.html',
  styleUrls: ['./keyboard.component.scss'],
  standalone: true,
  imports: [CommonModule]
})
export class KeyboardComponent implements OnInit, OnDestroy {
  @Input() keys: FretNote[] = [];
  @Input() showNashvilleNumbers = false;

  private pianoInstrument: Tone.PolySynth;
  private reverb: Tone.Reverb;
  private volume: Tone.Volume;
  private currentlyPlayingKey: number | null = null;

  constructor() {
    // Create a polyphonic synthesizer for piano
    this.volume = new Tone.Volume(-6);
    
    // Create reverb for piano ambience
    this.reverb = new Tone.Reverb({
      decay: 2.5,
      wet: 0.15
    });

    // Create piano instrument with PolySynth for polyphony
    this.pianoInstrument = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: 'sine'
      },
      envelope: {
        attack: 0.005,
        decay: 0.3,
        sustain: 0.2,
        release: 1.5
      }
    });

    // Connect audio chain: piano → reverb → volume → destination
    this.pianoInstrument.connect(this.reverb);
    this.reverb.connect(this.volume);
    this.volume.toDestination();
  }

  ngOnInit(): void {}

  ngOnDestroy(): void {
    // Clean up audio resources
    if (this.pianoInstrument) {
      this.pianoInstrument.releaseAll();
      this.pianoInstrument.disconnect();
      this.pianoInstrument.dispose();
    }
    if (this.reverb) {
      this.reverb.disconnect();
      this.reverb.dispose();
    }
    if (this.volume) {
      this.volume.disconnect();
      this.volume.dispose();
    }
  }

  onKeyClick(keyIndex: number, key: FretNote): void {
    if (Tone.context.state !== 'running') {
      Tone.context.resume();
    }

    // Highlight the key briefly
    this.currentlyPlayingKey = keyIndex;
    setTimeout(() => {
      this.currentlyPlayingKey = null;
    }, 300);

    this.playNote(key.noteName, key.octave);
  }

  playNote(noteName: string, octave: number): void {
    // Clean note name for Tone.js
    const cleanNoteName = this.cleanNoteNameForTone(noteName);
    
    console.log(`Playing piano note: ${cleanNoteName}${octave}`);
    
    // Add slight randomization to velocity for more human feel
    const velocity = 0.5 + Math.random() * 0.5;
    
    // Piano notes have varying sustain based on register
    const duration = octave <= 2 ? '2n' : octave <= 4 ? '4n' : '8n';
    
    this.pianoInstrument.triggerAttackRelease(`${cleanNoteName}${octave}`, duration, undefined, velocity);
  }

  private cleanNoteNameForTone(noteName: string): string {
    // Handle note names with slashes (e.g., "C#/Db" -> "C#")
    if (noteName.includes('/')) {
      return noteName.split('/')[0];
    }
    return noteName;
  }

  isBlackKey(noteName: string): boolean {
    // Black keys are sharps/flats
    return noteName.includes('#') || noteName.includes('b');
  }

  isKeyPlaying(keyIndex: number): boolean {
    return this.currentlyPlayingKey === keyIndex;
  }
}
