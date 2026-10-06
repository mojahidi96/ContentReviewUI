import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faCircleCheck,
  faEye,
  faFileCirclePlus,
  faFileLines,
  faFloppyDisk,
  faHighlighter,
  faPen,
  faRotateLeft,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { Badge } from '../../../shared/components/badge';
import { ButtonDirective } from '../../../shared/components/button.directive';
import { ConfirmDialog } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { Spinner } from '../../../shared/components/spinner/spinner';
import { HighlightedDocument } from '../../content-review/highlighted-document';
import { ReviewStore } from '../../content-review/review.store';
import { DocumentService } from '../document.service';

@Component({
  selector: 'app-document-editor',
  imports: [
    DatePipe,
    FaIconComponent,
    Badge,
    ButtonDirective,
    ConfirmDialog,
    HighlightedDocument,
    Spinner,
  ],
  host: {
    class:
      'flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900',
    '(window:keydown)': 'onKeydown($event)',
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
  templateUrl: './document-editor.html',
  styleUrl: './document-editor.scss',
})
export class DocumentEditor {
  protected readonly document = inject(DocumentService);
  protected readonly store = inject(ReviewStore);
  protected readonly resetOpen = signal(false);
  protected readonly newOpen = signal(false);
  protected readonly reloadOpen = signal(false);
  protected readonly saveHint = computed(() => {
    if (this.document.origin() === 'saved') return 'All changes are saved';
    if (this.document.tooLong()) return 'The document is too long to save';
    if (this.document.hasConflict()) return 'Load the latest version before saving';
    return 'Save (Ctrl+S / ⌘S)';
  });
  protected readonly overLimit = computed(() => this.document.length() > this.store.maxChars);

  protected readonly docIcon = faFileLines;
  protected readonly editIcon = faPen;
  protected readonly viewIcon = faEye;
  protected readonly highlightIcon = faHighlighter;
  protected readonly resetIcon = faRotateLeft;
  protected readonly saveIcon = faFloppyDisk;
  protected readonly savedIcon = faCircleCheck;
  protected readonly newIcon = faFileCirclePlus;
  protected readonly warnIcon = faTriangleExclamation;

  /** Ctrl+S / ⌘S saves instead of opening the browser's "Save page" dialog. */
  protected onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.document.save();
    }
  }

  /** Asks the browser to confirm before a reload or tab close would lose unsaved text. */
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.document.hasUnsavedChanges()) {
      event.preventDefault();
    }
  }

  protected startNew(): void {
    if (this.document.hasUnsavedChanges()) {
      this.newOpen.set(true);
    } else {
      this.confirmNew();
    }
  }

  protected confirmNew(): void {
    this.newOpen.set(false);
    this.document.resetToSample();
    this.store.viewMode.set('edit');
  }

  protected confirmReload(): void {
    this.reloadOpen.set(false);
    this.document.reloadSaved();
  }

  protected onContentInput(event: Event): void {
    this.document.setContent((event.target as HTMLTextAreaElement).value);
  }

  protected onTitleInput(event: Event): void {
    // Titles are single-line; strip newlines that could arrive via paste.
    this.document.setTitle((event.target as HTMLTextAreaElement).value.replace(/[\r\n]+/g, ' '));
  }

  protected confirmReset(): void {
    this.resetOpen.set(false);
    this.document.resetToSample();
    this.store.viewMode.set('edit');
  }
}
