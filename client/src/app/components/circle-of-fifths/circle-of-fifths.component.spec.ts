import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MusicTheoryService } from '../../services/music-theory.service';
import { CircleOfFifthsComponent } from './circle-of-fifths.component';
import { CIRCLE_POSITIONS } from './circle-of-fifths.data';

/**
 * What the circle does when you click it, and what it shows when the key
 * changes underneath it.
 *
 * The geometry is not tested. Arc coordinates are arithmetic that either renders
 * or obviously does not, and pinning `d` attributes would make the component
 * unrefactorable in exchange for no protection — the same reason `CLAUDE.md`
 * rules out asserting DOM structure.
 *
 * What *is* tested is the contract with `MusicTheoryService`, because that is
 * the part with a decision in it: a major sets the key and the major mode, a
 * minor sets the relative root and the minor mode, and the highlight is read
 * back out of the service rather than remembered locally.
 */
describe('CircleOfFifthsComponent', () => {
  let fixture: ComponentFixture<CircleOfFifthsComponent>;
  let component: CircleOfFifthsComponent;
  let service: MusicTheoryService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CircleOfFifthsComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(CircleOfFifthsComponent);
    component = fixture.componentInstance;
    service = TestBed.inject(MusicTheoryService);
    fixture.detectChanges();
  });

  /** G major, four positions clockwise from the top. */
  const G = CIRCLE_POSITIONS[1];

  describe('selecting', () => {
    it('sets the key and the major mode when a major is clicked', () => {
      component.selectMajor(G);

      const state = service.getCurrentState();
      expect(state.selectedKey).toBe('G');
      expect(state.selectedItem).toBe('ionian');
      expect(state.selectedCategory).toBe('diatonicModes');
    });

    it('sets the relative root and the minor mode when a minor is clicked', () => {
      component.selectMinor(G);

      const state = service.getCurrentState();
      // E minor, not G - the ring is the relative minor of the major beside it.
      expect(state.selectedKey).toBe('E');
      expect(state.selectedItem).toBe('aeolian');
      expect(state.selectedCategory).toBe('diatonicModes');
    });

    it('selects the enharmonic spelling that was clicked', () => {
      const enharmonic = CIRCLE_POSITIONS.find(p => p.majorEnharmonic !== null)!;

      component.selectMajor(enharmonic, true);
      expect(service.getCurrentState().selectedKey).toBe('Gb');

      component.selectMajor(enharmonic, false);
      expect(service.getCurrentState().selectedKey).toBe('F#');
    });

    /**
     * Not cosmetic. `MusicTheoryService.flatKeys` reads the key name to decide
     * how the whole app spells notes, so which side of the circle was clicked
     * decides whether the fretboard comes back in sharps or flats.
     */
    it('puts the app into flats when a flat key is chosen', () => {
      component.selectMajor(CIRCLE_POSITIONS.find(p => p.major === 'Eb')!);
      expect(service.shouldUseSharps()).toBeFalse();

      component.selectMajor(CIRCLE_POSITIONS.find(p => p.major === 'A')!);
      expect(service.shouldUseSharps()).toBeTrue();
    });
  });

  describe('highlighting', () => {
    it('marks the major that matches the key', () => {
      service.updateKey('D');
      service.updateItem('ionian');
      fixture.detectChanges();

      expect(component.isMajorSelected(CIRCLE_POSITIONS[2])).toBeTrue();
      expect(component.isMajorSelected(CIRCLE_POSITIONS[0])).toBeFalse();
    });

    it('marks the minor ring instead when the mode is minor', () => {
      // A minor: the relative of C, so the *inner* ring of position 0.
      service.updateKey('A');
      service.updateItem('aeolian');
      fixture.detectChanges();

      expect(component.isMinorSelected(CIRCLE_POSITIONS[0])).toBeTrue();
      expect(component.isMajorSelected(CIRCLE_POSITIONS[3])).toBeFalse();
    });

    it('marks nothing on either ring for a mode that is neither', () => {
      // Dorian is a real selection the rest of the app can be in, and the
      // circle has no honest way to show it. Showing nothing beats guessing.
      service.updateKey('D');
      service.updateItem('dorian');
      fixture.detectChanges();

      expect(component.isMajorSelected(CIRCLE_POSITIONS[2])).toBeFalse();
      expect(component.isMinorSelected(CIRCLE_POSITIONS[2])).toBeFalse();
    });

    it('matches an enharmonic key on either spelling', () => {
      service.updateKey('Gb');
      service.updateItem('ionian');
      fixture.detectChanges();

      const enharmonic = CIRCLE_POSITIONS.find(p => p.majorEnharmonic !== null)!;
      expect(component.isMajorSelected(enharmonic)).toBeTrue();
    });
  });

  describe('direction', () => {
    it('starts on fifths', () => {
      expect(component.direction).toBe('fifths');
      expect(component.positions[1].major).toBe('G');
    });

    it('reverses the running order when toggled to fourths', () => {
      component.setDirection('fourths');
      fixture.detectChanges();

      expect(component.positions[0].major).toBe('C');
      expect(component.positions[1].major).toBe('F');
    });

    it('does not change the selected key', () => {
      service.updateKey('D');
      component.setDirection('fourths');
      fixture.detectChanges();

      expect(service.getCurrentState().selectedKey).toBe('D');
    });
  });
});
