import { NgIf } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { MusicTheoryService } from '../../../../services/music-theory.service';
import { HandoffBanner, ProgressionHandoffService } from '../../../../services/progression-handoff.service';

/** What the banner shows: the link's names, and the key note in words - empty when there is nothing to explain. */
interface BannerView {
  sectionLabel: string;
  songTitle: string;
  keyNote: string;
}

/**
 * The Progression page's banner while a song's section is open there (Open in Progression, brief decision 7):
 * "Editing Verse 1 of "Last Dance" · Back to song".
 *
 * **At the top of the rail**, above the Key block, rather than across the page: the rail is where the page says what
 * it is working on and in what key, and the one thing the banner has to explain besides the way back - that the key
 * is the song's - belongs directly over the block that names the key and points at the circle of fifths. A strip
 * across the working area would push the palette, the roll and the strip down for a reminder.
 *
 * **The key note** appears while the circle names a key other than the song's - turned while the section is open,
 * or already elsewhere when it arrived - since the rail's Key block below still says the circle sets the key, and
 * here it does not: the song's key holds, and it is set on the song. It is a status region, always in the banner and
 * only its words changing, so turning the circle is announced.
 *
 * A component of its own rather than more of `ProgressionComponent`, which is past the thousand-line bound already:
 * the page only places it and declines the circle's key (`adopt`).
 */
@Component({
  selector: 'app-progression-handoff-banner',
  standalone: true,
  imports: [NgIf],
  templateUrl: './progression-handoff-banner.component.html',
  styleUrls: ['./progression-handoff-banner.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProgressionHandoffBannerComponent implements OnInit, OnDestroy {
  private readonly handoff = inject(ProgressionHandoffService);
  private readonly musicTheory = inject(MusicTheoryService);
  private readonly changes = inject(ChangeDetectorRef);
  private readonly destroy$ = new Subject<void>();

  /** The banner, or null while no song's section is the progression open. */
  view: BannerView | null = null;

  ngOnInit(): void {
    this.handoff.banner$.pipe(takeUntil(this.destroy$)).subscribe(banner => {
      this.view = banner === null ? null : this.viewOf(banner);
      this.changes.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Back to song: the section's edits go home with it, and the user's own progression comes back here. */
  back(): void {
    void this.handoff.returnToSong();
  }

  private viewOf(banner: HandoffBanner): BannerView {
    const tonic = this.musicTheory.spellNote(banner.key.tonic, banner.key.preferSharps);
    // Named as the rail's Key block names it (`ProgressionComponent.render`), so the two read as one key.
    const key = banner.scaleName === null ? tonic : `${tonic} ${banner.scaleName}`;
    return {
      sectionLabel: banner.sectionLabel,
      songTitle: banner.songTitle,
      keyNote: banner.keyHeld ? `The song's key is ${key}; it is set on the song.` : ''
    };
  }
}
