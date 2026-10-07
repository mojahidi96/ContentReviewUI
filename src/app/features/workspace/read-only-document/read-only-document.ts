import { Component, inject } from '@angular/core';
import { faEye } from '@fortawesome/free-solid-svg-icons';
import { Badge } from '../../../shared/components/badge';
import { DocumentService } from '../document.service';

/** The document as plain, non-editable text for users without the author role. */
@Component({
  selector: 'app-read-only-document',
  imports: [Badge],
  host: {
    class:
      'block rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900',
  },
  templateUrl: './read-only-document.html',
  styleUrl: './read-only-document.scss',
})
export class ReadOnlyDocument {
  protected readonly document = inject(DocumentService);
  protected readonly readOnlyIcon = faEye;
}
