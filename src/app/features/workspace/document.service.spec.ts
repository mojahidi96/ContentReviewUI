import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NotificationService } from '../../core/notifications/notification.service';
import { TEST_CSRF_TOKEN, flushCsrf, provideTestHttp } from '../../testing/test-providers';
import type { DocumentDto } from './document.models';
import { DocumentService } from './document.service';
import { SAMPLE_DOCUMENT } from './sample-document';

const ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const AT = '2026-10-07T10:00:00.000Z';
/** Indentation, tabs, blank lines, trailing spaces, NBSP and emoji must survive untouched. */
const FORMATTED = '  Indented\n\tTabbed\n\n    Code block   \nTrailing    😀\n\n';

const dto = (overrides: Partial<DocumentDto> = {}): { document: DocumentDto } => ({
  document: {
    documentId: ID,
    title: 'Report',
    content: FORMATTED,
    contentLength: Array.from(FORMATTED).length,
    version: 1,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  },
});

describe('DocumentService', () => {
  let doc: DocumentService;
  let http: HttpTestingController;
  let notify: NotificationService;

  const expectPost = () => {
    flushCsrf(http);
    return http.expectOne({ method: 'POST', url: '/api/v1/documents' });
  };
  const saveNew = (title = 'Report', content = FORMATTED) => {
    doc.setTitle(title);
    doc.setContent(content);
    doc.save();
    expectPost().flush(dto({ title: title.trim() || 'Untitled document', content }), {
      status: 201,
      statusText: 'Created',
    });
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...provideTestHttp(), DocumentService] });
    doc = TestBed.inject(DocumentService);
    http = TestBed.inject(HttpTestingController);
    notify = TestBed.inject(NotificationService);
  });

  afterEach(() => http.verify());

  it('starts as the unsaved sample', () => {
    expect(doc.origin()).toBe('sample');
    expect(doc.documentId()).toBeNull();
    expect(doc.hasUnsavedChanges()).toBe(false);
    doc.setContent('short'); // the sample exceeds the test config's 100-character limit
    expect(doc.canSave()).toBe(true);
  });

  it('creates the document with the content exactly as written, with CSRF', () => {
    const success = vi.spyOn(notify, 'success');
    doc.setTitle('  Report  ');
    doc.setContent(FORMATTED);
    expect(doc.origin()).toBe('draft');
    doc.save();
    expect(doc.activity()).toBe('saving');
    expect(doc.canSave()).toBe(false);

    const req = expectPost();
    expect(req.request.body).toEqual({ title: 'Report', content: FORMATTED });
    expect(req.request.body.content).toBe(FORMATTED); // not trimmed or reformatted
    expect(req.request.headers.get('X-CSRF-Token')).toBe(TEST_CSRF_TOKEN);
    req.flush(dto(), { status: 201, statusText: 'Created' });

    expect(doc.activity()).toBe('idle');
    expect(doc.documentId()).toBe(ID);
    expect(doc.origin()).toBe('saved');
    expect(doc.hasUnsavedChanges()).toBe(false);
    expect(doc.canSave()).toBe(false);
    expect(success).toHaveBeenCalledWith('Document saved.');
  });

  it('updates with the last version and records the new one', () => {
    saveNew();
    doc.setContent(`${FORMATTED}  more\t`);
    expect(doc.origin()).toBe('modified');
    doc.save();
    const put = http.expectOne({ method: 'PUT', url: `/api/v1/documents/${ID}` });
    expect(put.request.body).toEqual({
      title: 'Report',
      content: `${FORMATTED}  more\t`,
      version: 1,
    });
    put.flush(dto({ content: `${FORMATTED}  more\t`, version: 2 }));
    expect(doc.origin()).toBe('saved');

    doc.setTitle('Report v3');
    doc.save();
    expect(http.expectOne(`/api/v1/documents/${ID}`).request.body.version).toBe(2);
  });

  it('keeps edits typed while a save is in flight as unsaved', () => {
    doc.setContent('first');
    doc.save();
    const req = expectPost();
    doc.setContent('first, then more');
    req.flush(dto({ content: 'first' }), { status: 201, statusText: 'Created' });
    expect(doc.origin()).toBe('modified');
    expect(doc.content()).toBe('first, then more');
  });

  it('saves a blank title as "Untitled document"', () => {
    doc.setTitle('   ');
    doc.setContent('short');
    doc.save();
    const req = expectPost();
    expect(req.request.body.title).toBe('Untitled document');
    req.flush(dto({ title: 'Untitled document' }), { status: 201, statusText: 'Created' });
    expect(doc.origin()).toBe('modified'); // content differs from the fixture; title matches
  });

  it('does not send a document that is too long', () => {
    doc.setContent('x'.repeat(101)); // test limit is 100 code points
    expect(doc.tooLong()).toBe(true);
    doc.save();
    http.expectNone('/api/v1/documents');
  });

  it('blocks saving after a version conflict until the latest version is loaded', () => {
    const error = vi.spyOn(notify, 'error');
    saveNew();
    doc.setContent('my edit');
    doc.save();
    http
      .expectOne(`/api/v1/documents/${ID}`)
      .flush(
        { error: { code: 'DOCUMENT_VERSION_CONFLICT', message: 'x' } },
        { status: 409, statusText: 'Conflict' },
      );
    expect(doc.hasConflict()).toBe(true);
    expect(doc.canSave()).toBe(false);
    expect(doc.content()).toBe('my edit'); // nothing is thrown away automatically
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/another tab or device/));

    doc.reloadSaved();
    http
      .expectOne({ method: 'GET', url: `/api/v1/documents/${ID}` })
      .flush(dto({ content: 'theirs', version: 5 }));
    expect(doc.hasConflict()).toBe(false);
    expect(doc.content()).toBe('theirs');
    expect(doc.origin()).toBe('saved');
  });

  it('saves as a new document when the saved one was deleted elsewhere', () => {
    saveNew();
    doc.setContent('edited');
    doc.save();
    http
      .expectOne(`/api/v1/documents/${ID}`)
      .flush(
        { error: { code: 'DOCUMENT_NOT_FOUND', message: 'x' } },
        { status: 404, statusText: 'Not Found' },
      );
    expect(doc.documentId()).toBeNull();
    doc.save();
    expect(expectPost().request.body.content).toBe('edited');
  });

  it('reports a malformed response without marking the document saved', () => {
    const error = vi.spyOn(notify, 'error');
    doc.setContent('x');
    doc.save();
    expectPost().flush({ documentId: ID }, { status: 201, statusText: 'Created' }); // not wrapped
    expect(doc.documentId()).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/could not understand/));
  });

  it('"reset to sample" starts a new unsaved document', () => {
    saveNew();
    doc.resetToSample();
    expect(doc.documentId()).toBeNull();
    expect(doc.content()).toBe(SAMPLE_DOCUMENT.content);
    expect(doc.origin()).toBe('sample');
  });

  describe('restore', () => {
    it('opens the most recently saved document', () => {
      doc.restore({ loadLatest: true });
      expect(doc.activity()).toBe('loading');
      const list = http.expectOne((r) => r.url === '/api/v1/documents');
      expect(list.request.params.get('limit')).toBe('1');
      const summary: Record<string, unknown> = { ...dto().document };
      delete summary['content'];
      list.flush({ items: [summary], page: 1, limit: 1, total: 3, totalPages: 3 });
      http.expectOne(`/api/v1/documents/${ID}`).flush(dto());
      expect(doc.activity()).toBe('idle');
      expect(doc.content()).toBe(FORMATTED);
      expect(doc.title()).toBe('Report');
      expect(doc.origin()).toBe('saved');
    });

    it('keeps the sample when nothing has been saved yet', () => {
      doc.restore({ loadLatest: true });
      http
        .expectOne((r) => r.url === '/api/v1/documents')
        .flush({ items: [], page: 1, limit: 1, total: 0, totalPages: 0 });
      expect(doc.origin()).toBe('sample');
      expect(doc.activity()).toBe('idle');
    });

    it('opens a requested document, and only once per session', () => {
      doc.restore({ documentId: ID, loadLatest: true });
      http.expectOne(`/api/v1/documents/${ID}`).flush(dto());
      doc.restore({ loadLatest: true });
      http.expectNone((r) => r.url.startsWith('/api/v1/documents'));
    });

    it('loads nothing when told not to (a review link supplies the text)', () => {
      doc.restore({ loadLatest: false });
      http.expectNone((r) => r.url.startsWith('/api/v1/documents'));
    });
  });
});
