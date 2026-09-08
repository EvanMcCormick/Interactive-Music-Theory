import { enableProdMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';
import { FretboardComponent } from './app/components/fretboard/fretboard.component';
import { authInterceptor } from './app/interceptors/auth.interceptor';
import { AuthService } from './app/services/auth.service';
import { TieredDetector } from './app/services/tiered-detector';
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
  },
  // Lazy for the same reason, and with the audio bindings inside the chunk
  // rather than beside this route: `PROGRESSION_AUDIO` was bound in the
  // providers below until Task 10, and `ProgressionComponent` binds it now.
  //
  // `Route.providers` was the obvious middle ground and does not work, which is
  // worth writing down before someone tries it: the array is static, so a
  // factory named in it is a value import from this file and Tone comes with
  // it. Only a provider written inside a lazily loaded file is lazy.
  //
  // Measured, and smaller than Task 8's comment predicted: binding it here
  // rather than on the page costs 772,018 bytes against 771,296, so 722 - the
  // size of `progression-audio.ts` itself. The 7.6 kB that comment named
  // (762,168 with no progression route at all, against 769,756 with the eager
  // binding) is Tone's `Part` and transport, and *that* does not move. The
  // fretboard is the one eager route and does `import * as Tone`, so webpack
  // keeps the `tone` modules in `main` and the lazy page's use of two more of
  // its exports enlarges main's copy wherever the provider is declared. Getting
  // those 7.6 kB back means making the fretboard lazy or importing Tone
  // dynamically inside `progression-audio.ts`; neither is this task's.
  {
    path: 'progression',
    loadComponent: () => import('./app/components/progression/progression.component')
      .then(m => m.ProgressionComponent)
  }
];

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    // The real note detector, bound here rather than defaulted on the token so
    // that a spec forgetting to provide a stub fails loudly instead of quietly
    // downloading a model and compiling shaders. Neither detector is an
    // Angular service - one owns a worker and the other owns an upload, not an
    // injector - so they are constructed by a factory rather than through
    // `useClass`. TF.js does not come with the worker one: its module is
    // reachable only through `new Worker(new URL(...))`, so it stays in a chunk
    // of its own, and `TieredDetector` builds it lazily so a signed-in visitor
    // who never falls back never downloads it.
    {
      provide: NOTE_DETECTOR,
      useFactory: (http: HttpClient, auth: AuthService): TieredDetector =>
        new TieredDetector(
          () => auth.isAuthenticated,
          // Dynamic, so the SignalR client lands in a chunk of its own rather
          // than in `main`. Measured: importing it eagerly here costs the
          // landing page 58 kB it has no use for, and this route is not the
          // landing page.
          async () => {
            const { RemoteDetector } = await import('./app/services/remote-detector');
            return new RemoteDetector(http, auth);
          },
          () => new WorkerDetector(),
          reason =>
            // Worth saying out loud: a signed-in user who quietly gets the slow
            // path has no way to tell, and this is the only place that knows.
            console.warn(`Server transcription unavailable, using the browser: ${reason.message}`)
        ),
      deps: [HttpClient, AuthService]
    }
  ]
}).catch(err => console.error(err));