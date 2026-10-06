import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { flushCsrf, provideTestHttp } from '../../testing/test-providers';
import { ReviewStore } from '../content-review/review.store';
import { DocumentEditor } from './document-editor';
import { DocumentService } from './document.service';

const ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const body = (content: string, version = 1) => ({
  document: {
    documentId: ID,
    title: 'Notes',
    content,
    contentLength: content.length,
    version,
    createdAt: '',
    updatedAt: '',
  },
});

describe('DocumentEditor saving', () => {
  let fixture: ComponentFixture<DocumentEditor>;
  let el: HTMLElement;
  let http: HttpTestingController;
  let doc: DocumentService;

  const saveButton = () =>
    [...el.querySelectorAll('button')].find((b) => /^(Save|Saving…)$/.test(b.textContent!.trim()))!;
  const text = () => el.textContent ?? '';
  const stable = () => fixture.whenStable();

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [DocumentEditor],
      providers: [...provideTestHttp(), DocumentService, ReviewStore],
    });
    http = TestBed.inject(HttpTestingController);
    doc = TestBed.inject(DocumentService);
    doc.setTitle('Notes');
    doc.setContent('  indented\n\ttabbed');
    fixture = TestBed.createComponent(DocumentEditor);
    el = fixture.nativeElement;
    await stable();
  });

  afterEach(() => http.verify());

  it('saves on click and shows the saved state', async () => {
    expect(text()).toContain('New document · not saved');
    expect(saveButton().disabled).toBe(false);

    saveButton().click();
    await stable();
    expect(saveButton().textContent).toContain('Saving…');
    expect(saveButton().disabled).toBe(true);

    flushCsrf(http);
    const req = http.expectOne({ method: 'POST', url: '/api/v1/documents' });
    expect(req.request.body.content).toBe('  indented\n\ttabbed');
    req.flush(body('  indented\n\ttabbed'), { status: 201, statusText: 'Created' });
    await stable();

    expect(text()).toContain('Saved');
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().getAttribute('title')).toBe('All changes are saved');
    expect(text()).toContain('New document'); // the "start new" action now replaces "Reset"
  });

  it('marks later edits as unsaved, sending exactly what the textarea holds', async () => {
    doc.save();
    flushCsrf(http);
    http.expectOne('/api/v1/documents').flush(body('  indented\n\ttabbed'), {
      status: 201,
      statusText: 'Created',
    });
    await stable();

    const textarea = el.querySelector<HTMLTextAreaElement>('#document-content')!;
    textarea.value = '  indented\n\ttabbed\n\n    new paragraph  ';
    textarea.dispatchEvent(new Event('input'));
    await stable();
    expect(text()).toContain('Unsaved changes');

    saveButton().click();
    const put = http.expectOne({ method: 'PUT', url: `/api/v1/documents/${ID}` });
    expect(put.request.body).toEqual({
      title: 'Notes',
      content: '  indented\n\ttabbed\n\n    new paragraph  ',
      version: 1,
    });
    put.flush(body('  indented\n\ttabbed\n\n    new paragraph  ', 2));
  });

  it('saves with Ctrl+S or ⌘S instead of the browser dialog', async () => {
    for (const init of [{ ctrlKey: true }, { metaKey: true }]) {
      const event = new KeyboardEvent('keydown', { key: 's', cancelable: true, ...init });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    flushCsrf(http);
    // The second shortcut is ignored while the first save is in flight.
    http.expectOne('/api/v1/documents').flush(body('  indented\n\ttabbed'), {
      status: 201,
      statusText: 'Created',
    });

    const plain = new KeyboardEvent('keydown', { key: 's', cancelable: true });
    window.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
  });

  it('offers to load the latest version after a conflict', async () => {
    doc.save();
    flushCsrf(http);
    http.expectOne('/api/v1/documents').flush(body('  indented\n\ttabbed'), {
      status: 201,
      statusText: 'Created',
    });
    doc.setContent('mine');
    doc.save();
    http
      .expectOne(`/api/v1/documents/${ID}`)
      .flush(
        { error: { code: 'DOCUMENT_VERSION_CONFLICT', message: 'x' } },
        { status: 409, statusText: 'Conflict' },
      );
    await stable();

    expect(el.querySelector('[role=alert]')?.textContent).toContain('saved somewhere else');
    expect(saveButton().disabled).toBe(true);
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Load latest'))!.click();
    await stable();
    [...el.querySelectorAll('dialog[open] button')]
      .find((b) => b.textContent?.includes('Load latest version'))!
      .dispatchEvent(new MouseEvent('click'));
    http.expectOne({ method: 'GET', url: `/api/v1/documents/${ID}` }).flush(body('theirs', 3));
    await stable();
    expect(el.querySelector('[role=alert]')).toBeNull();
    expect(doc.content()).toBe('theirs');
  });

  it('asks the browser to confirm leaving only while there are unsaved changes', () => {
    const unsaved = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unsaved);
    expect(unsaved.defaultPrevented).toBe(true);

    doc.resetToSample();
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
  });
});
