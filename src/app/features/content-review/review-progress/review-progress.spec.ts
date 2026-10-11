import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FakeEventSource, flushCsrf, provideTestHttp } from '../../../testing/test-providers';
import { HttpTestingController } from '@angular/common/http/testing';
import { DocumentService } from '../../workspace/document.service';
import { ModelSelection } from '../model-selection';
import { ReviewStore } from '../review.store';
import { ReviewProgressCard, formatElapsed } from './review-progress';

describe('ReviewProgressCard', () => {
  let fixture: ComponentFixture<ReviewProgressCard>;
  let el: HTMLElement;
  let store: ReviewStore;
  let http: HttpTestingController;

  // whenStable() can't settle under fake timers, so render explicitly.
  const render = () => fixture.detectChanges();
  const tick = (ms: number) => {
    vi.advanceTimersByTime(ms);
    render();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [...provideTestHttp(), DocumentService, ModelSelection, ReviewStore],
    });
    store = TestBed.inject(ReviewStore);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(DocumentService).setContent('the teh cat');
    store.submit();
    flushCsrf(http);
    http
      .expectOne({ method: 'POST', url: '/api/v1/reviews' })
      .flush(
        { reviewId: 'rid', status: 'pending', eventsUrl: '/x', createdAt: '2026-10-01T10:00:00Z' },
        { status: 202, statusText: 'Accepted' },
      );
    FakeEventSource.latest().open();
    fixture = TestBed.createComponent(ReviewProgressCard);
    el = fixture.nativeElement;
    render();
  });

  afterEach(() => vi.useRealTimers());

  it('shows the step, a spinner and the elapsed time', () => {
    FakeEventSource.latest().emit('review.progress', 1, {
      reviewId: 'rid',
      stage: 'analyzing',
      attempt: 1,
      occurredAt: '2026-10-01T10:00:00Z',
    });
    tick(2_000);
    expect(el.textContent).toContain('Checking spelling, grammar and language');
    expect(el.textContent).toContain('Elapsed 0:02');
    expect(el.querySelector('app-spinner')).not.toBeNull();
    expect(el.textContent).not.toContain('Still working');
  });

  it('adds the "still working" note after 30 s (3 s in tests)', () => {
    tick(3_000);
    expect(el.querySelector('[role=status]')?.textContent).toContain(
      'Still working… large documents and busy models can take up to 2 minutes.',
    );
    expect(el.querySelector('app-spinner')).not.toBeNull();
  });

  it('replaces the spinner with Check status and Cancel and retry when stalled', () => {
    tick(15_000);
    http.match({ method: 'GET', url: '/api/v1/reviews/rid' }); // the automatic re-fetch
    render();
    expect(el.querySelector('app-spinner')).toBeNull();
    expect(el.querySelector('[data-testid=review-stalled]')?.textContent).toContain(
      'This is taking longer than expected',
    );
    expect(el.querySelector('[data-testid=check-status]')).not.toBeNull();
    expect(el.querySelector('[data-testid=cancel-retry]')).not.toBeNull();
  });

  it('Check status re-fetches and says the review is still running', () => {
    tick(15_000);
    http.match({ method: 'GET', url: '/api/v1/reviews/rid' });
    el.querySelector<HTMLButtonElement>('[data-testid=check-status]')!.click();
    render();
    expect(el.querySelector<HTMLButtonElement>('[data-testid=check-status]')!.disabled).toBe(true);
    const [get] = http.match({ method: 'GET', url: '/api/v1/reviews/rid' });
    get.flush({
      review: {
        reviewId: 'rid',
        documentTitle: 'Doc',
        status: 'processing',
        categories: ['grammar'],
        findingCount: 0,
        errorCode: null,
        errorMessage: null,
        createdAt: '2026-10-01T10:00:00Z',
        updatedAt: '2026-10-01T10:00:00Z',
        completedAt: null,
        content: 'the teh cat',
        contentLength: 11,
        findings: [],
        eventsUrl: '/x',
      },
    });
    render();
    expect(el.querySelector('[data-testid=still-running]')?.textContent).toContain('still running');
  });

  it('Cancel and retry submits the document again', () => {
    tick(15_000);
    http.match({ method: 'GET', url: '/api/v1/reviews/rid' });
    el.querySelector<HTMLButtonElement>('[data-testid=cancel-retry]')!.click();
    render();
    http.expectOne({ method: 'POST', url: '/api/v1/reviews' });
    expect(el.querySelector('[data-testid=review-stalled]')).toBeNull();
  });
});

describe('formatElapsed', () => {
  it.each([
    [0, '0:00'],
    [42_000, '0:42'],
    [125_000, '2:05'],
  ])('%i ms → %s', (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });
});
