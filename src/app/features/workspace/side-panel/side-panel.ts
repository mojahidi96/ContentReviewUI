import { Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faAnglesLeft,
  faAnglesRight,
  faClockRotateLeft,
  faHouse,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons';
import { ModelPicker } from '../../content-review/model-picker/model-picker';
import { Spinner } from '../../../shared/components/spinner/spinner';

interface NavItem {
  readonly label: string;
  readonly link: string;
  /** Readers cannot open the document list, so Home takes them to the shared text. */
  readonly readerLink?: string;
  readonly icon: typeof faHouse;
  /** Whether the current path (no query string) belongs to this item. */
  readonly matches: (path: string) => boolean;
  /** Hidden from read-only users. */
  readonly authorOnly: boolean;
}

/**
 * Tools/navigation panel. Rendered compact (icon-only) when `collapsed` is true; the shell
 * decides whether it is an inline sidebar (desktop) or a drawer (mobile).
 */
@Component({
  selector: 'app-side-panel',
  imports: [RouterLink, FaIconComponent, ModelPicker, Spinner],
  host: { class: 'flex h-full flex-col' },
  templateUrl: './side-panel.html',
})
export class SidePanel {
  readonly collapsed = input(false);
  /** Whether the collapse control is offered (desktop only). */
  readonly collapsible = input(true);
  readonly reviewing = input(false);
  /** False for read-only users: hides the review action and authoring pages. */
  readonly canReview = input(true);

  readonly reviewRequested = output();
  readonly collapseToggled = output();
  readonly navigated = output();

  private readonly router = inject(Router);
  private readonly path = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => pathOf(this.router.url)),
    ),
    { initialValue: pathOf(this.router.url) },
  );

  /**
   * Content Review and its model picker belong to the document open in the editor, so they only
   * show there. Home (the document list and articles) has nothing to review.
   */
  protected readonly onDocument = computed(() => this.path() === '/workspace');

  private readonly allNavItems: readonly NavItem[] = [
    {
      label: 'Home',
      link: '/workspace/documents',
      readerLink: '/workspace',
      icon: faHouse,
      // Home also covers the editor: it is reached from a document in the list.
      matches: (path) => path === '/workspace' || path.startsWith('/workspace/documents'),
      authorOnly: false,
    },
    {
      label: 'Review history',
      link: '/workspace/history',
      icon: faClockRotateLeft,
      matches: (path) => path.startsWith('/workspace/history'),
      authorOnly: true,
    },
  ];
  protected readonly navItems = computed(() =>
    this.allNavItems
      .filter((item) => this.canReview() || !item.authorOnly)
      .map((item) => ({
        ...item,
        link: (!this.canReview() && item.readerLink) || item.link,
        active: item.matches(this.path()),
      })),
  );
  protected readonly reviewIcon = faWandMagicSparkles;
  protected readonly collapseIcon = faAnglesLeft;
  protected readonly expandIcon = faAnglesRight;
}

function pathOf(url: string): string {
  return url.split(/[?#]/)[0];
}
