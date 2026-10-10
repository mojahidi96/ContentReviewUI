import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faPen,
  faRotateRight,
  faTriangleExclamation,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons';
import { AuthService } from '../../../core/auth/auth.service';
import { toApiError } from '../../../core/http/api-error';
import { ErrorHandlingService } from '../../../core/http/error-handling.service';
import { ButtonDirective } from '../../../shared/components/button.directive';
import { ConfirmDialog } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { Spinner } from '../../../shared/components/spinner/spinner';
import { codePointLength } from '../../content-review/review.mappers';
import { ReviewStore } from '../../content-review/review.store';
import { DocumentApiService } from '../document-api.service';
import { initialsOf, readingMinutes } from '../document-meta';
import type { SavedDocument } from '../document.models';
import { DocumentService } from '../document.service';

type Status = 'loading' | 'ready' | 'notFound' | 'error';
type Intent = 'review' | 'edit';

/**
 * Reads one saved document like a Medium article. "Content Review" and "Edit" hand the document
 * to the workspace editor (the review also starts right away).
 */
@Component({
  selector: 'app-document-article-page',
  imports: [DatePipe, RouterLink, FaIconComponent, ButtonDirective, ConfirmDialog, Spinner],
  host: { class: 'block' },
  templateUrl: './document-article.page.html',
  styleUrl: './document-article.page.scss',
})
export class DocumentArticlePage {
  private readonly api = inject(DocumentApiService);
  private readonly documents = inject(DocumentService);
  private readonly store = inject(ReviewStore);
  private readonly router = inject(Router);
  private readonly errors = inject(ErrorHandlingService);
  protected readonly auth = inject(AuthService);

  /** `:id` route parameter, bound via `withComponentInputBinding()`. */
  readonly id = input.required<string>();

  protected readonly maxChars = this.store.maxChars;
  protected readonly status = signal<Status>('loading');
  protected readonly errorMessage = signal('');
  protected readonly doc = signal<SavedDocument | null>(null);
  /** The action waiting for the author to confirm replacing unsaved editor text. */
  protected readonly pending = signal<Intent | null>(null);

  protected readonly paragraphs = computed(() => this.doc()?.content.split(/\n{2,}/) ?? []);
  protected readonly minutes = computed(() =>
    readingMinutes(codePointLength(this.doc()?.content ?? '')),
  );
  protected readonly authorName = computed(() => this.auth.user()?.fullName ?? '');
  protected readonly authorInitials = computed(() => initialsOf(this.authorName()));
  protected readonly tooLongToReview = computed(
    () => codePointLength(this.doc()?.content ?? '') > this.store.maxChars,
  );

  protected readonly backIcon = faArrowLeft;
  protected readonly reviewIcon = faWandMagicSparkles;
  protected readonly editIcon = faPen;
  protected readonly retryIcon = faRotateRight;
  protected readonly warnIcon = faTriangleExclamation;

  constructor() {
    effect((onCleanup) => {
      this.status.set('loading');
      this.doc.set(null);
      const subscription = this.api.get(this.id()).subscribe({
        next: (doc) => {
          this.doc.set(doc);
          this.status.set('ready');
        },
        error: (error: unknown) => {
          if (toApiError(error).code === 'DOCUMENT_NOT_FOUND') {
            this.status.set('notFound');
            return;
          }
          this.errorMessage.set(this.errors.userMessage(error));
          this.status.set('error');
        },
      });
      onCleanup(() => subscription.unsubscribe());
    });
  }

  protected retry(): void {
    this.status.set('loading');
    this.api.get(this.id()).subscribe({
      next: (doc) => {
        this.doc.set(doc);
        this.status.set('ready');
      },
      error: (error: unknown) => {
        this.errorMessage.set(this.errors.userMessage(error));
        this.status.set('error');
      },
    });
  }

  protected start(intent: Intent): void {
    const doc = this.doc();
    if (!doc) {
      return;
    }
    // Opening a different document in the editor replaces whatever is in it.
    if (this.documents.hasUnsavedChanges() && this.documents.documentId() !== doc.id) {
      this.pending.set(intent);
      return;
    }
    this.open(doc, intent);
  }

  protected confirmPending(): void {
    const doc = this.doc();
    const intent = this.pending();
    this.pending.set(null);
    if (doc && intent) {
      this.open(doc, intent);
    }
  }

  private open(doc: SavedDocument, intent: Intent): void {
    // Keep the editor's own unsaved edits if this very document is already open in it.
    if (this.documents.documentId() !== doc.id || !this.documents.hasUnsavedChanges()) {
      this.documents.adopt(doc);
    }
    if (intent === 'review') {
      this.store.submit();
    }
    void this.router.navigate(['/workspace'], { queryParams: { document: doc.id } });
  }
}
