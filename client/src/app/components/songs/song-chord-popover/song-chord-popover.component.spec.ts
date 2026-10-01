import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Node } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import type { TimeSignature } from '../../../models/composer.model';
import { createExtensions } from '../../../models/progression-normalize';
import { ChordDegree, ProgressionKey } from '../../../models/progression.model';
import { ChordAtomAttrs } from '../../../models/song.model';
import { MusicTheoryService } from '../../../services/music-theory.service';
import { ProgressionKeyContext } from '../../../services/progression-key-context';
import { SongEdit, chordWithId } from '../../../services/song-commands';
import { chordSlotOf } from '../../../services/song-document';
import { songEditorPlugins } from '../../../services/song-editor-plugins';
import { songSchema } from '../../../services/song-schema';
import { SongChordPopoverComponent } from './song-chord-popover.component';

const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };
const THREE_FOUR: TimeSignature = { numerator: 3, denominator: 4, isCommon: false };

function degreeAt(degree: number): ChordDegree {
  return {
    degree,
    alter: 0,
    extent: 3,
    quality: null,
    inversion: 0,
    suspension: 'none',
    extensions: createExtensions(),
    octave: 0
  };
}

/** A song of one line, "Wondering", with Am over its W - two beats long, so a change that kept the bar would show. */
function songWith(am: ChordAtomAttrs, timeSignature: TimeSignature = FOUR_FOUR): Node {
  return songSchema.node('doc', { title: '', artist: '', key: C_MAJOR, tempo: 100, timeSignature }, [
    songSchema.node('section', { id: 's1', label: 'Verse 1', kind: 'verse' }, [
      songSchema.node('lyricLine', null, [songSchema.node('chord', am), songSchema.text('Wondering')])
    ])
  ]);
}

/**
 * The chord popover, against a real editor state: each edit it hands out is run on that state, as the page runs it on
 * the sheet, and the document that comes back is given to the popover again - so what it shows after a press is what
 * the song now says.
 */
describe('SongChordPopoverComponent', () => {
  const keys = new ProgressionKeyContext(new MusicTheoryService());
  let fixture: ComponentFixture<SongChordPopoverComponent>;
  let popover: SongChordPopoverComponent;
  let host: HTMLElement;
  let state: EditorState;
  let closed: boolean[];
  let id: string;

  function open(timeSignature: TimeSignature = FOUR_FOUR): void {
    const am = { ...chordSlotOf(degreeAt(5), C_MAJOR, IONIAN, timeSignature), lengthBeats: 2 };
    id = am.id;
    state = EditorState.create({ doc: songWith(am, timeSignature), plugins: songEditorPlugins() });

    fixture = TestBed.createComponent(SongChordPopoverComponent);
    popover = fixture.componentInstance;
    host = fixture.nativeElement;
    document.body.append(host);
    fixture.componentRef.setInput('doc', state.doc);
    fixture.componentRef.setInput('chordId', id);
    fixture.componentRef.setInput('keys', keys);
    closed = [];
    popover.closed.subscribe(giveBack => closed.push(giveBack));
    popover.edit.subscribe((edit: SongEdit) => {
      const outcome = edit(state);
      if (outcome.kind !== 'edit') return;
      state = state.apply(outcome.tr);
      fixture.componentRef.setInput('doc', state.doc);
    });
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SongChordPopoverComponent] }).compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
    host?.remove();
  });

  function element<T extends HTMLElement>(selector: string): T {
    const found = host.querySelector<T>(selector);
    if (!found) throw new Error(`No ${selector} in the popover`);
    return found;
  }

  function press(selector: string): void {
    element<HTMLButtonElement>(selector).click();
    fixture.detectChanges();
  }

  const chordNow = (): ChordAtomAttrs | null => chordWithId(state.doc, id)?.attrs ?? null;
  const presets = (): HTMLButtonElement[] => Array.from(host.querySelectorAll<HTMLButtonElement>('.length-preset'));

  function typeChord(text: string): void {
    const input = element<HTMLInputElement>('.chord-field-input');
    input.value = text;
    input.dispatchEvent(new InputEvent('input', { data: text.slice(-1), inputType: 'insertText' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  it('is a labelled, non-modal dialog that opens with the focus on its chord, written as the sheet writes it', () => {
    open();
    const dialog = element('[role="dialog"]');
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    const title = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '');
    expect(title?.textContent?.trim()).toBe('Am · vi');

    const input = element<HTMLInputElement>('.chord-field-input');
    expect(input.value).toBe('Am');
    expect(document.activeElement).toBe(input);
  });

  describe('the chord', () => {
    it('changes to what is typed, keeping the chord\'s id and its length', () => {
      open();
      typeChord('F');

      const after = chordNow();
      expect(after?.id).toBe(id);
      expect(after?.lengthBeats).toBe(2);
      expect(after?.harmony).toEqual({ kind: 'degree', degree: degreeAt(3) });
      expect(element('.chord-popover-title').textContent?.trim()).toBe('F · IV');
      expect(element<HTMLInputElement>('.chord-field-input').value).toBe('F');
    });

    it('re-voices the chord it changes to', () => {
      open();
      typeChord('F');
      const pitchClasses = [...new Set(chordNow()?.notes.map(note => note.midi % 12))].sort((a, b) => a - b);
      expect(pitchClasses).toEqual([0, 5, 9]);
    });

    it('changes nothing for text it cannot read, and stays open saying why', () => {
      open();
      const before = state.doc;
      typeChord('Q');
      expect(state.doc).toBe(before);
      expect(closed).toEqual([]);
      expect(host.textContent).toMatch(/"Q" is not a note/);
    });
  });

  describe('the length', () => {
    it('steps a beat at a time, and shows the length in beats', () => {
      open();
      expect(element('.length-value').textContent?.trim()).toBe('2 beats');

      press('.length-longer');
      expect(chordNow()?.lengthBeats).toBe(3);
      press('.length-shorter');
      press('.length-shorter');
      expect(chordNow()?.lengthBeats).toBe(1);
      expect(element('.length-value').textContent?.trim()).toBe('1 beat');
    });

    it('dims the shorter step at the shortest a chord can be, and a press there changes nothing', () => {
      open();
      press('.length-shorter');
      expect(element('.length-shorter').getAttribute('aria-disabled')).toBe('true');
      const before = state.doc;
      press('.length-shorter');
      expect(state.doc).toBe(before);
    });

    it('offers half a bar, a bar and two bars of the song\'s meter, marking the one it is', () => {
      open();
      expect(presets().map(button => button.textContent?.trim())).toEqual(['½ bar', '1 bar', '2 bars']);
      expect(presets().map(button => button.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);

      presets()[2].click();
      fixture.detectChanges();
      expect(chordNow()?.lengthBeats).toBe(8);
      expect(presets().map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    });

    it('works the bars out from the meter: a bar of 3/4 is three beats', () => {
      open(THREE_FOUR);
      presets()[0].click();
      fixture.detectChanges();
      expect(chordNow()?.lengthBeats).toBe(1.5);
      expect(element('.length-value').textContent?.trim()).toBe('1.5 beats');

      press('.length-longer');
      expect(chordNow()?.lengthBeats).toBe(2);
      presets()[1].click();
      expect(chordNow()?.lengthBeats).toBe(3);
    });
  });

  it('asks for the chord to be heard, staying open with the focus on the button', () => {
    open();
    let heard = 0;
    popover.hear.subscribe(() => heard++);
    const hear = element<HTMLButtonElement>('.hear-chord');
    expect(hear.textContent?.trim()).toBe('Hear it');

    hear.focus();
    press('.hear-chord');

    expect(heard).toBe(1);
    expect(closed).toEqual([]);
    expect(document.activeElement).toBe(hear);
  });

  it('deletes the chord and closes, giving the focus back', () => {
    open();
    press('.delete-chord');

    expect(chordNow()).toBeNull();
    expect(closed).toEqual([true]);
  });

  describe('closing', () => {
    it('closes on Escape, giving the focus back', () => {
      open();
      element('.chord-popover-length').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(closed).toEqual([true]);
    });

    it('closes on Escape in its chord field too, once', () => {
      open();
      element('.chord-field-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(closed).toEqual([true]);
    });

    it('closes on a press outside it, leaving the focus where the press put it', () => {
      open();
      element('.length-longer').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(closed).toEqual([]);

      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(closed).toEqual([false]);
    });

    it('shows nothing once its chord is no longer in the song', () => {
      open();
      fixture.componentRef.setInput('doc', songWith(chordSlotOf(degreeAt(0), C_MAJOR, IONIAN, FOUR_FOUR)));
      fixture.detectChanges();
      expect(host.querySelector('[role="dialog"]')).toBeNull();
    });
  });

  it('keeps Tab inside, going round from its last control to its first', () => {
    open();
    const remove = element<HTMLButtonElement>('.delete-chord');
    remove.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    remove.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(element('.chord-field-input'));
  });
});
