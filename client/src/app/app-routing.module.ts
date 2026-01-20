import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { FretboardComponent } from './components/fretboard/fretboard.component';

const routes: Routes = [
  { path: '', redirectTo: '/fretboard', pathMatch: 'full' },
  { path: 'fretboard', component: FretboardComponent },
  {
    path: 'gp-viewer',
    loadComponent: () => import('./components/gp-viewer/gp-viewer.component')
      .then(m => m.GpViewerComponent)
  },
  {
    path: 'gp-library',
    loadComponent: () => import('./components/gp-library/gp-library.component')
      .then(m => m.GpLibraryComponent)
  }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }