import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/auth/auth.service';
import { TEST_READER, TEST_USER, provideTestHttp } from '../../testing/test-providers';
import type { User } from '../../core/auth/auth.models';
import { ReviewStore } from '../content-review/review.store';
import { DocumentPage } from './document.page';
import { DocumentService } from './document.service';

describe('DocumentPage', () => {
  const render = async (user: User) => {
    TestBed.configureTestingModule({
      providers: [...provideTestHttp(), DocumentService, ReviewStore],
    });
    TestBed.inject(AuthService).login({ email: 'a@b.co', password: 'x' }).subscribe();
    TestBed.inject(HttpTestingController).expectOne('/api/v1/auth/login').flush({ user });
    TestBed.inject(DocumentService).setContent('Quarterly report text.');
    const fixture = TestBed.createComponent(DocumentPage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  it('gives authors the editor and the findings panel', async () => {
    const el = await render(TEST_USER);
    expect(el.querySelector('app-document-editor')).not.toBeNull();
    expect(el.querySelector('app-findings-panel')).not.toBeNull();
    expect(el.querySelector('app-read-only-document')).toBeNull();
  });

  it('shows read-only users the content only, with nothing editable', async () => {
    const el = await render(TEST_READER);
    expect(el.querySelector('app-read-only-document')?.textContent).toContain(
      'Quarterly report text.',
    );
    expect(el.textContent).toContain('Read only');
    expect(el.querySelector('textarea, input, app-findings-panel, app-document-editor')).toBeNull();
    expect(el.querySelectorAll('button')).toHaveLength(0);
  });
});
