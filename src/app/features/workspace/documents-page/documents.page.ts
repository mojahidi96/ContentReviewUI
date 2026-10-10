import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faFeatherPointed,
  faMagnifyingGlass,
  faPenNib,
  faRotateRight,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { AuthService } from '../../../core/auth/auth.service';
import { ErrorHandlingService } from '../../../core/http/error-handling.service';
import { ButtonDirective } from '../../../shared/components/button.directive';
import { EmptyState } from '../../../shared/components/empty-state';
import { Spinner } from '../../../shared/components/spinner/spinner';
import { DocumentApiService } from '../document-api.service';
import { approxWords, initialsOf, readingMinutes, thumbnailGradient } from '../document-meta';
import type { SavedDocumentSummary } from '../document.models';

const PAGE_SIZE = 10;

type Status = 'loading' | 'ready' | 'error';

/**
 * Medium-style feed of the author's saved documents. Each row opens the article view, which
 * offers Content Review and Edit.
 */
@Component({
  selector: 'app-documents-page',
  imports: [DatePipe, RouterLink, FaIconComponent, ButtonDirective, EmptyState, Spinner],
  host: { class: 'block' },
  templateUrl: './documents.page.html',
  styleUrl: './documents.page.scss',
})
export class DocumentsPage {
  private readonly api = inject(DocumentApiService);
  private readonly errors = inject(ErrorHandlingService);
  protected readonly auth = inject(AuthService);

  protected readonly status = signal<Status>('loading');
  protected readonly errorMessage = signal('');
  protected readonly loadingMore = signal(false);
  protected readonly items = signal<readonly SavedDocumentSummary[]>([]);
  protected readonly total = signal(0);
  private readonly page = signal(1);
  private readonly totalPages = signal(1);
  protected readonly query = signal('');

  protected readonly hasMore = computed(() => this.page() < this.totalPages());
  protected readonly filtered = computed(() => {
    const query = this.query().trim().toLowerCase();
    return query
      ? this.items().filter((doc) => doc.title.toLowerCase().includes(query))
      : this.items();
  });
  protected readonly authorName = computed(() => this.auth.user()?.fullName ?? '');
  protected readonly authorInitials = computed(() => initialsOf(this.authorName()));

  protected readonly searchIcon = faMagnifyingGlass;
  protected readonly writeIcon = faPenNib;
  protected readonly emptyIcon = faFeatherPointed;
  protected readonly retryIcon = faRotateRight;
  protected readonly warnIcon = faTriangleExclamation;

  protected readonly minutes = (doc: SavedDocumentSummary): number =>
    readingMinutes(doc.contentLength);
  protected readonly words = (doc: SavedDocumentSummary): number => approxWords(doc.contentLength);
  protected readonly gradient = (doc: SavedDocumentSummary): string => thumbnailGradient(doc.id);
  protected readonly edited = (doc: SavedDocumentSummary): boolean => doc.version > 1;

  constructor() {
    this.load(1);
  }

  protected retry(): void {
    this.status.set('loading');
    this.load(1);
  }

  protected loadMore(): void {
    this.loadingMore.set(true);
    this.load(this.page() + 1);
  }

  private load(page: number): void {
    this.api
      .list(page, PAGE_SIZE)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (result) => {
          this.items.update((current) =>
            page === 1 ? result.items : [...current, ...result.items],
          );
          this.page.set(result.page);
          this.totalPages.set(result.totalPages);
          this.total.set(result.total);
          this.status.set('ready');
          this.loadingMore.set(false);
        },
        error: (error: unknown) => {
          this.errorMessage.set(this.errors.userMessage(error));
          this.loadingMore.set(false);
          // A failed "load more" keeps the rows already shown.
          this.status.set(page === 1 ? 'error' : 'ready');
        },
      });
  }

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }
}
