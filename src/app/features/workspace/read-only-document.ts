import { Component, inject } from '@angular/core';
import { faEye } from '@fortawesome/free-solid-svg-icons';
import { Badge } from '../../shared/components/badge';
import { DocumentService } from './document.service';

/** The document as plain, non-editable text for users without the author role. */
@Component({
  selector: 'app-read-only-document',
  imports: [Badge],
  host: {
    class:
      'block rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900',
  },
  template: `
    <header class="border-b border-slate-200 px-4 py-4 sm:px-8 dark:border-slate-800">
      <app-badge [icon]="readOnlyIcon">Read only</app-badge>
      <h2 class="mt-2 text-xl font-semibold text-slate-900 sm:text-2xl dark:text-slate-100">
        {{ document.title() }}
      </h2>
      <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
        You can read this document. Only authors can edit or review it.
      </p>
    </header>
    <!-- prettier-ignore -->
    <div class="px-4 py-6 font-serif text-[1.0625rem] leading-8 break-words whitespace-pre-wrap text-slate-800 sm:px-8 dark:text-slate-200">{{ document.content() }}</div>
  `,
})
export class ReadOnlyDocument {
  protected readonly document = inject(DocumentService);
  protected readonly readOnlyIcon = faEye;
}
