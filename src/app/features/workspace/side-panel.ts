import { Component, computed, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faAnglesLeft,
  faAnglesRight,
  faClockRotateLeft,
  faFileLines,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons';
import { Spinner } from '../../shared/components/spinner';

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
  imports: [RouterLink, RouterLinkActive, FaIconComponent, Spinner],
  host: { class: 'flex h-full flex-col' },
  template: `
    @if (canReview()) {
      <div class="p-3">
        <button
          type="button"
          class="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-action font-medium text-white shadow-sm transition-colors hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-70"
          [disabled]="reviewing()"
          [attr.aria-label]="collapsed() ? 'Content Review' : null"
          [attr.title]="collapsed() ? 'Content Review' : null"
          (click)="reviewRequested.emit()"
        >
          @if (reviewing()) {
            <app-spinner />
          } @else {
            <fa-icon [icon]="reviewIcon" />
          }
          @if (!collapsed()) {
            <span>{{ reviewing() ? 'Reviewing…' : 'Content Review' }}</span>
          }
        </button>
      </div>
    }

    <nav aria-label="Workspace" class="flex-1 px-3 py-2">
      @if (!collapsed()) {
        <p
          class="px-2 pb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
        >
          Workspace
        </p>
      }
      <ul class="space-y-1">
        @for (item of navItems(); track item.link) {
          <li>
            <a
              [routerLink]="item.link"
              routerLinkActive="bg-brand-50 text-brand-800 font-semibold dark:bg-brand-500/15 dark:text-brand-200"
              [routerLinkActiveOptions]="{ exact: item.exact }"
              ariaCurrentWhenActive="page"
              class="flex h-10 items-center gap-3 rounded-md px-3 text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-focus dark:text-slate-300 dark:hover:bg-slate-800"
              [class.justify-center]="collapsed()"
              [attr.aria-label]="collapsed() ? item.label : null"
              [attr.title]="collapsed() ? item.label : null"
              (click)="navigated.emit()"
            >
              <fa-icon [icon]="item.icon" class="w-4 text-center" />
              @if (!collapsed()) {
                <span>{{ item.label }}</span>
              }
            </a>
          </li>
        }
      </ul>
    </nav>

    @if (collapsible()) {
      <div class="border-t border-slate-200 p-3 dark:border-slate-800">
        <button
          type="button"
          class="flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-focus dark:text-slate-400 dark:hover:bg-slate-800"
          [class.justify-center]="collapsed()"
          aria-controls="workspace-sidebar"
          [attr.aria-expanded]="!collapsed()"
          [attr.aria-label]="collapsed() ? 'Expand sidebar' : 'Collapse sidebar'"
          (click)="collapseToggled.emit()"
        >
          <fa-icon [icon]="collapsed() ? expandIcon : collapseIcon" />
          @if (!collapsed()) {
            <span aria-hidden="true">Collapse</span>
          }
        </button>
      </div>
    }
  `,
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
