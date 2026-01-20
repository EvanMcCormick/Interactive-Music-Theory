import { enableProdMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';
import { FretboardComponent } from './app/components/fretboard/fretboard.component';

if (environment.production) {
  enableProdMode();
}

const routes = [
  { path: '', redirectTo: '/fretboard', pathMatch: 'full' as const },
  { path: 'fretboard', component: FretboardComponent },
  {
    path: 'gp-viewer',
    loadComponent: () => import('./app/components/gp-viewer/gp-viewer.component')
      .then(m => m.GpViewerComponent)
  },
  {
    path: 'gp-library',
    loadComponent: () => import('./app/components/gp-library/gp-library.component')
      .then(m => m.GpLibraryComponent)
  }
];

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes)
  ]
}).catch(err => console.error(err));