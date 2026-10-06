import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  FakeEventSource,
  REVIEW_ID,
  completeReviewFlow,
  findingToDto,
  flushCsrf,
  makeFinding,
  provideTestHttp,
} from '../../../testing/test-providers';
import { DocumentService } from '../../workspace/document.service';
import { FindingsPanel } from './findings-panel';
import { ReviewStore } from '../review.store';

describe('FindingsPanel', () => {
  let fixture: ComponentFixture<FindingsPanel>;
  let el: HTMLElement;
  let http: HttpTestingController;
  let doc: DocumentService;

  const button = (text: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(text));

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [FindingsPanel],
      providers: [...provideTestHttp(), DocumentService, ReviewStore],
    });
    http = TestBed.inject(HttpTestingController);
    doc = TestBed.inject(DocumentService);
    doc.setContent('the teh cat');
    fixture = TestBed.createComponent(FindingsPanel);
    el = fixture.nativeElement;
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('invites the user to run a review', () => {
    expect(el.textContent).toContain('No review yet');
    expect(button('Run Content Review')).toBeDefined();
  });

  it('walks through loading, error and retry', async () => {
    button('Run Content Review')!.click();
    await fixture.whenStable();
    expect(el.textContent).toContain('Reviewing your document');
    expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();

    flushCsrf(http);
    http.expectOne('/api/v1/reviews').flush(null, { status: 504, statusText: 'Gateway Timeout' });
    await fixture.whenStable();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Review failed');
    expect(el.textContent).toContain('took longer than expected');
    expect(doc.content()).toBe('the teh cat');

    button('Retry review')!.click();
    await fixture.whenStable();
    completeReviewFlow(http, 'the teh cat', [makeFinding()]);
    await fixture.whenStable();
    expect(el.querySelector('[role=alert]')).toBeNull();
    expect(el.textContent).toContain('1 total');
    expect(el.querySelectorAll('app-finding-card')).toHaveLength(1);
  });

  it('shows an empty state when the review finds nothing', async () => {
    TestBed.inject(ReviewStore).submit();
    completeReviewFlow(http, 'the teh cat', []);
    await fixture.whenStable();
    expect(el.textContent).toContain('No issues found');
  });

  const showReview = async (findings = [makeFinding()]) => {
    TestBed.inject(ReviewStore).submit();
    completeReviewFlow(http, 'the teh cat', findings);
    await fixture.whenStable();
  };

  it('accepts and undoes locally, without confirmation or API calls', async () => {
    await showReview();
    expect(button('Save Changes')!.disabled).toBe(true);

    button('Accept')!.click();
    await fixture.whenStable();
    expect(doc.content()).toBe('the the cat');
    expect(el.querySelector('dialog[open]')).toBeNull();
    expect(button('Save Changes')!.disabled).toBe(false);

    button('Undo')!.click();
    await fixture.whenStable();
    expect(doc.content()).toBe('the teh cat');
    expect(button('Save Changes')!.disabled).toBe(true);
    http.expectNone(() => true);
  });

  it('confirms before saving accepted changes', async () => {
    await showReview();
    button('Accept')!.click();
    await fixture.whenStable();

    button('Save Changes')!.click();
    await fixture.whenStable();
    expect(el.querySelector('dialog[open]')?.textContent).toContain('can’t be undone');
    http.expectNone(() => true);

    [...el.querySelectorAll('dialog[open] button')]
      .find((b) => b.textContent?.includes('Save Changes'))!
      .dispatchEvent(new MouseEvent('click'));
    await fixture.whenStable();
    const patch = http.expectOne({
      method: 'PATCH',
      url: `/api/v1/reviews/${REVIEW_ID}/findings/fnd_1`,
    });
    expect(patch.request.body).toEqual({ status: 'accepted' });
    patch.flush({ finding: findingToDto(makeFinding({ status: 'accepted' })) });
    await fixture.whenStable();
    expect(el.textContent).toContain('Resolved');
    expect(button('Undo')).toBeUndefined();
    expect(button('Save Changes')!.disabled).toBe(true);
  });

  it('starts with every card expanded and toggles them all', async () => {
    await showReview([makeFinding(), makeFinding({ id: 'fnd_2', range: { start: 8, end: 11 } })]);
    const bodies = () => [...el.querySelectorAll<HTMLElement>('[id^="finding-body-"]')];
    expect(bodies().every((b) => !b.hidden)).toBe(true);

    button('Collapse all')!.click();
    await fixture.whenStable();
    expect(bodies().every((b) => b.hidden)).toBe(true);

    button('Expand all')!.click();
    await fixture.whenStable();
    expect(bodies().every((b) => !b.hidden)).toBe(true);
  });

  it('warns when the document changed after the review', async () => {
    await showReview();
    doc.setContent('the teh cat, edited');
    await fixture.whenStable();
    expect(el.textContent).toContain('The document has changed since this review');
    expect(button('Accept')!.disabled).toBe(true);
  });

  it('shows the server-reported stage while the review runs', async () => {
    TestBed.inject(ReviewStore).submit();
    flushCsrf(http);
    http
      .expectOne('/api/v1/reviews')
      .flush(
        { reviewId: REVIEW_ID, status: 'pending', eventsUrl: '', createdAt: '' },
        { status: 202, statusText: 'Accepted' },
      );
    await fixture.whenStable();
    expect(el.textContent).toContain('Submitting your document');

    FakeEventSource.latest().emit('review.progress', 1, {
      reviewId: REVIEW_ID,
      stage: 'analyzing',
      attempt: 1,
      occurredAt: '',
    });
    await fixture.whenStable();
    expect(el.textContent).toContain('Checking spelling, grammar and language');
    FakeEventSource.latest().close();
  });

  it('dismisses a finding from its card', async () => {
    await showReview();
    button('Dismiss')!.click();
    await fixture.whenStable();
    const patch = http.expectOne(`/api/v1/reviews/${REVIEW_ID}/findings/fnd_1`);
    expect(patch.request.body).toEqual({ status: 'dismissed' });
    patch.flush({ finding: findingToDto(makeFinding({ status: 'dismissed' })) });
    await fixture.whenStable();
    expect(el.textContent).toContain('Dismissed');
    const dismissButtons = [...el.querySelectorAll('button')].filter(
      (b) => b.textContent?.trim() === 'Dismiss',
    );
    expect(dismissButtons).toHaveLength(0);
  });
});
