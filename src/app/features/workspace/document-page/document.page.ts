import { Component, OnInit, effect, inject, input, untracked } from '@angular/core';
import { ActivatedRoute, Router, type Params } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { FindingsPanel } from '../../content-review/findings-panel/findings-panel';
import { ReviewStore } from '../../content-review/review.store';
import { DocumentEditor } from '../document-editor/document-editor';
import { DocumentService } from '../document.service';
import { ReadOnlyDocument } from '../read-only-document/read-only-document';

/**
 * Default workspace view. Authors get the editor next to its review findings; everyone else
 * only sees the document as read-only text.
 *
 * The open saved document and review are mirrored into `?document=<id>&review=<id>`, so a reload
 * restores both from Node. Without either, the author's most recently saved document opens.
 */
@Component({
  selector: 'app-document-page',
  imports: [DocumentEditor, FindingsPanel, ReadOnlyDocument],
  host: { class: 'block' },
  templateUrl: './document.page.html',
  styleUrl: './document.page.scss',
})
export class DocumentPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly store = inject(ReviewStore);
  private readonly documents = inject(DocumentService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** `?review=` query parameter, bound via `withComponentInputBinding()`. */
  readonly review = input<string>();
  /** `?document=` query parameter. */
  readonly document = input<string>();

  constructor() {
    effect(() => {
      const reviewId = this.store.currentReviewId();
      const documentId = this.documents.documentId();
      // While a document is loading, its id isn't known yet: keep ?document= as it is.
      const loading = this.documents.activity() === 'loading';
      const params: Params = {};
      if (reviewId && reviewId !== untracked(this.review)) {
        params['review'] = reviewId;
      }
      if (!loading && documentId !== (untracked(this.document) ?? null)) {
        params['document'] = documentId; // null removes it (e.g. after "New document")
      }
      if (Object.keys(params).length > 0) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: params,
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    });
  }

  ngOnInit(): void {
    if (!this.auth.canEdit()) {
      return;
    }
    const documentId = this.document();
    const reviewId = this.review();
    // A review link without a document restores the reviewed text instead of the latest document.
    this.documents.restore({ documentId, loadLatest: !reviewId });
    if (reviewId && reviewId !== this.store.currentReviewId()) {
      this.store.loadReview(reviewId, { restoreDocument: !documentId });
    }
  }
}
