import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TEST_USER, provideTestHttp, signIn } from '../../../testing/test-providers';
import { DocumentsPage } from './documents.page';

const dto = (n: number, version = 1) => ({
  documentId: String(n).padStart(24, 'a'),
  title: `Document ${n}`,
  contentLength: 1200,
  version,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
});

describe('DocumentsPage', () => {
  const render = async (body: object) => {
    TestBed.configureTestingModule({ providers: [...provideTestHttp()] });
    signIn(TEST_USER);
    const fixture = TestBed.createComponent(DocumentsPage);
    TestBed.inject(HttpTestingController)
      .expectOne('/api/v1/documents?page=1&limit=10')
      .flush(body);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  it('lists documents with links to the article view', async () => {
    const el = await render({
      items: [dto(1), dto(2, 3)],
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
    const rows = el.querySelectorAll('[data-testid="document-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('h2 a')?.getAttribute('href')).toBe(
      `/workspace/documents/${'1'.padStart(24, 'a')}`,
    );
    expect(rows[0].textContent).toContain('1 min read');
    expect(rows[1].textContent).toContain('Edited (v3)');
  });

  it('filters by title', async () => {
    const el = await render({
      items: [dto(1), dto(2)],
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
    const search = el.querySelector<HTMLInputElement>('#document-search')!;
    search.value = 'document 2';
    search.dispatchEvent(new Event('input'));
    TestBed.tick();
    const rows = el.querySelectorAll('[data-testid="document-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Document 2');
  });

  it('invites the author to write when there are no documents', async () => {
    const el = await render({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 });
    expect(el.textContent).toContain('Nothing written yet');
    expect(el.querySelector('a[href="/workspace/write"]')).not.toBeNull();
  });

  it('shows an error with a retry when loading fails', async () => {
    TestBed.configureTestingModule({ providers: [...provideTestHttp()] });
    signIn(TEST_USER);
    const fixture = TestBed.createComponent(DocumentsPage);
    TestBed.inject(HttpTestingController)
      .expectOne('/api/v1/documents?page=1&limit=10')
      .flush({}, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.textContent).toContain('Try again');
  });
});
