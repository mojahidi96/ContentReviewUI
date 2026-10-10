import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TEST_USER, flushCsrf, provideTestHttp, signIn } from '../../../testing/test-providers';
import { WritePage } from './write.page';

describe('WritePage', () => {
  const setup = async () => {
    TestBed.configureTestingModule({ providers: [...provideTestHttp()] });
    signIn(TEST_USER);
    const fixture = TestBed.createComponent(WritePage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const type = async (selector: string, value: string) => {
      const field = el.querySelector<HTMLTextAreaElement>(selector)!;
      field.value = value;
      field.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const publish = () =>
      [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Publish'))!;
    return { fixture, el, type, publish };
  };

  it('starts blank with Publish disabled', async () => {
    const { el, publish } = await setup();
    expect(el.querySelector<HTMLTextAreaElement>('#write-title')!.value).toBe('');
    expect(el.querySelector<HTMLTextAreaElement>('#write-content')!.value).toBe('');
    expect(publish().disabled).toBe(true);
  });

  it('publishes the content untouched and opens the new article', async () => {
    const { fixture, type, publish } = await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await type('#write-title', '  My title ');
    await type('#write-content', '  Indented\n\n\tTabbed  \n');
    expect(publish().disabled).toBe(false);
    publish().click();
    const http = TestBed.inject(HttpTestingController);
    flushCsrf(http);
    const req = http.expectOne('/api/v1/documents');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ title: 'My title', content: '  Indented\n\n\tTabbed  \n' });
    req.flush(
      {
        document: {
          documentId: 'd'.repeat(24),
          title: 'My title',
          content: '  Indented\n\n\tTabbed  \n',
          contentLength: 23,
          version: 1,
          createdAt: '2026-10-01T10:00:00.000Z',
          updatedAt: '2026-10-01T10:00:00.000Z',
        },
      },
      { status: 201, statusText: 'Created' },
    );
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(['/workspace/documents', 'd'.repeat(24)]);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });

  it('blocks publishing over the character limit', async () => {
    const { el, type, publish } = await setup();
    await type('#write-content', 'x'.repeat(101));
    expect(publish().disabled).toBe(true);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('over the 100');
  });

  it('reports a draft as unsaved work', async () => {
    const { fixture, type } = await setup();
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    await type('#write-content', 'draft');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
  });
});
