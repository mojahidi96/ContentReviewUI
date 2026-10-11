import { DestroyRef, Component, computed, inject, input, output, signal } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faCircleExclamation, faRotateRight } from '@fortawesome/free-solid-svg-icons';
import { ButtonDirective } from '../../../shared/components/button.directive';
import { ModelSelection, failedModelOf } from '../model-selection';
import { QUOTA_ERROR_CODE, TIMEOUT_ERROR_CODE, type ReviewFailure } from '../review.models';
import { formatResetTime, formatTimeLeft } from './failure-time';

/**
 * Why a review did not complete. One component serves the live run and a failed review opened
 * from history, so a reload shows exactly what the live event showed. `message` is always
 * displayed; for quota failures it adds the reset time, a countdown-gated Retry and a way to
 * pick another model.
 */
@Component({
  selector: 'app-review-failure',
  imports: [FaIconComponent, ButtonDirective],
  templateUrl: './review-failure.html',
})
export class ReviewFailureBanner {
  private readonly models = inject(ModelSelection);

  /** Absent for failures that did not come from a review (request errors, lost stream). */
  readonly failure = input<ReviewFailure | null>(null);
  readonly message = input<string | null>(null);
  /** The stream was lost but the review may still finish. */
  readonly resumable = input(false);

  readonly retry = output();
  /** Run the review again with the next available model. */
  readonly tryAnother = output();

  private readonly now = signal(Date.now());

  protected readonly isQuota = computed(() => this.failure()?.code === QUOTA_ERROR_CODE);
  protected readonly quota = computed(() => this.failure()?.quota ?? null);
  protected readonly resetAtMs = computed(() => this.quota()?.resetAtMs ?? null);
  protected readonly waiting = computed(() => {
    const reset = this.resetAtMs();
    return reset !== null && this.now() < reset;
  });
  protected readonly resetIso = computed(() => new Date(this.resetAtMs() ?? 0).toISOString());
  protected readonly resetLabel = computed(() =>
    formatResetTime(this.resetAtMs() ?? 0, this.now()),
  );
  protected readonly timeLeft = computed(() => formatTimeLeft(this.resetAtMs() ?? 0, this.now()));
  /** A daily quota cannot recover sooner, so Retry waits for it. */
  protected readonly retryBlocked = computed(
    () => this.quota()?.scope === 'daily' && this.waiting(),
  );
  protected readonly isTimeout = computed(() => this.failure()?.code === TIMEOUT_ERROR_CODE);
  protected readonly title = computed(() =>
    this.isQuota() ? 'AI quota reached' : this.isTimeout() ? 'Review timed out' : 'Review failed',
  );
  /** Another model can help when this one is out of quota or too slow. */
  protected readonly canTryAnother = computed(() => {
    const failure = this.failure();
    return (
      !!failure &&
      (this.isQuota() || this.isTimeout()) &&
      this.models.hasAlternative(failedModelOf(failure, this.models.defaultModel()))
    );
  });

  protected readonly errorIcon = faCircleExclamation;
  protected readonly retryIcon = faRotateRight;

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
