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
import { AuthService } from '../../core/auth/auth.service';
import { ViewportService } from '../../core/layout/viewport.service';
import { ReviewStore } from '../content-review/review.store';
import { DocumentService } from './document.service';
import { SidePanel } from './side-panel';
import { WorkspaceHeader } from './workspace-header';

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
  template: `
    <a
      href="#main-content"
      class="sr-only z-50 rounded-md bg-white px-3 py-2 text-sm font-medium text-brand-700 shadow focus:not-sr-only focus:fixed focus:top-2 focus:left-2 dark:bg-slate-900 dark:text-brand-300"
      >Skip to content</a
    >
    <app-workspace-header
      [user]="auth.user()"
      [drawerOpen]="drawerOpen()"
      [loggingOut]="loggingOut()"
      (menuToggled)="openDrawer()"
      (logoutRequested)="logout()"
    />

    <div class="relative flex min-h-0 flex-1">
      @if (showBackdrop()) {
        <div
          class="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          aria-hidden="true"
          (click)="closeDrawer()"
        ></div>
      }

      <aside
        #sidebar
        id="workspace-sidebar"
        aria-label="Tools"
        class="z-40 shrink-0 border-r border-slate-200 bg-white transition-[width,transform] duration-200 ease-out motion-reduce:transition-none max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:w-72 max-lg:shadow-xl dark:border-slate-800 dark:bg-slate-900"
        [class]="sidebarClasses()"
        [attr.inert]="drawerHidden() ? '' : null"
      >
        <app-side-panel
          [collapsed]="compact()"
          [collapsible]="viewport.isDesktop()"
          [reviewing]="review.isLoading()"
          [canReview]="auth.canEdit()"
          (reviewRequested)="runReview()"
          (collapseToggled)="toggleCollapsed()"
          (navigated)="closeDrawer()"
        />
      </aside>

      <!-- Read-only users have nothing focusable in the content, so the scroll area itself
           takes focus to stay keyboard-scrollable. -->
      <main
        id="main-content"
        [attr.tabindex]="auth.canEdit() ? -1 : 0"
        class="min-w-0 flex-1 overflow-y-auto focus:outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        <router-outlet />
      </main>
    </div>
  `,
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
