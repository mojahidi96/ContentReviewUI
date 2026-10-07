import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ViewportService } from '../../../core/layout/viewport.service';
import { ReviewStore } from '../../content-review/review.store';
import { DocumentService } from '../document.service';
import { SidePanel } from '../side-panel/side-panel';
import { WorkspaceHeader } from '../workspace-header/workspace-header';

const COLLAPSED_STORAGE_KEY = 'contentReview.sidebarCollapsed';

function readCollapsedPreference(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Authenticated layout: header, collapsible side panel and routed content. Provides the
 * document and review state so it is created on login and discarded on logout.
 */
@Component({
  selector: 'app-workspace-shell',
  imports: [RouterOutlet, SidePanel, WorkspaceHeader],
  providers: [DocumentService, ReviewStore],
  host: {
    class: 'flex h-dvh flex-col bg-slate-50 dark:bg-slate-950',
    '(document:keydown.escape)': 'closeDrawer()',
  },
  templateUrl: './workspace-shell.html',
  styleUrl: './workspace-shell.scss',
})
export class WorkspaceShell {
  protected readonly auth = inject(AuthService);
  protected readonly review = inject(ReviewStore);
  protected readonly viewport = inject(ViewportService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly header = viewChild.required(WorkspaceHeader);
  private readonly sidebar = viewChild.required<ElementRef<HTMLElement>>('sidebar');

  /** Desktop preference: icon-only sidebar. */
  protected readonly collapsed = signal(readCollapsedPreference());
  /** Mobile/tablet: whether the drawer is open. */
  protected readonly drawerOpen = signal(false);
  protected readonly loggingOut = signal(false);

  protected readonly compact = computed(() => this.viewport.isDesktop() && this.collapsed());
  protected readonly drawerHidden = computed(
    () => !this.viewport.isDesktop() && !this.drawerOpen(),
  );
  protected readonly showBackdrop = computed(() => !this.viewport.isDesktop() && this.drawerOpen());
  protected readonly sidebarClasses = computed(() => {
    if (!this.viewport.isDesktop()) {
      return this.drawerOpen() ? 'translate-x-0' : '-translate-x-full invisible';
    }
    return this.collapsed() ? 'w-16' : 'w-64';
  });

  protected toggleCollapsed(): void {
    this.collapsed.update((value) => !value);
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, String(this.collapsed()));
    } catch {
      // Storage unavailable (private mode etc.) — the preference just won't persist.
    }
  }

  protected openDrawer(): void {
    this.drawerOpen.set(true);
    afterNextRender(
      () => this.sidebar().nativeElement.querySelector<HTMLElement>('button, a')?.focus(),
      {
        injector: this.injector,
      },
    );
  }

  protected closeDrawer(): void {
    if (!this.drawerOpen()) {
      return;
    }
    this.drawerOpen.set(false);
    // Return focus to the control that opened the drawer.
    this.header().menuButton().nativeElement.focus();
  }

  protected runReview(): void {
    this.review.submit();
    this.closeDrawer();
    if (this.router.url !== '/workspace') {
      void this.router.navigateByUrl('/workspace');
    }
  }

  protected logout(): void {
    this.loggingOut.set(true);
    this.auth.logout().subscribe({ complete: () => this.loggingOut.set(false) });
  }
}
