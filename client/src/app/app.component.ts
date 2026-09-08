import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { Subject, filter, takeUntil } from 'rxjs';

import { CircleOfFifthsComponent } from './components/circle-of-fifths/circle-of-fifths.component';

/**
 * The shell, and the host of the circle-of-fifths drawer.
 *
 * The drawer lives here because it is the only place that spans every route, and
 * because more than one page cares about the selected key — binding it to the
 * fretboard would have meant building it again for the composer.
 *
 * ## Why it is not offered everywhere
 *
 * The drawer sets `selectedKey`. That means nothing on the Guitar Pro pages,
 * which read a file rather than the app's key, and on `/transcribe` it is worse
 * than nothing: that page keeps its own key inside `DerivationSettings`, so a
 * global key control sitting over it that did not drive it would read as broken.
 *
 * An allow-list here rather than each page opting in, because the question is
 * "does this route read `selectedKey`", and the shell is where the answer can be
 * seen all at once.
 */
@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  standalone: true,
  imports: [CommonModule, RouterModule, CircleOfFifthsComponent]
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'MusicTheory';

  /**
   * Routes whose view reads `selectedKey`.
   *
   * `/progression` is the strongest entry rather than another one like the
   * others: that page has no key picker of its own by design, so the drawer is
   * not merely meaningful there, it is the only key control the page has. See
   * `ProgressionComponent`, which mirrors this selection into its own document.
   */
  private static readonly CIRCLE_ROUTES = ['/fretboard', '/composer', '/progression'];

  /** Whether this route reads the key, and so whether the toggle is shown. */
  circleAvailable = true;

  circleOpen = false;

  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();

  /**
   * Whether the circle belongs on a URL.
   *
   * Static and pure so the allow-list can be tested without a router: the
   * decision is the interesting part and navigating to assert it would test
   * Angular rather than this rule.
   */
  static showsCircle(url: string): boolean {
    // Query strings and fragments are not part of the question.
    const path = url.split(/[?#]/)[0];

    // '/' redirects to the fretboard, and is what the very first NavigationEnd
    // reports before the redirect resolves.
    if (path === '/' || path === '') {
      return true;
    }

    return AppComponent.CIRCLE_ROUTES.some(
      route => path === route || path.startsWith(`${route}/`)
    );
  }

  ngOnInit(): void {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntil(this.destroy$)
      )
      .subscribe(event => this.onNavigated(event.urlAfterRedirects));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Re-evaluates the drawer for a new URL.
   *
   * A drawer left open across a navigation onto a page that does not read the
   * key would sit there driving nothing, so leaving closes it. Moving between
   * two pages that both read it leaves it alone, which is the point of hosting
   * it in the shell.
   */
  onNavigated(url: string): void {
    this.circleAvailable = AppComponent.showsCircle(url);

    if (!this.circleAvailable) {
      this.circleOpen = false;
    }
  }

  toggleCircle(): void {
    this.circleOpen = !this.circleOpen;
  }

  closeCircle(): void {
    this.circleOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeCircle();
  }
}
