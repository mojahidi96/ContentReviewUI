import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faCircleExclamation,
  faClockRotateLeft,
  faRotateRight,
} from '@fortawesome/free-solid-svg-icons';
import { Subject, catchError, map, of, startWith, switchMap } from 'rxjs';
import { ErrorHandlingService } from '../../core/http/error-handling.service';
import { Badge } from '../../shared/components/badge';
import { ButtonDirective } from '../../shared/components/button.directive';
import { EmptyState } from '../../shared/components/empty-state';
import { Spinner } from '../../shared/components/spinner';
import { ContentReviewApiService } from './content-review-api.service';
import type { ReviewSummary } from './review.models';
import { ReviewStore } from './review.store';

type HistoryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; items: readonly ReviewSummary[] };

@Component({
  selector: 'app-review-history-page',
  imports: [DatePipe, FaIconComponent, Badge, ButtonDirective, EmptyState, Spinner],
  host: { class: 'block' },
  template: `
    <div class="mx-auto max-w-4xl p-4 sm:p-6">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h1 class="text-xl font-semibold text-slate-900 dark:text-slate-100">Review history</h1>
          <p class="text-sm text-slate-600 dark:text-slate-400">
            Previous reviews are stored by the review service. Open one to see its findings.
          </p>
        </div>
        <button
          type="button"
          appButton
          variant="secondary"
          size="sm"
          [disabled]="state().status === 'loading'"
          (click)="reload()"
        >
          <fa-icon [icon]="reloadIcon" /> Refresh
        </button>
      </div>

      <div class="mt-6" [attr.aria-busy]="state().status === 'loading'">
        @switch (state().status) {
          @case ('loading') {
            <p class="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
              <app-spinner /> Loading reviews…
            </p>
          }
          @case ('error') {
            <div
              class="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"
              role="alert"
            >
              <p class="flex items-center gap-2 font-medium">
                <fa-icon [icon]="errorIcon" /> Could not load review history
              </p>
              <p class="mt-1">{{ errorMessage() }}</p>
              <button
                type="button"
                appButton
                variant="secondary"
                size="sm"
                class="mt-3"
                (click)="reload()"
              >
                Try again
              </button>
            </div>
          }
          @case ('loaded') {
            @if (items().length === 0) {
              <app-empty-state [icon]="historyIcon" heading="No reviews yet">
                Reviews you run from the workspace will appear here.
              </app-empty-state>
            } @else {
              <ul
                class="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900"
              >
                @for (item of items(); track item.id) {
                  <li class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <div class="min-w-0 flex-1">
                      <p class="truncate font-medium text-slate-900 dark:text-slate-100">
                        {{ item.title }}
                      </p>
                      <p class="text-xs text-slate-600 dark:text-slate-400">
                        <time [attr.datetime]="item.createdAt">{{
                          item.createdAt | date: 'medium'
                        }}</time>
                        · {{ item.contentLength.toLocaleString() }} characters
                      </p>
                      <div class="mt-2 flex flex-wrap gap-1.5">
                        <app-badge>{{ item.findingCounts.total }} findings</app-badge>
                        @if (item.findingCounts.pending) {
                          <app-badge tone="warning"
                            >{{ item.findingCounts.pending }} need review</app-badge
                          >
                        }
                        @if (item.findingCounts.resolved) {
                          <app-badge tone="success"
                            >{{ item.findingCounts.resolved }} resolved</app-badge
                          >
                        }
                        @if (item.id === store.review()?.id) {
                          <app-badge tone="brand">Currently open</app-badge>
                        }
                      </div>
                    </div>
                    <button
                      type="button"
                      appButton
                      variant="secondary"
                      size="sm"
                      (click)="open(item)"
                    >
                      Open<span class="sr-only"> review “{{ item.title }}”</span>
                    </button>
                  </li>
                }
              </ul>
            }
          }
        }
      </div>
    </div>
  `,
})
export class ReviewHistoryPage {
  private readonly api = inject(ContentReviewApiService);
  private readonly errors = inject(ErrorHandlingService);
  private readonly router = inject(Router);
  protected readonly store = inject(ReviewStore);

  protected readonly state = signal<HistoryState>({ status: 'loading' });
  private readonly reload$ = new Subject<void>();

  protected readonly historyIcon = faClockRotateLeft;
  protected readonly reloadIcon = faRotateRight;
  protected readonly errorIcon = faCircleExclamation;

  constructor() {
    this.reload$
      .pipe(
        startWith(undefined),
        switchMap(() =>
          this.api.listReviews().pipe(
            map((items): HistoryState => ({ status: 'loaded', items })),
            catchError((error: unknown) =>
              of<HistoryState>({ status: 'error', message: this.errors.userMessage(error) }),
            ),
            startWith<HistoryState>({ status: 'loading' }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.state.set(state));
  }

  protected items(): readonly ReviewSummary[] {
    const state = this.state();
    return state.status === 'loaded' ? state.items : [];
  }

  protected errorMessage(): string {
    const state = this.state();
    return state.status === 'error' ? state.message : '';
  }

  protected reload(): void {
    this.reload$.next();
  }

  protected open(item: ReviewSummary): void {
    this.store.loadReview(item.id);
    void this.router.navigateByUrl('/workspace');
  }
}
