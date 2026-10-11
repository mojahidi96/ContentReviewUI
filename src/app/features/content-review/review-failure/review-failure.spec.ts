import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTestHttp } from '../../../testing/test-providers';
import { ModelSelection } from '../model-selection';
import type { QuotaScope, ReviewFailure } from '../review.models';
import { ReviewFailureBanner } from './review-failure';
import { formatResetTime, formatTimeLeft } from './failure-time';

const HOUR = 3_600_000;
const MESSAGE =
  'The daily quota for model gemini-3.6-flash is exhausted. It resets in about 1h 58m.';

const quotaFailure = (scope: QuotaScope, resetAtMs: number | null): ReviewFailure => ({
  code: 'LLM_SERVICE_RATE_LIMITED',
  message: MESSAGE,
  model: 'gemini-3.6-flash',
  quota: { model: 'gemini-3.6-flash', scope, resetAtMs },
});

describe('ReviewFailureBanner', () => {
  let fixture: ComponentFixture<ReviewFailureBanner>;
  let el: HTMLElement;
  let models: ModelSelection;

  const render = async (failure: ReviewFailure | null, message: string | null = MESSAGE) => {
    fixture.componentRef.setInput('failure', failure);
    fixture.componentRef.setInput('message', message);
    await fixture.whenStable();
  };
  const retry = () => el.querySelector<HTMLButtonElement>('[data-testid=retry-review]')!;
  const another = () => el.querySelector<HTMLButtonElement>('[data-testid=try-another-model]');

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [...provideTestHttp(), ModelSelection] });
    models = TestBed.inject(ModelSelection);
    // Two models are on offer so "Try another model" makes sense.
    models.load();
    const { HttpTestingController } = await import('@angular/common/http/testing');
    TestBed.inject(HttpTestingController)
      .expectOne('/api/v1/reviews/models')
      .flush({
        defaultModel: 'gemini-3.6-flash',
        models: ['gemini-3.6-flash', 'gemini-3.8-flash'],
      });
    fixture = TestBed.createComponent(ReviewFailureBanner);
    el = fixture.nativeElement;
  });

  it('titles a quota failure, shows the message and the local reset time with a relative hint', async () => {
    const resetAt = Date.now() + 2 * HOUR;
    await render(quotaFailure('daily', resetAt));
    expect(el.querySelector('[role=alert]')?.textContent).toContain('AI quota reached');
    expect(el.querySelector('[data-testid=failure-message]')?.textContent).toBe(MESSAGE);
    const reset = el.querySelector('[data-testid=quota-reset]')!.textContent!;
    expect(reset).toContain(`Resets at ${formatResetTime(resetAt, Date.now())}`);
    expect(reset).toContain('in about 2 hours');
    expect(el.querySelector('time')?.getAttribute('datetime')).toBe(
      new Date(resetAt).toISOString(),
    );
  });

  it('shows only the message when a quota failure has no reset information', async () => {
    await render(quotaFailure('unknown', null));
    expect(el.querySelector('[data-testid=failure-message]')?.textContent).toBe(MESSAGE);
    expect(el.querySelector('[data-testid=quota-reset]')).toBeNull();
    expect(retry().disabled).toBe(false);
  });

  it('disables Retry for a daily quota until it resets', async () => {
    await render(quotaFailure('daily', Date.now() + HOUR));
    expect(retry().disabled).toBe(true);
    expect(retry().getAttribute('aria-describedby')).toBe('quota-reset');
  });

  it('enables Retry for a daily quota whose reset time has passed', async () => {
    await render(quotaFailure('daily', Date.now() - 1000));
    expect(retry().disabled).toBe(false);
    expect(el.querySelector('[data-testid=quota-reset]')?.textContent).toContain('has reset');
  });

  it.each<QuotaScope>(['minute', 'unknown'])(
    'keeps Retry enabled for a %s quota',
    async (scope) => {
      await render(quotaFailure(scope, Date.now() + HOUR));
      expect(retry().disabled).toBe(false);
    },
  );

  it('emits retry', async () => {
    await render(quotaFailure('minute', null));
    const emitted = vi.fn();
    fixture.componentInstance.retry.subscribe(emitted);
    retry().click();
    expect(emitted).toHaveBeenCalledOnce();
  });

  it('emits tryAnother from "Try another model"', async () => {
    await render(quotaFailure('daily', Date.now() + HOUR));
    const emitted = vi.fn();
    fixture.componentInstance.tryAnother.subscribe(emitted);
    another()!.click();
    expect(emitted).toHaveBeenCalledOnce();
  });

  it('hides "Try another model" when there is no other model', async () => {
    models.markQuotaReached('gemini-3.8-flash', null);
    await render(quotaFailure('daily', Date.now() + HOUR));
    expect(another()).toBeNull();
  });

  it('shows only errorMessage for other failures, never the code', async () => {
    const failure: ReviewFailure = {
      code: 'PROCESSING_FAILED',
      message: 'It took too long.',
      model: null,
      quota: null,
    };
    await render(failure, 'It took too long.');
    const text = el.textContent!;
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Review failed');
    expect(el.querySelector('[data-testid=failure-message]')?.textContent).toBe(
      'It took too long.',
    );
    expect(text).not.toContain('PROCESSING_FAILED');
    expect(el.querySelector('[data-testid=quota-reset]')).toBeNull();
    expect(another()).toBeNull();
    expect(retry().disabled).toBe(false);
  });

  it('treats a timeout like a failure with Retry always enabled and another model offered', async () => {
    const failure: ReviewFailure = {
      code: 'LLM_SERVICE_TIMEOUT',
      message: 'The model took too long.',
      model: null,
      quota: null,
    };
    await render(failure, 'The model took too long.');
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Review timed out');
    expect(el.querySelector('[data-testid=failure-message]')?.textContent).toBe(
      'The model took too long.',
    );
    expect(retry().disabled).toBe(false);
    expect(el.querySelector('[data-testid=quota-reset]')).toBeNull();
    expect(another()).not.toBeNull();
  });

  it('offers Resume for an interrupted stream', async () => {
    fixture.componentRef.setInput('resumable', true);
    await render(null, 'We lost contact with the review.');
    expect(retry().textContent).toContain('Resume review');
  });
});

describe('failure time formatting', () => {
  const now = new Date('2026-10-11T00:00:00').getTime();

  it.each([
    [30_000, 'in less than a minute'],
    [60_000, 'in about 1 minute'],
    [45 * 60_000, 'in about 45 minutes'],
    [HOUR, 'in about 1 hour'],
    [2 * HOUR, 'in about 2 hours'],
    [72 * HOUR, 'in about 3 days'],
    [-5_000, 'now'],
  ])('%i ms ahead reads "%s"', (ahead, text) => {
    expect(formatTimeLeft(now + ahead, now)).toBe(text);
  });

  it('shows just the time for today and adds the date for later days', () => {
    const today = formatResetTime(now + HOUR, now);
    const later = formatResetTime(now + 30 * HOUR, now);
    expect(later.length).toBeGreaterThan(today.length);
  });
});
