import { Injectable, computed, signal } from '@angular/core';
import { codePointLength } from '../content-review/review.mappers';
import { SAMPLE_DOCUMENT } from './sample-document';

/**
 * Where the current text came from. There is no document-persistence endpoint in the API
 * contract, so edits are an unsaved draft; the backend stores a snapshot with each review.
 */
export type DocumentOrigin = 'sample' | 'draft';

/** State of the document open in the workspace. Scoped to the workspace shell. */
@Injectable()
export class DocumentService {
  private readonly _title = signal<string>(SAMPLE_DOCUMENT.title);
  private readonly _content = signal<string>(SAMPLE_DOCUMENT.content);

  readonly title = this._title.asReadonly();
  readonly content = this._content.asReadonly();
  /** Unicode code points, the unit Node uses for `REVIEW_MAX_CONTENT_CHARS`. */
  readonly length = computed(() => codePointLength(this._content()));
  readonly origin = computed<DocumentOrigin>(() =>
    this._content() === SAMPLE_DOCUMENT.content && this._title() === SAMPLE_DOCUMENT.title
      ? 'sample'
      : 'draft',
  );

  setTitle(title: string): void {
    this._title.set(title);
  }

  setContent(content: string): void {
    this._content.set(content);
  }

  resetToSample(): void {
    this._title.set(SAMPLE_DOCUMENT.title);
    this._content.set(SAMPLE_DOCUMENT.content);
  }
}
