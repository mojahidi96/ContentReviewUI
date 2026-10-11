import { Component, computed, inject } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faClock, faRotateRight, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { ButtonDirective } from '../../../shared/components/button.directive';
import { Spinner } from '../../../shared/components/spinner/spinner';
import { ReviewStore } from '../review.store';

/** "0:42", "2:05". */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * What the user sees while a review runs: the step, the elapsed time, a reassurance after a
 * while, and, once it looks stuck, actions instead of an endless spinner.
 */
@Component({
  selector: 'app-review-progress',
  imports: [FaIconComponent, ButtonDirective, Spinner],
  templateUrl: './review-progress.html',
})
export class ReviewProgressCard {
  protected readonly store = inject(ReviewStore);
  protected readonly elapsed = computed(() => formatElapsed(this.store.elapsedMs()));

  protected readonly clockIcon = faClock;
  protected readonly warnIcon = faTriangleExclamation;
  protected readonly retryIcon = faRotateRight;
}
