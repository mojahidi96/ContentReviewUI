import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../../core/http/api-error';
import {
  REVIEW_ID,
  TEST_CSRF_TOKEN,
  flushCsrf,
  makeFindingDto,
  makeReviewDto,
  provideTestHttp,
} from '../../testing/test-providers';
import { ContentReviewApiService } from './content-review-api.service';

describe('ContentReviewApiService', () => {
  let api: ContentReviewApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideTestHttp() });
    api = TestBed.inject(ContentReviewApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('creates a review with the Node field names, categories and a CSRF header', async () => {
    const result = firstValueFrom(
      api.createReview({ title: 'Doc', content: 'Hello', categories: ['grammar', 'spelling'] }),
    );
    flushCsrf(http);
    const req = http.expectOne('/api/v1/reviews');
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.headers.get('X-CSRF-Token')).toBe(TEST_CSRF_TOKEN);
    expect(req.request.body).toEqual({
      documentTitle: 'Doc',
      content: 'Hello',
      categories: ['grammar', 'spelling'],
    });
    req.flush(
      {
        reviewId: REVIEW_ID,
        status: 'pending',
        eventsUrl: `/api/v1/reviews/${REVIEW_ID}/events`,
        createdAt: '2026-10-01T10:00:00.000Z',
      },
      { status: 202, statusText: 'Accepted' },
    );
    expect(await result).toEqual({ id: REVIEW_ID, status: 'pending' });
  });

  it('maps a review and converts code-point offsets to UTF-16 ranges', async () => {
    const content = 'Hi 😀 wrld and teh end';
    const result = firstValueFrom(api.getReview(REVIEW_ID));
    http.expectOne(`/api/v1/reviews/${REVIEW_ID}`).flush({
      review: makeReviewDto(content, [
        makeFindingDto({
          findingId: 'fnd_a',
          originalText: 'wrld',
          suggestedText: 'world',
          startOffset: 5, // code points: 😀 counts once
          endOffset: 9,
        }),
      ]),
    });
    const review = await result;
    expect(review.id).toBe(REVIEW_ID);
    expect(review.title).toBe('Doc');
    const [finding] = review.findings;
    expect(finding).toMatchObject({ id: 'fnd_a', excerpt: 'wrld', suggestion: 'world' });
    expect(finding.range).toEqual({ start: 6, end: 10 }); // UTF-16: 😀 is two units
    expect(content.slice(finding.range!.start, finding.range!.end)).toBe('wrld');
  });

  it('drops a range whose offsets do not select the original text', async () => {
    const result = firstValueFrom(api.getReview(REVIEW_ID));
    http.expectOne(`/api/v1/reviews/${REVIEW_ID}`).flush({
      review: makeReviewDto('The cat sat', [
        makeFindingDto({ originalText: 'dog', startOffset: 4, endOffset: 7 }),
      ]),
    });
    expect((await result).findings[0].range).toBeUndefined();
  });

  it('turns a malformed review body into an invalid_response error', async () => {
    const result = firstValueFrom(api.getReview(REVIEW_ID));
    http.expectOne(`/api/v1/reviews/${REVIEW_ID}`).flush({ reviewId: REVIEW_ID }); // not wrapped
    await expect(result).rejects.toSatisfy(
      (error: unknown) => toApiError(error).kind === 'invalid_response',
    );
  });

  it('lists a page of reviews with page/limit query parameters', async () => {
    const result = firstValueFrom(api.listReviews(2, 10));
    const req = http.expectOne((r) => r.url === '/api/v1/reviews');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('limit')).toBe('10');
    const summary: Record<string, unknown> = { ...makeReviewDto('x', []) };
    for (const key of ['content', 'findings', 'contentLength', 'eventsUrl']) delete summary[key];
    req.flush({ items: [summary], page: 2, limit: 10, total: 11, totalPages: 2 });
    expect(await result).toEqual({
      items: [
        {
          id: REVIEW_ID,
          title: 'Doc',
          createdAt: '2026-10-01T10:00:00.000Z',
          status: 'completed',
          findingCount: 0,
          errorCode: null,
        },
      ],
      page: 2,
      totalPages: 2,
      total: 11,
    });
  });

  it('patches a finding status and maps the wrapped finding', async () => {
    const result = firstValueFrom(
      api.updateFindingStatus(REVIEW_ID, 'fnd_1', 'dismissed', 'The teh end'),
    );
    flushCsrf(http);
    const req = http.expectOne(`/api/v1/reviews/${REVIEW_ID}/findings/fnd_1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'dismissed' });
    req.flush({ finding: makeFindingDto({ findingId: 'fnd_1', status: 'dismissed' }) });
    expect(await result).toMatchObject({
      id: 'fnd_1',
      status: 'dismissed',
      range: { start: 4, end: 7 },
    });
  });

  it('builds the events URL with an optional lastEventId', () => {
    expect(api.eventsUrl(REVIEW_ID)).toBe(`/api/v1/reviews/${REVIEW_ID}/events`);
    expect(api.eventsUrl(REVIEW_ID, 7)).toBe(`/api/v1/reviews/${REVIEW_ID}/events?lastEventId=7`);
  });
});
