import { enableProdMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';
import { FretboardComponent } from './app/components/fretboard/fretboard.component';
import { authInterceptor } from './app/interceptors/auth.interceptor';
import { NOTE_DETECTOR } from './app/services/transcription.service';
import { WorkerDetector } from './app/services/worker-detector';

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
    path: 'composer',
    loadComponent: () => import('./app/components/composer/composer.component')
      .then(m => m.ComposerComponent)
  },
  {
    path: 'gp-library',
    loadComponent: () => import('./app/components/gp-library/gp-library.component')
      .then(m => m.GpLibraryComponent)
  },
  // Lazy, where the plan wrote `component:`. The review panel renders its
  // preview through alphaTab, which lives in a 1.14 MB chunk shared by the
  // composer and the GP viewer because both of those routes are lazy too. An
  // eager route here would be a value import of that chunk from the entry
  // graph, which pulls the whole engraver into `main` - and the milestone's
  // own acceptance criterion is that `main` stays near 716 kB. The transcriber
  // is not the landing route, so there is nothing to trade for it.
  {
    path: 'transcribe',
    loadComponent: () => import('./app/components/transcription/transcription.component')
      .then(m => m.TranscriptionComponent)
  }
];

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    // The real note detector, bound here rather than defaulted on the token so
    // that a spec forgetting to provide a stub fails loudly instead of quietly
    // downloading a model and compiling shaders. `WorkerDetector` is a plain
    // class with no Angular decorator - it owns a worker, not an injector - so
    // it is constructed by a factory rather than through `useClass`. TF.js does
    // not come with it: the worker module is reachable only through
    // `new Worker(new URL(...))`, so it stays in a chunk of its own.
    { provide: NOTE_DETECTOR, useFactory: (): WorkerDetector => new WorkerDetector() }
  ]
}).catch(err => console.error(err));