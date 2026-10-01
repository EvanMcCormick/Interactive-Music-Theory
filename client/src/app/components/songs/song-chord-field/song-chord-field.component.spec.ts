import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChordDegree, ProgressionKey } from '../../../models/progression.model';
import { SongChordFieldComponent, chordHintOf } from './song-chord-field.component';

const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const IONIAN = [0, 2, 4, 5, 7, 9, 11];

/**
 * The chord field: a text input that reads a chord name or a numeral in the song's key, says what it read as it is
 * typed, and hands the chord on at Enter - or at `]`, so `[Am]` typed in the ChordPro way works through it.
 */
describe('SongChordFieldComponent', () => {
  let fixture: ComponentFixture<SongChordFieldComponent>;
  let field: SongChordFieldComponent;
  let host: HTMLElement;
  let chosen: ChordDegree[];
  let cancelled: number;

  interface Opening {
    initial?: string;
    autofocus?: boolean;
    key?: ProgressionKey;
    scale?: readonly number[] | null;
  }

  function open(inputs: Opening = {}): void {
    fixture = TestBed.createComponent(SongChordFieldComponent);
    field = fixture.componentInstance;
    host = fixture.nativeElement;
    document.body.append(host);
    fixture.componentRef.setInput('key', inputs.key ?? C_MAJOR);
    fixture.componentRef.setInput('scaleIntervals', inputs.scale === undefined ? IONIAN : inputs.scale);
    if (inputs.initial !== undefined) fixture.componentRef.setInput('initial', inputs.initial);
    if (inputs.autofocus !== undefined) fixture.componentRef.setInput('autofocus', inputs.autofocus);
    chosen = [];
    cancelled = 0;
    field.chosen.subscribe(degree => chosen.push(degree));
    field.cancelled.subscribe(() => cancelled++);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SongChordFieldComponent] }).compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
    host?.remove();
  });

  const input = (): HTMLInputElement => {
    const found = host.querySelector<HTMLInputElement>('input');
    if (!found) throw new Error('No input');
    return found;
  };
  const hint = (): string => host.querySelector('.chord-field-hint')?.textContent?.trim() ?? '';
  const alerts = (): string => Array.from(host.querySelectorAll('[role="alert"]')).map(el => el.textContent ?? '').join('');

  /** Types `text` as the browser reports it: the value, then an input event carrying what was typed. */
  function type(text: string): void {
    input().value = text;
    input().dispatchEvent(new InputEvent('input', { data: text.slice(-1), inputType: 'insertText' }));
    fixture.detectChanges();
  }

  function press(key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    input().dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  describe('chordHintOf', () => {
    it('names a chord it reads both ways, name and numeral', () => {
      expect(chordHintOf('Am', C_MAJOR, IONIAN)).toEqual(jasmine.objectContaining({ kind: 'chord', text: 'Am · vi' }));
      expect(chordHintOf('vi', C_MAJOR, IONIAN)).toEqual(jasmine.objectContaining({ kind: 'chord', text: 'Am · vi' }));
      expect(chordHintOf('Bb', C_MAJOR, IONIAN)).toEqual(jasmine.objectContaining({ kind: 'chord', text: 'Bb · ♭VII' }));
      expect(chordHintOf('F/A', C_MAJOR, IONIAN)).toEqual(jasmine.objectContaining({ kind: 'chord', text: 'F/A · IV' }));
    });

    it('gives the reason for text it cannot read, and a prompt for none', () => {
      expect(chordHintOf('H7', C_MAJOR, IONIAN)).toEqual({
        kind: 'refused',
        text: jasmine.stringMatching(/"H7?" is not a note/)
      });
      expect(chordHintOf('  ', C_MAJOR, IONIAN)).toEqual({ kind: 'empty', text: jasmine.stringMatching(/such as Am/) });
    });
  });

  it('is a labelled text input, described by its hint, and not a combobox', () => {
    open();
    expect(input().type).toBe('text');
    expect(input().getAttribute('aria-label')).toBe('Chord name or numeral');
    expect(input().getAttribute('role')).toBeNull();
    const described = input().getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(document.getElementById(described ?? '')?.textContent).toContain('such as Am');
  });

  it('shows the chord it would place as it is typed, or why not', () => {
    open();
    type('A');
    expect(hint()).toBe('A · VI');
    type('Am');
    expect(hint()).toBe('Am · vi');
    type('Am/');
    expect(hint()).toMatch(/not a chord type/);
    expect(host.querySelector('.chord-field-hint')?.classList).toContain('is-refused');
  });

  it('hands on the chord at Enter, and takes the key', () => {
    open();
    type('Am');
    const enter = press('Enter');

    expect(enter.defaultPrevented).toBeTrue();
    expect(chosen.length).toBe(1);
    expect(chosen[0]).toEqual(jasmine.objectContaining({ degree: 5, alter: 0, extent: 3 }));
  });

  it('keeps a refused text, marks it invalid and says why aloud, handing nothing on', () => {
    open();
    type('Xm');
    press('Enter');

    expect(chosen).toEqual([]);
    expect(input().value).toBe('Xm');
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(alerts()).toMatch(/"Xm" is not a note/);

    type('Dm');
    expect(input().getAttribute('aria-invalid')).toBe('false');
  });

  it('says a refusal again when Enter is pressed on it again', () => {
    open();
    type('Xm');
    press('Enter');
    const first = Array.from(host.querySelectorAll('[role="alert"]')).map(el => el.textContent);
    press('Enter');
    const second = Array.from(host.querySelectorAll('[role="alert"]')).map(el => el.textContent);
    expect(second).not.toEqual(first);
    expect(alerts()).toMatch(/is not a note/);
  });

  it('treats a closing bracket as Enter, so [Am] typed the ChordPro way places Am', () => {
    open();
    type('Am]');

    expect(chosen.length).toBe(1);
    expect(chosen[0].degree).toBe(5);
    expect(input().value).toBe('Am');
  });

  it('keeps the field open on a refused closing bracket, without the bracket', () => {
    open();
    type('Hm]');

    expect(chosen).toEqual([]);
    expect(input().value).toBe('Hm');
    expect(alerts()).toMatch(/is not a note/);
  });

  it('is cancelled by Escape, which goes no further', () => {
    open();
    const outer = jasmine.createSpy('outer');
    document.addEventListener('keydown', outer);
    type('Am');
    const escape = press('Escape');
    document.removeEventListener('keydown', outer);

    expect(cancelled).toBe(1);
    expect(chosen).toEqual([]);
    expect(escape.defaultPrevented).toBeTrue();
    expect(outer).not.toHaveBeenCalled();
  });

  it('starts from the text it is given, selected, when asked to take the focus', () => {
    open({ initial: 'Am', autofocus: true });

    expect(document.activeElement).toBe(input());
    expect(input().value).toBe('Am');
    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe(2);
    expect(hint()).toBe('Am · vi');
  });

  it('starts again from new text when it is given some', () => {
    open({ initial: 'Am' });
    type('Xm');
    fixture.componentRef.setInput('initial', 'F');
    fixture.detectChanges();

    expect(input().value).toBe('F');
    expect(hint()).toBe('F · IV');
  });

  it('refuses every chord in a key that cannot build them', () => {
    open({ scale: null });
    type('Am');
    expect(hint()).toMatch(/can't build chords/);
    press('Enter');
    expect(chosen).toEqual([]);
  });
});
