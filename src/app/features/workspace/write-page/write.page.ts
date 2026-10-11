import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faPaperPlane } from '@fortawesome/free-solid-svg-icons';
import { APP_CONFIG } from '../../../core/config/app-config';
import { toApiError } from '../../../core/http/api-error';
import { ErrorHandlingService } from '../../../core/http/error-handling.service';
import type { HasUnsavedChanges } from '../../../core/guards/unsaved-changes.guard';
import { NotificationService } from '../../../core/notifications/notification.service';
import { ButtonDirective } from '../../../shared/components/button.directive';
import { Spinner } from '../../../shared/components/spinner/spinner';
import { codePointLength } from '../../content-review/review.mappers';
import { DocumentApiService } from '../document-api.service';
import { normalizeTitle } from '../document.service';

/**
 * A blank, distraction-free page to write a new document. Publishing saves it to the author's
 * library and opens it as an article. The editor's own document state is left untouched.
 */
@Component({
  selector: 'app-write-page',
  imports: [FaIconComponent, ButtonDirective, Spinner],
  host: {
    class: 'block',
    '(window:beforeunload)': 'onBeforeUnload($event)',
    '(window:keydown)': 'onKeydown($event)',
  },
  templateUrl: './write.page.html',
})
export class WritePage implements HasUnsavedChanges {
  private readonly api = inject(DocumentApiService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly errors = inject(ErrorHandlingService);
  protected readonly maxChars = inject(APP_CONFIG).review.maxChars;

  protected readonly title = signal('');
  protected readonly content = signal('');
  protected readonly publishing = signal(false);
  private published = false;

  protected readonly length = computed(() => codePointLength(this.content()));
  protected readonly overLimit = computed(() => this.length() > this.maxChars);
  protected readonly canPublish = computed(
    () => !this.publishing() && !this.overLimit() && this.content().trim().length > 0,
  );
  protected readonly publishHint = computed(() => {
    if (this.overLimit()) return `Too long to publish (limit ${this.maxChars} characters)`;
    if (this.content().trim().length === 0) return 'Write something first';
    return 'Publish (Ctrl+Enter / ⌘+Enter)';
  });

  protected readonly publishIcon = faPaperPlane;

  hasUnsavedChanges(): boolean {
    return !this.published && (this.title().trim() !== '' || this.content().trim() !== '');
  }

  protected onTitleInput(event: Event): void {
    // Titles are single-line; strip newlines that could arrive via paste.
    this.title.set((event.target as HTMLTextAreaElement).value.replace(/[\r\n]+/g, ' '));
  }

  protected onContentInput(event: Event): void {
    this.content.set((event.target as HTMLTextAreaElement).value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      this.publish();
    }
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
    }
  }

  protected publish(): void {
    if (!this.canPublish()) {
      return;
    }
    this.publishing.set(true);
    // The body is sent exactly as typed; only the title is normalised.
    this.api.create(normalizeTitle(this.title()), this.content()).subscribe({
      next: (doc) => {
        this.published = true;
        this.notifications.success('Published to your documents.');
        void this.router.navigate(['/workspace/documents', doc.id]);
      },
      error: (error: unknown) => {
        this.publishing.set(false);
        if (toApiError(error).kind !== 'unauthorized') {
          this.notifications.error(
            `Could not publish. ${this.errors.userMessage(error, PUBLISH_ERRORS)}`,
          );
        }
      },
    });
  }
}

const PUBLISH_ERRORS = {
  VALIDATION_FAILED: 'The title or content was rejected. Check them and try again.',
};
