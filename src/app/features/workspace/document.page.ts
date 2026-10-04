import { Component, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { FindingsPanel } from '../content-review/findings-panel';
import { DocumentEditor } from './document-editor';
import { ReadOnlyDocument } from './read-only-document';

/**
 * Default workspace view. Authors get the editor next to its review findings; everyone else
 * only sees the document as read-only text.
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
export class DocumentPage {
  protected readonly auth = inject(AuthService);
}
