import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { REQUEST_TIMEOUT_MS } from '../../core/http/http-context';
import {
  TEST_CONFIG,
  makeFinding,
  makeReview,
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

  it('creates a review with the submitted content and the long review timeout', async () => {
    const review = makeReview('the teh cat', [makeFinding()]);
    const result = firstValueFrom(api.createReview({ title: 'Doc', content: 'the teh cat' }));
    const req = http.expectOne({ method: 'POST', url: '/api/v1/reviews' });
    expect(req.request.body).toEqual({ title: 'Doc', content: 'the teh cat' });
    expect(req.request.context.get(REQUEST_TIMEOUT_MS)).toBe(TEST_CONFIG.reviewTimeoutMs);
    req.flush(review);
    expect(await result).toEqual(review);
  });

  it('unwraps the review list', async () => {
    const result = firstValueFrom(api.listReviews());
    http.expectOne({ method: 'GET', url: '/api/v1/reviews' }).flush({ items: [] });
    expect(await result).toEqual([]);
  });

  it('encodes path parameters', () => {
    api.getReview('a/b').subscribe();
    http.expectOne('/api/v1/reviews/a%2Fb').flush(makeReview('x', []));
  });

  it('patches a finding status', async () => {
    const result = firstValueFrom(api.updateFindingStatus('rev_1', 'fnd_1', 'accepted'));
    const req = http.expectOne({ method: 'PATCH', url: '/api/v1/reviews/rev_1/findings/fnd_1' });
    expect(req.request.body).toEqual({ status: 'accepted' });
    req.flush(makeFinding({ status: 'accepted' }));
    expect((await result).status).toBe('accepted');
  });
});
