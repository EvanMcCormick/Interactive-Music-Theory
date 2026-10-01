import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * A song's sheet, at `/songs/:id` (design Part 2): the page the library's cards open.
 *
 * So far it is the page's frame alone - the way back to the library, and the line it shows while the song is read -
 * so the route, the library's links and the nav can be built and checked against the component that will hold the
 * editor, under the name and in the folder it keeps. The editor itself, its toolbar and its side panel grow in this
 * file.
 */
@Component({
  selector: 'app-song-editor',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './song-editor.component.html',
  styleUrls: ['./song-editor.component.scss']
})
export class SongEditorComponent {}
