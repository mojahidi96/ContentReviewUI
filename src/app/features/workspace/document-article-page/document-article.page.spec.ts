import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TEST_READER, TEST_USER, provideTestHttp, signIn } from '../../../testing/test-providers';
import type { User } from '../../../core/auth/auth.models';
import { ModelSelection } from '../../content-review/model-selection';
import { ReviewStore } from '../../content-review/review.store';
import { DocumentService } from '../document.service';
import { DocumentArticlePage } from './document-article.page';

const ID = 'e'.repeat(24);
const docBody = (content: string) => ({
  document: {
    documentId: ID,
    title: 'An article',
    content,
    contentLength: content.length,
    version: 2,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
  },
});

describe('DocumentArticlePage', () => {
  const render = async (content = 'First para.\n\nSecond para.', user: User = TEST_USER) => {
    TestBed.configureTestingModule({
      providers: [...provideTestHttp(), DocumentService, ModelSelection, ReviewStore],
    });
    signIn(user);
    const fixture = TestBed.createComponent(DocumentArticlePage);
    fixture.componentRef.setInput('id', ID);
    await fixture.whenStable();
    TestBed.inject(HttpTestingController)
      .expectOne(`/api/v1/documents/${ID}`)
      .flush(docBody(content));
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  };

  const button = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;

  it('shows the title and the content split into paragraphs', async () => {
    const { el } = await render();
    expect(el.querySelector('h1')?.textContent).toContain('An article');
    const paragraphs = [...el.querySelectorAll('p.whitespace-pre-wrap')].map((p) => p.textContent);
    expect(paragraphs).toEqual(['First para.', 'Second para.']);
  });

  it('hands the document to the editor, starts a review and opens the workspace', async () => {
    const { el } = await render('Short text');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const submit = vi
      .spyOn(TestBed.inject(ReviewStore), 'submit')
      .mockImplementation(() => undefined);
    button(el, 'Content Review').click();
    expect(TestBed.inject(DocumentService).documentId()).toBe(ID);
    expect(TestBed.inject(DocumentService).content()).toBe('Short text');
    expect(submit).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/workspace'], { queryParams: { document: ID } });
  });

  it('opens the editor without a review for Edit', async () => {
    const { el } = await render('Short text');
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const submit = vi
      .spyOn(TestBed.inject(ReviewStore), 'submit')
      .mockImplementation(() => undefined);
    button(el, 'Edit').click();
    expect(submit).not.toHaveBeenCalled();
    expect(TestBed.inject(DocumentService).documentId()).toBe(ID);
  });

  it('asks before replacing unsaved editor text', async () => {
    const { fixture, el } = await render('Short text');
    TestBed.inject(DocumentService).setContent('my unsaved draft');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    button(el, 'Edit').click();
    await fixture.whenStable();
    expect(navigate).not.toHaveBeenCalled();
    expect(TestBed.inject(DocumentService).content()).toBe('my unsaved draft');
    expect(el.querySelector('app-confirm-dialog')?.textContent).toContain('discard');
  });

  it('disables the review for documents over the limit', async () => {
    const { el } = await render('x'.repeat(101));
    expect(button(el, 'Content Review').disabled).toBe(true);
  });

  it('shows a not-found message', async () => {
    TestBed.configureTestingModule({
      providers: [...provideTestHttp(), DocumentService, ModelSelection, ReviewStore],
    });
    signIn(TEST_USER);
    const fixture = TestBed.createComponent(DocumentArticlePage);
    fixture.componentRef.setInput('id', ID);
    await fixture.whenStable();
    TestBed.inject(HttpTestingController)
      .expectOne(`/api/v1/documents/${ID}`)
      .flush(
        { error: { code: 'DOCUMENT_NOT_FOUND', message: 'x', requestId: 'r' } },
        { status: 404, statusText: 'Not Found' },
      );
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Document not found');
  });

  it('offers readers no review or edit actions', async () => {
    const { el } = await render('Short text', TEST_READER);
    expect(el.textContent).not.toContain('Content Review');
    expect(el.textContent).not.toContain('Edit\n');
    expect([...el.querySelectorAll('button')].map((b) => b.textContent?.trim())).not.toContain(
      'Edit',
    );
  });
});
