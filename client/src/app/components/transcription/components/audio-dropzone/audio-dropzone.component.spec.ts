import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AudioDropzoneComponent } from './audio-dropzone.component';

/** A file of `bytes` zero bytes, named and typed as asked. */
function makeFile(name: string, type: string, bytes = 2048): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function makeAudioFile(): File {
  return makeFile('bass.wav', 'audio/wav');
}

/** Chrome can construct a `DataTransfer`, which is what makes drops testable. */
function transferOf(...files: File[]): DataTransfer {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  return transfer;
}

describe('AudioDropzoneComponent', () => {
  let fixture: ComponentFixture<AudioDropzoneComponent>;
  let component: AudioDropzoneComponent;
  let emitted: File[];

  /** The element carrying the drag handlers. */
  function zone(): HTMLElement {
    return fixture.nativeElement.querySelector('.dropzone') as HTMLElement;
  }

  function fileInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
  }

  function messageText(): string {
    const message = fixture.nativeElement.querySelector('.dropzone__message');
    return message ? (message.textContent ?? '').trim() : '';
  }

  /** Drives the path a keyboard or mouse user takes through the file picker. */
  function chooseThroughInput(...files: File[]): void {
    const input = fileInput();
    input.files = transferOf(...files).files;
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  /** Drives the path a drag takes, on `target` so bubbling can be exercised. */
  function dragEvent(
    type: string,
    target: EventTarget,
    transfer: DataTransfer = new DataTransfer()
  ): DragEvent {
    const event = new DragEvent(type, {
      dataTransfer: transfer,
      bubbles: true,
      cancelable: true
    });
    target.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  function dropOnZone(...files: File[]): DragEvent {
    return dragEvent('drop', zone(), transferOf(...files));
  }

  function isHighlighted(): boolean {
    return zone().classList.contains('dropzone--active');
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AudioDropzoneComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(AudioDropzoneComponent);
    component = fixture.componentInstance;
    emitted = [];
    component.fileSelected.subscribe((file: File) => emitted.push(file));
    fixture.detectChanges();
  });

  describe('choosing a file', () => {
    it('emits the file picked through the input', () => {
      const file = makeAudioFile();

      chooseThroughInput(file);

      expect(emitted).toEqual([file]);
    });

    it('emits the file dropped on the zone', () => {
      const file = makeAudioFile();

      dropOnZone(file);

      expect(emitted).toEqual([file]);
    });

    it('shows the name and size of what was chosen', () => {
      chooseThroughInput(makeFile('take-3.wav', 'audio/wav', 1536));

      const name = fixture.nativeElement.querySelector('.dropzone__file-name');
      const size = fixture.nativeElement.querySelector('.dropzone__file-size');

      expect((name.textContent ?? '').trim()).toBe('take-3.wav');
      expect((size.textContent ?? '').trim()).toBe('1.5 KB');
    });

    it('clears the input, so the same file can be picked a second time', () => {
      chooseThroughInput(makeAudioFile());

      // Without this the browser fires no `change` for a repeated pick, and the
      // second attempt looks to the user like the component ignored them.
      expect(fileInput().files?.length ?? 0).toBe(0);
    });
  });

  describe('refusing what is not audio', () => {
    it('says so rather than swallowing a file picked through the input', () => {
      chooseThroughInput(makeFile('notes.pdf', 'application/pdf'));

      expect(emitted).toEqual([]);
      expect(messageText()).toContain('notes.pdf');
    });

    it('says so rather than swallowing a dropped file', () => {
      dropOnZone(makeFile('cover.png', 'image/png'));

      expect(emitted).toEqual([]);
      expect(messageText()).toContain('cover.png');
    });

    it('marks the refusal as an error, unlike an ordinary note', () => {
      dropOnZone(makeFile('cover.png', 'image/png'));

      const message = fixture.nativeElement.querySelector(
        '.dropzone__message'
      ) as HTMLElement;
      expect(message.classList.contains('dropzone__message--error')).toBeTrue();
    });

    it('keeps the file already accepted, which the caller still holds', () => {
      const good = makeAudioFile();
      chooseThroughInput(good);

      dropOnZone(makeFile('cover.png', 'image/png'));

      expect(component.selectedFile).toBe(good);
      expect(emitted).toEqual([good]);
    });

    it('says so when a drop carries no file at all', () => {
      dragEvent('drop', zone(), new DataTransfer());

      expect(emitted).toEqual([]);
      expect(messageText()).not.toBe('');
    });
  });

  // `accept="audio/*"` only filters the file picker's default view: the user
  // can switch it to "All files", and a dropped file never passes through the
  // attribute at all. So the attribute cannot be the validation, and the two
  // paths have to be checked against the same rule in code.
  describe('the two paths agreeing', () => {
    const cases: ReadonlyArray<{ name: string; type: string; audio: boolean }> = [
      { name: 'bass.wav', type: 'audio/wav', audio: true },
      { name: 'bass.mp3', type: 'audio/mpeg', audio: true },
      // Windows and Linux routinely hand these over with no type at all.
      { name: 'bass.m4a', type: '', audio: true },
      { name: 'bass.flac', type: '', audio: true },
      { name: 'bass.aiff', type: '', audio: true },
      // Not audio, whichever way it arrives.
      { name: 'notes.pdf', type: 'application/pdf', audio: false },
      { name: 'cover.png', type: 'image/png', audio: false },
      { name: 'session.txt', type: 'text/plain', audio: false },
      // A dropped directory reaches `dataTransfer.files` looking like this.
      { name: 'Stems', type: '', audio: false }
    ];

    for (const testCase of cases) {
      it(`treats ${testCase.name || '(no name)'} the same either way`, () => {
        const throughInput = TestBed.createComponent(AudioDropzoneComponent);
        const throughDrop = TestBed.createComponent(AudioDropzoneComponent);
        const fromInput: File[] = [];
        const fromDrop: File[] = [];

        throughInput.componentInstance.fileSelected.subscribe((f: File) =>
          fromInput.push(f)
        );
        throughDrop.componentInstance.fileSelected.subscribe((f: File) =>
          fromDrop.push(f)
        );
        throughInput.detectChanges();
        throughDrop.detectChanges();

        const input = throughInput.nativeElement.querySelector(
          'input[type="file"]'
        ) as HTMLInputElement;
        input.files = transferOf(makeFile(testCase.name, testCase.type)).files;
        input.dispatchEvent(new Event('change'));

        const target = throughDrop.nativeElement.querySelector(
          '.dropzone'
        ) as HTMLElement;
        target.dispatchEvent(
          new DragEvent('drop', {
            dataTransfer: transferOf(makeFile(testCase.name, testCase.type)),
            bubbles: true,
            cancelable: true
          })
        );

        expect(fromInput.length).toBe(testCase.audio ? 1 : 0);
        expect(fromDrop.length).toBe(fromInput.length);
      });
    }
  });

  describe('more than one file', () => {
    it('takes the first dropped file and reports the rest as ignored', () => {
      const first = makeFile('bass.wav', 'audio/wav');
      const second = makeFile('drums.wav', 'audio/wav');

      dropOnZone(first, second);

      expect(emitted).toEqual([first]);
      expect(messageText()).toContain('1 other file was ignored');
    });

    it('does not offer a multiple picker', () => {
      expect(fileInput().hasAttribute('multiple')).toBeFalse();
    });
  });

  // The classic dropzone bug: `dragleave` fires on every child boundary the
  // pointer crosses, so clearing the highlight on any leave makes it strobe.
  // A depth counter, cleared only at zero, is what stops that.
  describe('the drag highlight', () => {
    it('lights up when a drag enters', () => {
      dragEvent('dragenter', zone());

      expect(isHighlighted()).toBeTrue();
    });

    it('stays lit while the drag crosses a child element', () => {
      const child = fixture.nativeElement.querySelector(
        '.dropzone__label'
      ) as HTMLElement;

      dragEvent('dragenter', zone());
      // Entering a child fires enter on the child and leave on the zone; both
      // bubble to the same handler.
      dragEvent('dragenter', child);
      dragEvent('dragleave', zone());

      expect(isHighlighted()).toBeTrue();
    });

    it('goes out only once the drag has left everything', () => {
      const child = fixture.nativeElement.querySelector(
        '.dropzone__label'
      ) as HTMLElement;

      dragEvent('dragenter', zone());
      dragEvent('dragenter', child);
      dragEvent('dragleave', zone());
      dragEvent('dragleave', child);

      expect(isHighlighted()).toBeFalse();
    });

    it('goes out on drop', () => {
      dragEvent('dragenter', zone());
      dropOnZone(makeAudioFile());

      expect(isHighlighted()).toBeFalse();
    });

    it('recovers if a stray leave arrives before any enter', () => {
      dragEvent('dragleave', zone());
      dragEvent('dragenter', zone());

      expect(isHighlighted()).toBeTrue();
    });
  });

  describe('the drop contract with the browser', () => {
    it('prevents the default on dragover, without which no drop is allowed', () => {
      const event = dragEvent('dragover', zone());

      expect(event.defaultPrevented).toBeTrue();
    });

    it('prevents the default on drop, without which the file just opens', () => {
      const event = dropOnZone(makeAudioFile());

      expect(event.defaultPrevented).toBeTrue();
    });
  });

  describe('reaching the control without a pointer', () => {
    it('gives the file input a real label', () => {
      const input = fileInput();
      const label = fixture.nativeElement.querySelector(
        `label[for="${input.id}"]`
      ) as HTMLLabelElement | null;

      expect(input.id).toBeTruthy();
      expect(label).not.toBeNull();
      expect((label?.textContent ?? '').trim().length).toBeGreaterThan(0);
    });

    it('asks the picker for audio', () => {
      expect(fileInput().getAttribute('accept')).toBe('audio/*');
    });

    it('describes the input with the hint and the message region', () => {
      const described = fileInput().getAttribute('aria-describedby') ?? '';
      const ids = described.split(/\s+/).filter(Boolean);

      expect(ids.length).toBe(2);
      for (const id of ids) {
        expect(fixture.nativeElement.querySelector(`#${id}`)).not.toBeNull();
      }
    });

    it('keeps the message region mounted so it can announce', () => {
      const region = fixture.nativeElement.querySelector(
        '.dropzone__message-region'
      ) as HTMLElement | null;

      expect(region).not.toBeNull();
      expect(region?.getAttribute('aria-live')).toBe('polite');
    });

    it('gives every instance its own ids, so labels stay unambiguous', () => {
      const second = TestBed.createComponent(AudioDropzoneComponent);
      second.detectChanges();

      expect(second.componentInstance.inputId).not.toBe(component.inputId);
    });
  });
});
