import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerPaletteComponent, PaletteButton, paletteGroupsOf } from './composer-palette.component';
import { ComposerService } from '../../../../services/composer.service';
import { COMPOSER_TOOLS, ComposerTool } from '../../../../services/composer-tools';

describe('paletteGroupsOf', () => {
  let composer: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    composer = TestBed.inject(ComposerService);
  });

  const buttonFor = (id: string): PaletteButton => {
    const found = paletteGroupsOf(composer.state).flatMap(group => group.buttons).find(button => button.tool.id === id);
    if (!found) throw new Error(`no button ${id}`);
    return found;
  };

  it('draws every palette tool once, in the design\'s groups', () => {
    const groups = paletteGroupsOf(composer.state);

    expect(groups.map(group => group.group)).toEqual(['Tools', 'Duration', 'Bar', 'Accidentals', 'Dynamics', 'Articulation', 'Techniques']);
    expect(groups.flatMap(group => group.buttons).length).toBe(COMPOSER_TOOLS.filter(tool => tool.inPalette).length);
  });

  it('says a toggle is mixed across a range', () => {
    composer.setCursor({ beatIndex: 0, stringIndex: 0 });
    composer.setNoteAtCursor({ kind: 'fretted', string: 1, fret: 3 }, false);
    composer.toggleNoteEffect('isGhost', true, false);
    composer.setCursor({ beatIndex: 1 });
    composer.setNoteAtCursor({ kind: 'fretted', string: 1, fret: 5 }, false);
    composer.setCursor({ beatIndex: 0 });
    composer.extendSelectionTo({ beatIndex: 1 });

    expect(buttonFor('ghost').pressed).toBe('mixed');
  });

  it('carries a refusal in the name and the tooltip, and the shortcut in the tooltip', () => {
    const ghost = buttonFor('ghost');

    expect(ghost.refusal).toMatch(/note/i);
    expect(ghost.label).toContain('unavailable');
    expect(ghost.tooltip).toContain('(O)');
    expect(ghost.tooltip).toContain(ghost.refusal ?? '');
  });

  it('says pressed only for toggles and radios: Select from the entry mode, never a popover tool or an action', () => {
    expect(buttonFor('select').pressed).toBe('true');
    expect(buttonFor('pen').pressed).toBe('false');
    expect(buttonFor('quarter').pressed).toBe('true');
    expect(buttonFor('timeSignature').pressed).toBeNull();
    expect(buttonFor('timeSignature').opensPopover).toBeTrue();
    expect(buttonFor('fixBar').pressed).toBeNull();
    expect(buttonFor('fixBar').opensPopover).toBeFalse();

    composer.setEntryMode('pen');
    expect(buttonFor('pen').pressed).toBe('true');
  });

  it('writes a SMuFL glyph as its character, and text as it is', () => {
    expect(buttonFor('quarter').face).toBe(String.fromCodePoint(0xe1d5));
    expect(buttonFor('quarter').smufl).toBeTrue();
    expect(buttonFor('hammerOn').face).toBe('H');
  });
});

describe('ComposerPaletteComponent', () => {
  let fixture: ComponentFixture<ComposerPaletteComponent>;
  let composer: ComposerService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerPaletteComponent] }).compileComponents();
    composer = TestBed.inject(ComposerService);
    fixture = TestBed.createComponent(ComposerPaletteComponent);
    fixture.componentRef.setInput('state', composer.state);
    fixture.detectChanges();
  });

  const button = (id: string): HTMLButtonElement => fixture.nativeElement.querySelector(`[data-tool="${id}"]`);

  it('names each button, says pressed by kind, and says refusing with aria-disabled while staying focusable', () => {
    expect(button('quarter').getAttribute('aria-label')).toBe('Quarter note');
    expect(button('quarter').getAttribute('aria-pressed')).toBe('true');
    expect(button('ghost').getAttribute('aria-disabled')).toBe('true');
    expect(button('ghost').disabled).toBeFalse();

    expect(button('clef').getAttribute('aria-pressed')).toBeNull();
    expect(button('clef').getAttribute('aria-haspopup')).toBe('dialog');
    expect(button('clef').getAttribute('aria-expanded')).toBe('false');

    expect(button('fixBar').getAttribute('aria-pressed')).toBeNull();
    expect(button('fixBar').getAttribute('aria-haspopup')).toBeNull();
    expect(button('fixBar').getAttribute('aria-expanded')).toBeNull();
  });

  it('asks the page to run a pressed tool, refused or not', () => {
    const pressed: ComposerTool[] = [];
    fixture.componentInstance.toolPressed.subscribe((tool: ComposerTool) => pressed.push(tool));

    button('rest').click();
    button('ghost').click();

    expect(pressed.map(tool => tool.id)).toEqual(['rest', 'ghost']);
  });

  it('opens the popover of its kind in the top layer, says so on its button, and focuses it', () => {
    fixture.componentRef.setInput('popover', 'clef');
    fixture.detectChanges();

    const open: HTMLElement | null = fixture.nativeElement.querySelector('.popover:popover-open');
    expect(button('clef').getAttribute('aria-expanded')).toBe('true');
    expect(open?.getAttribute('aria-label')).toBe('Clef');
    expect(open?.contains(document.activeElement)).toBeTrue();
  });
});
