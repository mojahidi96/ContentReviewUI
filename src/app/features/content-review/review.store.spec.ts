import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NotificationService } from '../../core/notifications/notification.service';
import {
  FakeEventSource,
  REVIEW_ID,
  TEST_CSRF_TOKEN,
  findingToDto,
  flushCsrf,
  makeFinding,
  provideTestHttp,
  reviewBody,
} from '../../testing/test-providers';
import { DocumentService } from '../workspace/document.service';
import type { Finding, ReviewStatus } from './review.models';
import { ReviewStore } from './review.store';

const AT = '2026-10-01T10:00:00.000Z';
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ReviewStore', () => {
  let store: ReviewStore;
  let doc: DocumentService;
  let http: HttpTestingController;

  const CONTENT = 'the teh cat sat';
  const spelling = makeFinding({
    id: 'fnd_spell',
    excerpt: 'teh',
    suggestion: 'the',
    range: { start: 4, end: 7 },
  });
  const later = makeFinding({
    id: 'fnd_later',
    excerpt: 'sat',
    suggestion: 'sits',
    range: { start: 12, end: 15 },
  });

  const reviewUrl = (id = REVIEW_ID) => `/api/v1/reviews/${id}`;
  const expectCreate = (): TestRequest => {
    flushCsrf(http);
    return http.expectOne({ method: 'POST', url: '/api/v1/reviews' });
  };
  /** Answers `POST /reviews` with 202 and returns the event stream the store opens. */
  const accept202 = (req = expectCreate(), id = REVIEW_ID): FakeEventSource => {
    req.flush(
      { reviewId: id, status: 'pending', eventsUrl: `${reviewUrl(id)}/events`, createdAt: AT },
      { status: 202, statusText: 'Accepted' },
    );
    const source = FakeEventSource.latest();
    source.open();
    return source;
  };
  const finishStream = (source: FakeEventSource, findingCount: number, firstId = 1) => {
    source.emit('review.started', firstId, {
      reviewId: REVIEW_ID,
      status: 'processing',
      occurredAt: AT,
    });
    source.emit('review.completed', firstId + 1, {
      reviewId: REVIEW_ID,
      status: 'completed',
      findingCount,
      completedAt: AT,
      occurredAt: AT,
    });
  };
  const flushSnapshot = (
    findings: Finding[],
    content = CONTENT,
    status: ReviewStatus = 'completed',
    id = REVIEW_ID,
  ) => {
    http
      .expectOne({ method: 'GET', url: reviewUrl(id) })
      .flush(reviewBody(content, findings, { reviewId: id, status }));
  };
  /** submit() → 202 → events → completed → GET snapshot. */
  const completeReview = (findings: Finding[] = [spelling, later], content = CONTENT) => {
    const source = accept202();
    finishStream(source, findings.length);
    flushSnapshot(findings, content);
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...provideTestHttp(), DocumentService, ReviewStore],
    });
    store = TestBed.inject(ReviewStore);
    doc = TestBed.inject(DocumentService);
    http = TestBed.inject(HttpTestingController);
    doc.setContent(CONTENT);
  });

  afterEach(() => http.verify());

  describe('submit', () => {
    it('sends the current editor content with Node field names, categories and CSRF', () => {
      doc.setTitle('  My report  ');
      doc.setContent('Edited by the user just now');
      store.submit();
      const req = expectCreate();
      expect(req.request.body).toEqual({
        documentTitle: 'My report',
        content: 'Edited by the user just now',
        categories: ['grammar', 'spelling', 'profanity'],
      });
      expect(req.request.headers.get('X-CSRF-Token')).toBe(TEST_CSRF_TOKEN);
    });

    it('follows the event stream with cookies, shows progress, then the persisted findings', () => {
      store.submit();
      expect(store.phase()).toBe('loading');
      expect(store.progressLabel()).toBeNull(); // still submitting

      const source = accept202();
      expect(source.url).toBe(`${reviewUrl()}/events`);
      expect(source.init.withCredentials).toBe(true);
      expect(store.currentReviewId()).toBe(REVIEW_ID);

      source.emit('review.started', 1, {
        reviewId: REVIEW_ID,
        status: 'processing',
        occurredAt: AT,
      });
      source.emit('review.progress', 2, {
        reviewId: REVIEW_ID,
        stage: 'retrying',
        attempt: 2,
        nextAttemptAt: AT,
        occurredAt: AT,
      });
      expect(store.progressLabel()).toMatch(/retrying/i);
      source.emit('finding.detected', 3, {
        reviewId: REVIEW_ID,
        finding: findingToDto(spelling),
        occurredAt: AT,
      });
      expect(store.detectedCount()).toBe(1);
      expect(store.isLoading()).toBe(true); // findings are only actionable once completed

      source.emit('review.completed', 4, {
        reviewId: REVIEW_ID,
        status: 'completed',
        findingCount: 2,
        completedAt: AT,
        occurredAt: AT,
      });
      expect(source.closed).toBe(true);
      flushSnapshot([spelling, later]);

      expect(store.phase()).toBe('success');
      expect(store.findings().map((f) => f.id)).toEqual(['fnd_spell', 'fnd_later']);
      expect(store.counts()).toMatchObject({ total: 2, pending: 2 });
      expect(store.viewMode()).toBe('review');
    });

    it('ignores events replayed after a reconnect', () => {
      store.submit();
      const source = accept202();
      const finding = { reviewId: REVIEW_ID, finding: findingToDto(spelling), occurredAt: AT };
      source.emit('finding.detected', 5, finding);
      source.emit('finding.detected', 5, finding); // at-least-once delivery
      source.emit('finding.detected', 4, finding);
      expect(store.detectedCount()).toBe(1);
      source.close();
    });

    it('counts code points, not UTF-16 units, against the limit', () => {
      doc.setContent('😀'.repeat(100)); // 100 code points, 200 UTF-16 units
      store.submit();
      expect(store.validationError()).toBeNull();
      accept202().close();
    });

    it.each([
      ['empty', '   \n  '],
      ['too_long', 'x'.repeat(101)],
    ])('blocks %s content without calling the API', (expected, content) => {
      doc.setContent(content);
      store.submit();
      http.expectNone('/api/v1/reviews');
      expect(store.validationError()).toBe(expected);
      expect(store.phase()).toBe('idle');
    });

    it('clears an earlier failure when validation blocks a new attempt', () => {
      store.submit();
      expectCreate().flush(null, { status: 503, statusText: 'Unavailable' });
      doc.setContent('');
      store.submit();
      expect(store.phase()).toBe('idle');
      expect(store.error()).toBeNull();
    });

    it('closes the previous stream and drops its results when a newer review is requested', () => {
      store.submit();
      const first = accept202();
      doc.setContent('second version teh');
      store.submit();
      expect(first.closed).toBe(true);

      const second = accept202(expectCreate(), 'aaaaaaaaaaaaaaaaaaaaaaaa');
      // A late event on the old stream must not affect the new review.
      first.emit('review.progress', 9, {
        reviewId: REVIEW_ID,
        stage: 'persisting',
        attempt: 1,
        occurredAt: AT,
      });
      finishStream(second, 1);
      flushSnapshot(
        [makeFinding({ id: 'fnd_second', range: { start: 15, end: 18 } })],
        'second version teh',
        'completed',
        'aaaaaaaaaaaaaaaaaaaaaaaa',
      );
      expect(store.findings().map((f) => f.id)).toEqual(['fnd_second']);
    });
  });

  describe('errors, reconnection and retry', () => {
    it('shows fixed copy for a failed review, never the backend message', () => {
      store.submit();
      const source = accept202();
      source.emit('review.failed', 1, {
        reviewId: REVIEW_ID,
        status: 'failed',
        errorCode: 'LLM_SERVICE_UNAVAILABLE',
        errorMessage: 'python said: gemini quota exceeded',
        occurredAt: AT,
      });
      http.expectOne(reviewUrl()).flush(
        reviewBody(CONTENT, [], {
          status: 'failed',
          errorCode: 'LLM_SERVICE_UNAVAILABLE',
          errorMessage: 'python said: gemini quota exceeded',
        }),
      );
      expect(store.phase()).toBe('error');
      expect(store.error()).toMatch(/temporarily unavailable/i);
      expect(store.error()).not.toMatch(/python|gemini/i);
      expect(doc.content()).toBe(CONTENT);
    });

    it('maps request errors and reports network failures', () => {
      store.submit();
      expectCreate().error(new ProgressEvent('error'));
      expect(store.error()).toMatch(/could not reach the server/i);
    });

    it('treats a malformed event as an invalid response', () => {
      store.submit();
      const source = accept202();
      source.emitRaw('review.completed', 1, '{not json');
      expect(source.closed).toBe(true);
      expect(store.phase()).toBe('error');
      expect(store.error()).toMatch(/could not understand/i);
    });

    it('lets the browser retry a dropped connection on its own', () => {
      store.submit();
      const source = accept202();
      source.drop(); // readyState CONNECTING: EventSource reconnects with Last-Event-ID
      expect(store.isLoading()).toBe(true);
      expect(FakeEventSource.instances).toHaveLength(1);
      source.open();
      finishStream(source, 0);
      flushSnapshot([]);
      expect(store.phase()).toBe('success');
    });

    it('re-checks the snapshot and resumes after the last event when the stream closes', async () => {
      store.submit();
      const source = accept202();
      source.emit('review.started', 3, {
        reviewId: REVIEW_ID,
        status: 'processing',
        occurredAt: AT,
      });
      source.fail(); // e.g. proxy restart: the browser gives up
      await nextTick();
      flushSnapshot([], CONTENT, 'processing');

      const resumed = FakeEventSource.latest();
      expect(resumed).not.toBe(source);
      expect(resumed.url).toBe(`${reviewUrl()}/events?lastEventId=3`);
      resumed.open();
      finishStream(resumed, 1, 4);
      flushSnapshot([spelling]);
      expect(store.phase()).toBe('success');
    });

    it('shows the persisted review when the stream closed because the review already finished', async () => {
      store.submit();
      accept202().fail(); // 204 No Content: nothing left to stream
      await nextTick();
      flushSnapshot([spelling]);
      expect(FakeEventSource.instances).toHaveLength(1);
      expect(store.phase()).toBe('success');
    });

    it('reports an interrupted review after too many reconnects and resumes it on retry', async () => {
      store.submit();
      accept202().fail();
      for (let attempt = 0; attempt < 2; attempt++) {
        await nextTick();
        flushSnapshot([], CONTENT, 'processing');
        FakeEventSource.latest().fail();
      }
      await nextTick();
      flushSnapshot([], CONTENT, 'processing');

      expect(store.phase()).toBe('error');
      expect(store.error()).toMatch(/lost contact/i);
      expect(store.canResume()).toBe(true);

      store.retry(); // must not create a duplicate review
      http.expectNone({ method: 'POST', url: '/api/v1/reviews' });
      flushSnapshot([spelling]);
      expect(store.phase()).toBe('success');
      expect(store.canResume()).toBe(false);
    });

    it('retries a failed submission with the current content', () => {
      store.submit();
      expectCreate().flush(null, { status: 500, statusText: 'Server Error' });
      store.retry();
      expect(store.phase()).toBe('loading');
      const retry = expectCreate();
      expect(retry.request.body.content).toBe(CONTENT);
      finishStream(accept202(retry), 1);
      flushSnapshot([spelling]);
      expect(store.phase()).toBe('success');
      expect(store.error()).toBeNull();
    });
  });

  describe('accept and undo (local only)', () => {
    beforeEach(() => {
      store.submit();
      completeReview();
    });

    it('applies the suggestion to the document without calling the API', () => {
      expect(store.accept('fnd_spell')).toBe(true);
      http.expectNone(() => true);
      expect(doc.content()).toBe('the the cat sat');
      expect(store.isStale()).toBe(false);
      expect(store.acceptedChanges()).toEqual([
        expect.objectContaining({
          findingId: 'fnd_spell',
          original: 'teh',
          improved: 'the',
          range: { start: 4, end: 7 },
        }),
      ]);
      const [accepted] = store.findings();
      expect(accepted.status).toBe('accepted');
      expect(accepted.range).toEqual({ start: 4, end: 7 });
      expect(store.hasUnsavedChanges()).toBe(true);
    });

    it('shifts later findings by the length difference', () => {
      store.accept('fnd_later'); // "sat" -> "sits"
      store.accept('fnd_spell');
      expect(doc.content()).toBe('the the cat sits');
      expect(store.findings().find((f) => f.id === 'fnd_later')!.range).toEqual({
        start: 12,
        end: 16,
      });
    });

    it('undoes changes in any order and removes them from the list', () => {
      store.accept('fnd_spell');
      store.accept('fnd_later');
      expect(store.undo('fnd_spell')).toBe(true);
      expect(doc.content()).toBe('the teh cat sits');
      expect(store.acceptedChanges().map((c) => c.findingId)).toEqual(['fnd_later']);
      store.undo('fnd_later');
      expect(doc.content()).toBe(CONTENT);
      expect(store.hasUnsavedChanges()).toBe(false);
      expect(store.findings().map((f) => f.status)).toEqual(['pending', 'pending']);
      http.expectNone(() => true);
    });

    it('blocks a finding that overlaps an accepted change until it is undone', () => {
      store.submit();
      const overlap = makeFinding({
        id: 'fnd_overlap',
        category: 'grammar',
        excerpt: 'teh cat',
        suggestion: 'the dog',
        range: { start: 4, end: 11 },
      });
      completeReview([spelling, overlap]);
      store.accept('fnd_spell');
      const blocked = store.findings().find((f) => f.id === 'fnd_overlap')!;
      expect(store.actionsFor(blocked)).toMatchObject({ canAccept: false });
      expect(store.actionsFor(blocked).note).toMatch(/overlaps/i);
      expect(store.accept('fnd_overlap')).toBe(false);
      store.undo('fnd_spell');
      expect(store.accept('fnd_overlap')).toBe(true);
      expect(doc.content()).toBe('the the dog sat');
    });

    it('removes the text for an empty suggestion (e.g. profanity)', () => {
      store.submit();
      completeReview([
        makeFinding({
          id: 'fnd_rm',
          category: 'profanity',
          excerpt: ' cat',
          suggestion: '',
          range: { start: 7, end: 11 },
        }),
      ]);
      expect(store.accept('fnd_rm')).toBe(true);
      expect(doc.content()).toBe('the teh sat');
    });

    it('explains why a finding without a usable location cannot be accepted', () => {
      store.submit();
      completeReview([
        makeFinding({ id: 'fnd_lost', excerpt: 'dog', range: { start: 4, end: 7 } }),
      ]);
      const actions = store.actionsFor(store.findings()[0]);
      expect(actions.canAccept).toBe(false);
      expect(actions.note).toMatch(/no longer has a location/i);
    });

    it('filters findings by status and category', () => {
      store.accept('fnd_spell');
      store.setFilters({ status: 'accepted' });
      expect(store.visibleFindings().map((f) => f.id)).toEqual(['fnd_spell']);
      store.setFilters({ status: 'all', category: 'grammar' });
      expect(store.visibleFindings()).toEqual([]);
    });
  });

  describe('dismiss', () => {
    beforeEach(() => {
      store.submit();
      completeReview();
    });

    it('dismisses on the server right away', () => {
      expect(store.actionsFor(store.findings()[0]).canDismiss).toBe(true);
      store.dismiss('fnd_spell');
      expect(store.actionsFor(store.findings()[0]).canDismiss).toBe(false); // busy
      const req = http.expectOne({ method: 'PATCH', url: `${reviewUrl()}/findings/fnd_spell` });
      expect(req.request.body).toEqual({ status: 'dismissed' });
      expect(req.request.headers.get('X-CSRF-Token')).toBe(TEST_CSRF_TOKEN);
      req.flush({ finding: findingToDto({ ...spelling, status: 'dismissed' }) });
      expect(store.findings()[0].status).toBe('dismissed');
      expect(store.actionsFor(store.findings()[0]).canDismiss).toBe(false);
    });

    it('cannot dismiss a locally accepted change', () => {
      store.accept('fnd_spell');
      expect(store.actionsFor(store.findings()[0]).canDismiss).toBe(false);
      store.dismiss('fnd_spell');
      http.expectNone(() => true);
    });

    it('keeps the finding pending and notifies when the server refuses', () => {
      const notify = vi.spyOn(TestBed.inject(NotificationService), 'error');
      store.dismiss('fnd_spell');
      http
        .expectOne(`${reviewUrl()}/findings/fnd_spell`)
        .flush(
          { error: { code: 'INVALID_STATE_TRANSITION', message: 'x' } },
          { status: 409, statusText: 'Conflict' },
        );
      expect(store.findings()[0].status).toBe('pending');
      expect(notify).toHaveBeenCalledWith(expect.stringMatching(/can no longer be changed/));
    });
  });

  describe('saving accepted changes', () => {
    beforeEach(() => {
      store.submit();
      completeReview();
      store.accept('fnd_spell');
      store.accept('fnd_later');
    });

    it('marks every accepted finding "accepted" on the server and makes the changes permanent', () => {
      const notify = vi.spyOn(TestBed.inject(NotificationService), 'success');
      store.saveChanges();
      expect(store.isSaving()).toBe(true);
      expect(store.actionsFor(store.findings()[0]).canUndo).toBe(false);

      for (const finding of [spelling, later]) {
        const req = http.expectOne({
          method: 'PATCH',
          url: `${reviewUrl()}/findings/${finding.id}`,
        });
        expect(req.request.body).toEqual({ status: 'accepted' }); // Node rejects "resolved"
        req.flush({ finding: findingToDto({ ...finding, status: 'accepted' }) });
      }

      expect(store.isSaving()).toBe(false);
      expect(store.hasUnsavedChanges()).toBe(false);
      expect(store.findings().map((f) => f.status)).toEqual(['resolved', 'resolved']);
      expect(doc.content()).toBe('the the cat sits');
      expect(store.isStale()).toBe(false);
      expect(store.undo('fnd_spell')).toBe(false);
      expect(notify).toHaveBeenCalledWith('2 changes saved.');
    });

    it('keeps the changes unsaved and notifies when saving fails', () => {
      const notify = vi.spyOn(TestBed.inject(NotificationService), 'error');
      store.saveChanges();
      http
        .expectOne(`${reviewUrl()}/findings/fnd_spell`)
        .flush(null, { status: 500, statusText: 'Server Error' });
      http.match(`${reviewUrl()}/findings/fnd_later`); // cancelled by forkJoin
      expect(store.isSaving()).toBe(false);
      expect(store.acceptedChanges()).toHaveLength(2);
      expect(store.undo('fnd_spell')).toBe(true);
      expect(notify).toHaveBeenCalledOnce();
    });
  });

  describe('document highlights', () => {
    beforeEach(() => {
      store.submit();
      completeReview();
    });

    it('highlights nothing until a finding is selected', () => {
      expect(store.showAllIssues()).toBe(false);
      expect(store.documentHighlights()).toEqual([]);
      store.selectFinding('fnd_later');
      expect(store.documentHighlights().map((f) => f.id)).toEqual(['fnd_later']);
    });

    it('highlights every finding when "Show all issues" is on', () => {
      store.viewMode.set('edit');
      store.setShowAllIssues(true);
      expect(store.viewMode()).toBe('review');
      expect(store.documentHighlights().map((f) => f.id)).toEqual(['fnd_spell', 'fnd_later']);
      store.setShowAllIssues(false);
      expect(store.documentHighlights()).toEqual([]);
    });

    it('always shows accepted changes, even when nothing is selected', () => {
      store.accept('fnd_later');
      expect(store.documentHighlights().map((f) => f.id)).toEqual(['fnd_later']);
      store.selectFinding('fnd_spell');
      expect(store.documentHighlights().map((f) => f.id)).toEqual(['fnd_spell', 'fnd_later']);
    });

    it('turns "Show all issues" off again for a new review', () => {
      store.setShowAllIssues(true);
      store.submit();
      completeReview();
      expect(store.showAllIssues()).toBe(false);
    });
  });

  describe('stale content', () => {
    beforeEach(() => {
      store.submit();
      completeReview();
    });

    it('marks the review stale and blocks highlights, Accept and Undo when the user edits', () => {
      store.accept('fnd_later');
      doc.setContent('typed something else');
      expect(store.isStale()).toBe(true);
      expect(store.highlightedFindings()).toEqual([]);
      const [spell, sat] = store.findings();
      expect(store.actionsFor(spell).canAccept).toBe(false);
      expect(store.actionsFor(sat).canUndo).toBe(false);
      expect(store.accept('fnd_spell')).toBe(false);
      expect(doc.content()).toBe('typed something else');
    });

    it('restores the reviewed text with accepted changes still applied', () => {
      store.accept('fnd_spell');
      doc.setContent('totally different');
      store.restoreReviewedContent();
      expect(doc.content()).toBe('the the cat sat');
      expect(store.isStale()).toBe(false);
    });
  });

  describe('loading stored reviews', () => {
    const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb';

    it('forgets unsaved changes when a different review is opened', () => {
      store.submit();
      completeReview();
      store.accept('fnd_spell');
      store.loadReview(OTHER);
      flushSnapshot([spelling], CONTENT, 'completed', OTHER);
      expect(store.acceptedChanges()).toEqual([]);
      expect(store.review()?.id).toBe(OTHER);
    });

    it('loads a completed review without opening an event stream', () => {
      store.loadReview(OTHER);
      expect(store.currentReviewId()).toBe(OTHER);
      flushSnapshot([spelling], CONTENT, 'completed', OTHER);
      expect(FakeEventSource.instances).toHaveLength(0);
      expect(store.phase()).toBe('success');
    });

    it('follows a review that is still processing (e.g. after a reload)', () => {
      store.loadReview(REVIEW_ID);
      flushSnapshot([], CONTENT, 'processing');
      const source = FakeEventSource.latest();
      expect(source.url).toBe(`${reviewUrl()}/events`);
      finishStream(source, 1);
      flushSnapshot([spelling]);
      expect(store.phase()).toBe('success');
    });

    it('can put the reviewed title and text back into the editor', () => {
      doc.setContent('sample text after a reload');
      store.loadReview(OTHER, { restoreDocument: true });
      http
        .expectOne(reviewUrl(OTHER))
        .flush(reviewBody(CONTENT, [spelling], { reviewId: OTHER, documentTitle: 'Saved title' }));
      expect(doc.title()).toBe('Saved title');
      expect(doc.content()).toBe(CONTENT);
      expect(store.isStale()).toBe(false);
    });

    it('explains a missing review', () => {
      store.loadReview(OTHER);
      http
        .expectOne(reviewUrl(OTHER))
        .flush(
          { error: { code: 'REVIEW_NOT_FOUND', message: 'x' } },
          { status: 404, statusText: 'Not Found' },
        );
      expect(store.error()).toBe('That review no longer exists.');
    });
  });
});
