import * as alphaTab from '@coderline/alphatab';
import {
  BeatDoc,
  ClefKind,
  DynamicValue,
  NoteDoc,
  OttaviaKind,
  TripletFeelKind
} from '../models/composer.model';

/**
 * Bridges between ScoreDoc's string-literal unions and alphaTab's numeric
 * enums. Split out of ScoreDocMapperService to keep both files within the
 * project's 500-line guideline; these are pure lookups with no state.
 */

export function toClef(kind: ClefKind): alphaTab.model.Clef {
  switch (kind) {
    case 'f4': return alphaTab.model.Clef.F4;
    case 'c3': return alphaTab.model.Clef.C3;
    case 'c4': return alphaTab.model.Clef.C4;
    case 'n': return alphaTab.model.Clef.Neutral;
    default: return alphaTab.model.Clef.G2;
  }
}

export function fromClef(clef: alphaTab.model.Clef): ClefKind {
  switch (clef) {
    case alphaTab.model.Clef.F4: return 'f4';
    case alphaTab.model.Clef.C3: return 'c3';
    case alphaTab.model.Clef.C4: return 'c4';
    case alphaTab.model.Clef.Neutral: return 'n';
    default: return 'g2';
  }
}

export function toOttavia(kind: OttaviaKind): alphaTab.model.Ottavia {
  switch (kind) {
    case '15ma': return alphaTab.model.Ottavia._15ma;
    case '8va': return alphaTab.model.Ottavia._8va;
    case '8vb': return alphaTab.model.Ottavia._8vb;
    case '15mb': return alphaTab.model.Ottavia._15mb;
    default: return alphaTab.model.Ottavia.Regular;
  }
}

export function fromOttavia(ottavia: alphaTab.model.Ottavia): OttaviaKind {
  switch (ottavia) {
    case alphaTab.model.Ottavia._15ma: return '15ma';
    case alphaTab.model.Ottavia._8va: return '8va';
    case alphaTab.model.Ottavia._8vb: return '8vb';
    case alphaTab.model.Ottavia._15mb: return '15mb';
    default: return 'regular';
  }
}

export function toTripletFeel(kind: TripletFeelKind): alphaTab.model.TripletFeel {
  switch (kind) {
    case 'triplet8th': return alphaTab.model.TripletFeel.Triplet8th;
    case 'triplet16th': return alphaTab.model.TripletFeel.Triplet16th;
    case 'dotted8th': return alphaTab.model.TripletFeel.Dotted8th;
    case 'dotted16th': return alphaTab.model.TripletFeel.Dotted16th;
    case 'scottish8th': return alphaTab.model.TripletFeel.Scottish8th;
    case 'scottish16th': return alphaTab.model.TripletFeel.Scottish16th;
    default: return alphaTab.model.TripletFeel.NoTripletFeel;
  }
}

export function fromTripletFeel(feel: alphaTab.model.TripletFeel): TripletFeelKind {
  switch (feel) {
    case alphaTab.model.TripletFeel.Triplet8th: return 'triplet8th';
    case alphaTab.model.TripletFeel.Triplet16th: return 'triplet16th';
    case alphaTab.model.TripletFeel.Dotted8th: return 'dotted8th';
    case alphaTab.model.TripletFeel.Dotted16th: return 'dotted16th';
    case alphaTab.model.TripletFeel.Scottish8th: return 'scottish8th';
    case alphaTab.model.TripletFeel.Scottish16th: return 'scottish16th';
    default: return 'none';
  }
}

export function toDynamicValue(value: DynamicValue): alphaTab.model.DynamicValue {
  switch (value) {
    case 'ppp': return alphaTab.model.DynamicValue.PPP;
    case 'pp': return alphaTab.model.DynamicValue.PP;
    case 'p': return alphaTab.model.DynamicValue.P;
    case 'mp': return alphaTab.model.DynamicValue.MP;
    case 'mf': return alphaTab.model.DynamicValue.MF;
    case 'ff': return alphaTab.model.DynamicValue.FF;
    case 'fff': return alphaTab.model.DynamicValue.FFF;
    default: return alphaTab.model.DynamicValue.F;
  }
}

export function fromDynamicValue(value: alphaTab.model.DynamicValue): DynamicValue | null {
  switch (value) {
    case alphaTab.model.DynamicValue.PPP: return 'ppp';
    case alphaTab.model.DynamicValue.PP: return 'pp';
    case alphaTab.model.DynamicValue.P: return 'p';
    case alphaTab.model.DynamicValue.MP: return 'mp';
    case alphaTab.model.DynamicValue.MF: return 'mf';
    case alphaTab.model.DynamicValue.F: return 'f';
    case alphaTab.model.DynamicValue.FF: return 'ff';
    case alphaTab.model.DynamicValue.FFF: return 'fff';
    default: return null;
  }
}

export function toBrushType(brush: string): alphaTab.model.BrushType {
  switch (brush) {
    case 'brushUp': return alphaTab.model.BrushType.BrushUp;
    case 'brushDown': return alphaTab.model.BrushType.BrushDown;
    case 'arpeggioUp': return alphaTab.model.BrushType.ArpeggioUp;
    case 'arpeggioDown': return alphaTab.model.BrushType.ArpeggioDown;
    default: return alphaTab.model.BrushType.None;
  }
}

export function fromBrushType(brush: alphaTab.model.BrushType): BeatDoc['effects']['brush'] {
  switch (brush) {
    case alphaTab.model.BrushType.BrushUp: return 'brushUp';
    case alphaTab.model.BrushType.BrushDown: return 'brushDown';
    case alphaTab.model.BrushType.ArpeggioUp: return 'arpeggioUp';
    case alphaTab.model.BrushType.ArpeggioDown: return 'arpeggioDown';
    default: return 'none';
  }
}

export function toGraceType(grace: string): alphaTab.model.GraceType {
  switch (grace) {
    case 'onBeat': return alphaTab.model.GraceType.OnBeat;
    case 'beforeBeat': return alphaTab.model.GraceType.BeforeBeat;
    default: return alphaTab.model.GraceType.None;
  }
}

export function fromGraceType(grace: alphaTab.model.GraceType): BeatDoc['effects']['grace'] {
  switch (grace) {
    case alphaTab.model.GraceType.OnBeat: return 'onBeat';
    case alphaTab.model.GraceType.BeforeBeat: return 'beforeBeat';
    default: return 'none';
  }
}

export function toHarmonicType(harmonic: string): alphaTab.model.HarmonicType {
  switch (harmonic) {
    case 'natural': return alphaTab.model.HarmonicType.Natural;
    case 'artificial': return alphaTab.model.HarmonicType.Artificial;
    case 'pinch': return alphaTab.model.HarmonicType.Pinch;
    case 'tap': return alphaTab.model.HarmonicType.Tap;
    case 'semi': return alphaTab.model.HarmonicType.Semi;
    default: return alphaTab.model.HarmonicType.None;
  }
}

export function fromHarmonicType(
  harmonic: alphaTab.model.HarmonicType
): NoteDoc['effects']['harmonic'] {
  switch (harmonic) {
    case alphaTab.model.HarmonicType.Natural: return 'natural';
    case alphaTab.model.HarmonicType.Artificial: return 'artificial';
    case alphaTab.model.HarmonicType.Pinch: return 'pinch';
    case alphaTab.model.HarmonicType.Tap: return 'tap';
    case alphaTab.model.HarmonicType.Semi: return 'semi';
    default: return 'none';
  }
}

export function applySlide(note: alphaTab.model.Note, slide: NoteDoc['effects']['slide']): void {
  switch (slide) {
    case 'shiftSlide':
      note.slideOutType = alphaTab.model.SlideOutType.Shift;
      break;
    case 'legatoSlide':
      note.slideOutType = alphaTab.model.SlideOutType.Legato;
      break;
    case 'slideOutUp':
      note.slideOutType = alphaTab.model.SlideOutType.OutUp;
      break;
    case 'slideInBelow':
      note.slideInType = alphaTab.model.SlideInType.IntoFromBelow;
      break;
    default:
      note.slideOutType = alphaTab.model.SlideOutType.None;
  }
}
