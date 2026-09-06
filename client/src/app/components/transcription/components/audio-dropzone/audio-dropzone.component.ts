import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output
} from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Picks the audio file a transcription starts from.
 *
 * The control that does the work is an ordinary `<input type="file">` with an
 * ordinary `<label for>`; the drop zone is painted around it. That order
 * matters. A drop target is a mouse-only affordance — there is no keyboard
 * gesture for dragging — so a component built as a drop zone with a file input
 * bolted on is unusable without a pointer. Built this way round it is a working
 * file picker that also happens to accept a drop.
 *
 * The input is hidden with `clip-path` rather than `display: none`, which is
 * the difference between "not drawn" and "not there": a `display: none` input
 * leaves the tab order, so the label still opens the picker on click while
 * keyboard users can no longer reach the control at all. Clipped, it keeps its
 * place in the tab order and its accessible name from the label; the focus ring
 * is drawn on the label instead (see the SCSS).
 *
 * Nothing here decodes anything. The file is emitted and the caller decides.
 */

/**
 * Extensions treated as audio when the browser's own MIME guess does not say so.
 *
 * `File.type` comes from the platform's extension-to-MIME registry and is
 * routinely empty or wrong: `.m4a`, `.aiff` and `.flac` all report differently
 * across Windows, macOS and Linux, and a file with no extension reports nothing
 * at all. Refusing on MIME alone would turn away files the decoder would have
 * handled.
 */
const AUDIO_EXTENSIONS: readonly string[] = [
  '.wav',
  '.wave',
  '.mp3',
  '.m4a',
  '.m4b',
  '.aac',
  '.aif',
  '.aiff',
  '.aifc',
  '.flac',
  '.ogg',
  '.oga',
  '.opus',
  '.weba',
  '.caf',
  '.wma',
  '.au'
];

/** Distinguishes ids when more than one dropzone is on a page. */
let instanceCount = 0;

/**
 * True when `file` is worth handing to the decoder.
 *
 * The rule is one `or`: the browser called it audio, **or** the name ends in an
 * extension we recognise. Deliberately permissive — `decodeAudioData` is the
 * real arbiter and rejects with `EncodingError` when it cannot read a file, so
 * this check exists only to catch the obvious mistake (a screenshot, a PDF)
 * before a multi-second decode, not to be the gatekeeper. Being strict here
 * would refuse valid files for free; being loose costs one failed decode.
 *
 * Exported so the rule can be asserted directly, and so a second entry point
 * would reuse it rather than grow a rival. Both of this component's own paths —
 * the input and the drop — go through it, which is the point: `accept="audio/*"`
 * only filters the file picker's default view, and does nothing whatsoever for
 * a dropped file, so neither path can lean on the attribute for validation.
 */
export function isProbablyAudio(file: File): boolean {
  if (file.type.toLowerCase().startsWith('audio/')) return true;

  const name = file.name.toLowerCase();
  return AUDIO_EXTENSIONS.some(extension => name.endsWith(extension));
}

/** Formats a byte count the way a file manager would. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(1)} ${units[unit]}`;
}

/** Whether the message under the control is a refusal or just a note. */
export type DropzoneMessageKind = 'error' | 'info';

@Component({
  selector: 'app-audio-dropzone',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './audio-dropzone.component.html',
  styleUrls: ['./audio-dropzone.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AudioDropzoneComponent {
  @Output() readonly fileSelected = new EventEmitter<File>();

  private readonly instance = ++instanceCount;

  readonly inputId = `audio-dropzone-input-${this.instance}`;
  readonly hintId = `audio-dropzone-hint-${this.instance}`;
  readonly messageId = `audio-dropzone-message-${this.instance}`;

  /** The hint and the message both describe the input; the label names it. */
  readonly describedBy = `${this.hintId} ${this.messageId}`;

  /** The last file that passed the check, so its name and size can be shown. */
  selectedFile: File | null = null;
  selectedSize = '';

  message: string | null = null;
  messageKind: DropzoneMessageKind = 'info';

  /** Drives the visible "a file is over me" state. */
  isDragActive = false;

  /**
   * How many nested elements the drag is currently inside.
   *
   * `dragleave` fires on every child boundary the pointer crosses, not only
   * when the drag leaves the zone, so clearing the highlight on any `dragleave`
   * makes it strobe as the pointer passes over the label and the hint text.
   * Counting enters against leaves and clearing only at zero is the fix: moving
   * from the zone into a child is an enter followed by a leave, so the count
   * dips to one rather than to nothing.
   *
   * `onDragOver` re-asserts the state as a second line of defence, since
   * `dragover` keeps firing the whole time the pointer is over the zone. That
   * keeps the highlight correct even in a browser that ordered the enter and
   * the leave the other way round.
   */
  private dragDepth = 0;

  onDragEnter(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth += 1;
    this.isDragActive = true;
  }

  /**
   * Marks the zone as a drop target.
   *
   * Without `preventDefault` here the browser refuses the drop and opens the
   * file instead, which is the default action for a file dropped on a page.
   */
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.isDragActive = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    this.isDragActive = this.dragDepth > 0;
  }

  /**
   * Takes the first dropped file and says what happened to the rest.
   *
   * Propagation stops here because the file has been consumed; an ancestor drop
   * handler acting on the same drop would handle it a second time.
   */
  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragDepth = 0;
    this.isDragActive = false;

    const dropped = event.dataTransfer?.files;
    if (!dropped || dropped.length === 0) {
      // Dragged text, a link, or a drop the browser exposed no file for.
      this.refuse('That drop contained no file this browser could read.');
      return;
    }

    this.offer(dropped[0], dropped.length - 1);
  }

  onInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const chosen = input.files;
    const file = chosen && chosen.length > 0 ? chosen[0] : null;
    const ignored = chosen ? chosen.length - 1 : 0;

    // Clearing the value means picking the *same* file again still fires
    // `change`, which otherwise does nothing at all on the second attempt.
    input.value = '';

    if (!file) return;
    this.offer(file, ignored);
  }

  /**
   * Applies the one audio rule and emits, or refuses with a reason.
   *
   * A refusal leaves any previously accepted file on screen. The caller still
   * holds that file, so clearing the display would show a state the rest of the
   * app is not in.
   */
  private offer(file: File, ignoredCount: number): void {
    if (!isProbablyAudio(file)) {
      this.refuse(
        `${file.name} does not look like audio. Choose a WAV, MP3, M4A, FLAC, OGG or AIFF file.`
      );
      return;
    }

    this.selectedFile = file;
    this.selectedSize = formatFileSize(file.size);
    this.messageKind = 'info';
    this.message =
      ignoredCount > 0
        ? `Using ${file.name}. ${ignoredCount} other ${
            ignoredCount === 1 ? 'file was' : 'files were'
          } ignored — one at a time.`
        : null;

    this.fileSelected.emit(file);
  }

  private refuse(reason: string): void {
    this.messageKind = 'error';
    this.message = reason;
  }
}
