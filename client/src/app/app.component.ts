import { Component } from '@angular/core';
import { FretboardComponent } from './components/fretboard/fretboard.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  standalone: true,
  imports: [FretboardComponent]
})
export class AppComponent {
  title = 'MusicTheory';
}