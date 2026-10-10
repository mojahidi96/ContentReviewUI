import { Component, computed, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faAnglesLeft,
  faAnglesRight,
  faClockRotateLeft,
  faFileLines,
  faNewspaper,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons';
import { ModelPicker } from '../../content-review/model-picker/model-picker';
import { Spinner } from '../../../shared/components/spinner/spinner';

interface NavItem {
  readonly label: string;
  readonly link: string;
  readonly icon: typeof faFileLines;
  readonly exact: boolean;
  /** Hidden from read-only users. */
  readonly authorOnly: boolean;
}

/**
 * Tools/navigation panel. Rendered compact (icon-only) when `collapsed` is true; the shell
 * decides whether it is an inline sidebar (desktop) or a drawer (mobile).
 */
@Component({
  selector: 'app-side-panel',
  imports: [RouterLink, RouterLinkActive, FaIconComponent, ModelPicker, Spinner],
  host: { class: 'flex h-full flex-col' },
  templateUrl: './side-panel.html',
  styleUrl: './side-panel.scss',
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

  private readonly allNavItems: readonly NavItem[] = [
    { label: 'Document', link: '/workspace', icon: faFileLines, exact: true, authorOnly: false },
    {
      label: 'Documents',
      link: '/workspace/documents',
      icon: faNewspaper,
      exact: false,
      authorOnly: true,
    },
    {
      label: 'Review history',
      link: '/workspace/history',
      icon: faClockRotateLeft,
      exact: false,
      authorOnly: true,
    },
  ];
  protected readonly navItems = computed(() =>
    this.allNavItems.filter((item) => this.canReview() || !item.authorOnly),
  );
  protected readonly reviewIcon = faWandMagicSparkles;
  protected readonly collapseIcon = faAnglesLeft;
  protected readonly expandIcon = faAnglesRight;
}
