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
import type { User } from '../../../core/auth/auth.models';
import { ThemeService } from '../../../core/theme/theme.service';
import { Badge } from '../../../shared/components/badge';
import { ButtonDirective } from '../../../shared/components/button.directive';
import { Spinner } from '../../../shared/components/spinner/spinner';

@Component({
  selector: 'app-workspace-header',
  imports: [FaIconComponent, Badge, ButtonDirective, Spinner],
  host: {
    class:
      'flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900',
  },
  templateUrl: './workspace-header.html',
  styleUrl: './workspace-header.scss',
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
