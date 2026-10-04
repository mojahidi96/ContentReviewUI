import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NotificationService } from '../../core/notifications/notification.service';
import { makeFinding, makeReview, provideTestHttp } from '../../testing/test-providers';
import { DocumentService } from '../workspace/document.service';
import type { Finding } from './review.models';
import { ReviewStore } from './review.store';

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

  const expectCreate = (): TestRequest =>
    http.expectOne({ method: 'POST', url: '/api/v1/reviews' });
  const completeReview = (findings: Finding[] = [spelling, later], content = CONTENT) =>
    expectCreate().flush(makeReview(content, findings));

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
    it('sends the current editor content, not a placeholder', () => {
      doc.setTitle('  My report  ');
      doc.setContent('Edited by the user just now');
      store.submit();
      expect(expectCreate().request.body).toEqual({
        title: 'My report',
        content: 'Edited by the user just now',
      });
    });

    it('shows a loading state, then the findings', () => {
      store.submit();
      expect(store.phase()).toBe('loading');
      expect(store.isLoading()).toBe(true);
      completeReview();
      expect(store.phase()).toBe('success');
      expect(store.findings().map((f) => f.id)).toEqual(['fnd_spell', 'fnd_later']);
      expect(store.counts()).toMatchObject({ total: 2, pending: 2 });
      expect(store.viewMode()).toBe('review');
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

    it('drops a stale response when a newer review is requested', () => {
      store.submit();
      const first = expectCreate();
      doc.setContent('second version teh');
      store.submit();
      const second = expectCreate();
      expect(first.cancelled).toBe(true);
      second.flush(
        makeReview('second version teh', [
          makeFinding({ id: 'fnd_second', range: { start: 15, end: 18 } }),
        ]),
      );
      expect(store.findings().map((f) => f.id)).toEqual(['fnd_second']);
    });
  });

  describe('errors and retry', () => {
    it('shows a friendly message and keeps the document on failure', () => {
      store.submit();
      expectCreate().flush(
        { error: { code: 'REVIEW_UNAVAILABLE', message: 'python down' } },
        { status: 503, statusText: 'Unavailable' },
      );
      expect(store.phase()).toBe('error');
      expect(store.error()).toMatch(/temporarily unavailable/i);
      expect(store.error()).not.toContain('python');
      expect(doc.content()).toBe(CONTENT);
    });

    it('reports network failures', () => {
      store.submit();
      expectCreate().error(new ProgressEvent('error'));
      expect(store.error()).toMatch(/could not reach the server/i);
    });

    it('retries with the current content', () => {
      store.submit();
      expectCreate().flush(null, { status: 500, statusText: 'Server Error' });
      store.retry();
      expect(store.phase()).toBe('loading');
      const retry = expectCreate();
      expect(retry.request.body.content).toBe(CONTENT);
      retry.flush(makeReview(CONTENT, [spelling]));
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

    it('blocks a finding that overlaps an accepted change until it is undone', async () => {
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

    it('explains why findings without a suggestion cannot be accepted', () => {
      store.submit();
      completeReview([makeFinding({ id: 'fnd_none', suggestion: undefined })]);
      const actions = store.actionsFor(store.findings()[0]);
      expect(actions.canAccept).toBe(false);
      expect(actions.note).toMatch(/no ai suggestion/i);
    });

    it('filters findings by status and category', () => {
      store.accept('fnd_spell');
      store.setFilters({ status: 'accepted' });
      expect(store.visibleFindings().map((f) => f.id)).toEqual(['fnd_spell']);
      store.setFilters({ status: 'all', category: 'grammar' });
      expect(store.visibleFindings()).toEqual([]);
    });
  });

  describe('saving accepted changes', () => {
    beforeEach(() => {
      store.submit();
      completeReview();
      store.accept('fnd_spell');
      store.accept('fnd_later');
    });

    it('resolves every accepted finding on the server and makes the changes permanent', () => {
      const notify = vi.spyOn(TestBed.inject(NotificationService), 'success');
      store.saveChanges();
      expect(store.isSaving()).toBe(true);
      expect(store.actionsFor(store.findings()[0]).canUndo).toBe(false);

      for (const finding of [spelling, later]) {
        const req = http.expectOne({
          method: 'PATCH',
          url: `/api/v1/reviews/rev_1/findings/${finding.id}`,
        });
        expect(req.request.body).toEqual({ status: 'resolved' });
        req.flush({ ...finding, status: 'resolved' });
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
        .expectOne('/api/v1/reviews/rev_1/findings/fnd_spell')
        .flush(null, { status: 500, statusText: 'Server Error' });
      http.match('/api/v1/reviews/rev_1/findings/fnd_later'); // cancelled by forkJoin
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

  it('forgets unsaved changes when a different review is opened', () => {
    store.submit();
    completeReview();
    store.accept('fnd_spell');
    store.loadReview('rev_9');
    http.expectOne('/api/v1/reviews/rev_9').flush(makeReview(CONTENT, [spelling], { id: 'rev_9' }));
    expect(store.acceptedChanges()).toEqual([]);
  });

  it('loads a review from history', () => {
    store.loadReview('rev_9');
    http.expectOne('/api/v1/reviews/rev_9').flush(makeReview(CONTENT, [spelling], { id: 'rev_9' }));
    expect(store.review()?.id).toBe('rev_9');
    expect(store.phase()).toBe('success');
  });
});
