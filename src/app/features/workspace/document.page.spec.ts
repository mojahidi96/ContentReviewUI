import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  REVIEW_ID,
  TEST_READER,
  TEST_USER,
  completeReviewFlow,
  makeFinding,
  provideTestHttp,
  reviewBody,
  signIn,
} from '../../testing/test-providers';
import type { User } from '../../core/auth/auth.models';
import { ReviewStore } from '../content-review/review.store';
import { DocumentPage } from './document.page';
import { DocumentService } from './document.service';

describe('DocumentPage', () => {
  const render = async (user: User, reviewParam?: string) => {
    TestBed.configureTestingModule({
      providers: [...provideTestHttp(), DocumentService, ReviewStore],
    });
    signIn(user);
    TestBed.inject(DocumentService).setContent('Quarterly report text.');
    const fixture = TestBed.createComponent(DocumentPage);
    if (reviewParam) fixture.componentRef.setInput('review', reviewParam);
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

  it('restores the persisted review and its text from ?review= after a reload', async () => {
    await render(TEST_USER, REVIEW_ID);
    TestBed.inject(HttpTestingController)
      .expectOne(`/api/v1/reviews/${REVIEW_ID}`)
      .flush(reviewBody('The teh end', [makeFinding()], { documentTitle: 'Saved' }));
    expect(TestBed.inject(ReviewStore).review()?.id).toBe(REVIEW_ID);
    expect(TestBed.inject(DocumentService).content()).toBe('The teh end');
    expect(TestBed.inject(DocumentService).title()).toBe('Saved');
  });

  it('puts the id of a new review into the URL', async () => {
    await render(TEST_USER);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(DocumentService).setContent('The teh end');
    TestBed.inject(ReviewStore).submit();
    completeReviewFlow(TestBed.inject(HttpTestingController), 'The teh end', []);
    TestBed.tick();
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { review: REVIEW_ID }, replaceUrl: true }),
    );
  });
});
