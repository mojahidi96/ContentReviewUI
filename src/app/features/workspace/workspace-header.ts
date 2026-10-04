import { Component, ElementRef, computed, inject, input, output, viewChild } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faBars,
  faEye,
  faMoon,
  faPenNib,
  faRightFromBracket,
  faSpellCheck,
  faSun,
} from '@fortawesome/free-solid-svg-icons';
import type { User } from '../../core/auth/auth.models';
import { ThemeService } from '../../core/theme/theme.service';
import { Badge } from '../../shared/components/badge';
import { ButtonDirective } from '../../shared/components/button.directive';
import { Spinner } from '../../shared/components/spinner';

@Component({
  selector: 'app-workspace-header',
  imports: [FaIconComponent, Badge, ButtonDirective, Spinner],
  host: {
    class:
      'flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900',
  },
  template: `
    <button
      #menuButton
      type="button"
      class="-ml-1 rounded-md p-2 text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-focus lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
      aria-controls="workspace-sidebar"
      [attr.aria-expanded]="drawerOpen()"
      aria-label="Open navigation"
      (click)="menuToggled.emit()"
    >
      <fa-icon [icon]="menuIcon" />
    </button>

    <p class="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
      <span
        class="flex size-7 items-center justify-center rounded-md bg-brand-600 text-sm text-white"
      >
        <fa-icon [icon]="logoIcon" />
      </span>
      <span class="hidden sm:inline">ContentReview</span>
    </p>

    <div class="ml-auto flex items-center gap-3">
      @if (user(); as user) {
        <div class="flex items-center gap-3">
          <span class="hidden sm:block">
            <app-badge
              [tone]="isAuthor() ? 'brand' : 'neutral'"
              [icon]="isAuthor() ? authorIcon : readerIcon"
              >{{ roleLabel() }}</app-badge
            >
          </span>
          <span
            class="flex size-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800 dark:bg-brand-500/20 dark:text-brand-200"
            aria-hidden="true"
            >{{ initials() }}</span
          >
          <div class="hidden text-right leading-tight md:block">
            <p class="text-sm font-medium text-slate-900 dark:text-slate-100">
              {{ user.fullName }}
            </p>
            <p class="text-xs text-slate-600 dark:text-slate-400">
              {{ user.guest ? 'Temporary session' : user.email }}
            </p>
          </div>
          <span class="sr-only md:hidden">Signed in as {{ user.fullName }}</span>
          <span class="sr-only sm:hidden">, {{ roleLabel() }}</span>
        </div>
      }
      <button
        type="button"
        class="rounded-md p-2 text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-focus dark:text-slate-300 dark:hover:bg-slate-800"
        aria-label="Dark mode"
        [attr.aria-pressed]="isDark()"
        [attr.title]="isDark() ? 'Switch to light mode' : 'Switch to dark mode'"
        (click)="theme.toggle()"
      >
        <fa-icon [icon]="isDark() ? lightIcon : darkIcon" class="block w-4 text-center" />
      </button>
      <button
        type="button"
        appButton
        variant="ghost"
        size="sm"
        [disabled]="loggingOut()"
        (click)="logoutRequested.emit()"
      >
        @if (loggingOut()) {
          <app-spinner />
        } @else {
          <fa-icon [icon]="logoutIcon" />
        }
        <span class="hidden sm:inline">Sign out</span>
        <span class="sr-only sm:hidden">Sign out</span>
      </button>
    </div>
  `,
})
export class WorkspaceHeader {
  readonly user = input<User | null>(null);
  readonly drawerOpen = input(false);
  readonly loggingOut = input(false);
  readonly menuToggled = output();
  readonly logoutRequested = output();

  protected readonly theme = inject(ThemeService);
  protected readonly isDark = computed(() => this.theme.theme() === 'dark');

  readonly menuButton = viewChild.required<ElementRef<HTMLButtonElement>>('menuButton');

  protected readonly isAuthor = computed(() => this.user()?.role === 'author');
  protected readonly roleLabel = computed(() => (this.isAuthor() ? 'Author' : 'Read only'));

  protected readonly initials = computed(() =>
    (this.user()?.fullName ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join(''),
  );

  protected readonly menuIcon = faBars;
  protected readonly logoIcon = faSpellCheck;
  protected readonly logoutIcon = faRightFromBracket;
  protected readonly darkIcon = faMoon;
  protected readonly authorIcon = faPenNib;
  protected readonly readerIcon = faEye;
  protected readonly lightIcon = faSun;
}
