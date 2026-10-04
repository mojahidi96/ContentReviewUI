import { Component, OnInit, effect, inject, input, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { FindingsPanel } from '../content-review/findings-panel';
import { ReviewStore } from '../content-review/review.store';
import { DocumentEditor } from './document-editor';
import { ReadOnlyDocument } from './read-only-document';

/**
 * Default workspace view. Authors get the editor next to its review findings; everyone else
 * only sees the document as read-only text.
 *
 * The open review's id is mirrored into `?review=<id>`, so a reload restores the persisted
 * review (and its text) from Node instead of losing it.
 */
@Component({
  selector: 'app-document-page',
  imports: [DocumentEditor, FindingsPanel, ReadOnlyDocument],
  host: { class: 'block' },
  template: `
    <h1 class="sr-only">Content workspace</h1>
    @if (auth.canEdit()) {
      <div class="mx-auto flex max-w-[96rem] flex-col gap-6 p-4 sm:p-6 xl:flex-row xl:items-start">
        <app-document-editor class="min-w-0 flex-1" />
        <app-findings-panel
          class="xl:sticky xl:top-6 xl:max-h-[calc(100dvh-6.5rem)] xl:w-[26rem] xl:shrink-0"
        />
      </div>
    } @else {
      <div class="mx-auto max-w-4xl p-4 sm:p-6">
        <app-read-only-document />
      </div>
    }
  `,
})
export class DocumentPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly store = inject(ReviewStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** `?review=` query parameter, bound via `withComponentInputBinding()`. */
  readonly review = input<string>();

  constructor() {
    effect(() => {
      const id = this.store.currentReviewId();
      if (id && id !== untracked(this.review)) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { review: id },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    });
  }

  ngOnInit(): void {
    const id = this.review();
    if (id && this.auth.canEdit() && id !== this.store.currentReviewId()) {
      this.store.loadReview(id, { restoreDocument: true });
    }
  }
}
