import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faCircleExclamation,
  faClockRotateLeft,
  faRotateRight,
} from '@fortawesome/free-solid-svg-icons';
import { Subject, catchError, map, of, startWith, switchMap } from 'rxjs';
import { APP_CONFIG } from '../../../core/config/app-config';
import { ErrorHandlingService } from '../../../core/http/error-handling.service';
import type { BadgeTone } from '../../../shared/components/badge';
import { Badge } from '../../../shared/components/badge';
import { ButtonDirective } from '../../../shared/components/button.directive';
import { EmptyState } from '../../../shared/components/empty-state';
import { Spinner } from '../../../shared/components/spinner/spinner';
import { ContentReviewApiService } from '../content-review-api.service';
import type { ReviewPage, ReviewStatus, ReviewSummary } from '../review.models';
import { ReviewStore } from '../review.store';

type HistoryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; page: ReviewPage };

const STATUS_BADGE: Record<ReviewStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Queued', tone: 'neutral' },
  processing: { label: 'In progress', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

@Component({
  selector: 'app-review-history-page',
  imports: [DatePipe, FaIconComponent, Badge, ButtonDirective, EmptyState, Spinner],
  host: { class: 'block' },
  templateUrl: './review-history.page.html',
  styleUrl: './review-history.page.scss',
})
export class ReviewHistoryPage {
  private readonly api = inject(ContentReviewApiService);
  private readonly pageSize = inject(APP_CONFIG).review.pageSize;
  private readonly errors = inject(ErrorHandlingService);
  private readonly router = inject(Router);
  protected readonly store = inject(ReviewStore);

  protected readonly state = signal<HistoryState>({ status: 'loading' });
  protected readonly page = signal(1);
  protected readonly totalPages = computed(() => {
    const state = this.state();
    return state.status === 'loaded' ? state.page.totalPages : 0;
  });
  private readonly reload$ = new Subject<void>();

  protected readonly historyIcon = faClockRotateLeft;
  protected readonly reloadIcon = faRotateRight;
  protected readonly errorIcon = faCircleExclamation;

  constructor() {
    this.reload$
      .pipe(
        startWith(undefined),
        switchMap(() =>
          this.api.listReviews(this.page(), this.pageSize).pipe(
            map((page): HistoryState => ({ status: 'loaded', page })),
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
    return state.status === 'loaded' ? state.page.items : [];
  }

  protected statusBadge(item: ReviewSummary): { label: string; tone: BadgeTone } {
    return STATUS_BADGE[item.status];
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.reload$.next();
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
