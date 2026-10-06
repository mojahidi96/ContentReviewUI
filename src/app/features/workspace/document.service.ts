import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, finalize, of, switchMap } from 'rxjs';
import { APP_CONFIG } from '../../core/config/app-config';
import { toApiError } from '../../core/http/api-error';
import { ErrorHandlingService } from '../../core/http/error-handling.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { codePointLength } from '../content-review/review.mappers';
import { DocumentApiService } from './document-api.service';
import type { SavedDocument } from './document.models';
import { SAMPLE_DOCUMENT } from './sample-document';

/**
 * Where the current text stands:
 * - `sample`: the untouched sample, never saved
 * - `draft`: edited, never saved
 * - `saved`: matches what is stored in Node
 * - `modified`: saved before, with unsaved edits since
 */
export type DocumentOrigin = 'sample' | 'draft' | 'saved' | 'modified';
export type DocumentActivity = 'idle' | 'loading' | 'saving';

export const UNTITLED = 'Untitled document';

/** The title Node will store: trimmed, never blank. */
export const normalizeTitle = (title: string): string => title.trim() || UNTITLED;

interface Snapshot {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly content: string;
}

/**
 * State and persistence of the document open in the workspace. Scoped to the workspace shell,
 * so it is discarded on logout.
 *
 * Content is saved exactly as the author wrote it — the string from the editor is sent as is,
 * never trimmed or reformatted — and Node stores it byte-for-byte.
 */
@Injectable()
export class DocumentService {
  private readonly api = inject(DocumentApiService);
  private readonly errors = inject(ErrorHandlingService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);
  /** Same limit as reviews, so every saved document can also be reviewed. */
  readonly maxChars = inject(APP_CONFIG).review.maxChars;

  private readonly _title = signal<string>(SAMPLE_DOCUMENT.title);
  private readonly _content = signal<string>(SAMPLE_DOCUMENT.content);
  /** What Node has, as of the last load or save; `null` until the document is first saved. */
  private readonly _saved = signal<Snapshot | null>(null);
  private readonly _activity = signal<DocumentActivity>('idle');
  /** Someone else saved a newer version; saving again would overwrite it, so it is blocked. */
  private readonly _conflict = signal(false);
  private restored = false;

  readonly title = this._title.asReadonly();
  readonly content = this._content.asReadonly();
  readonly activity = this._activity.asReadonly();
  readonly hasConflict = this._conflict.asReadonly();
  readonly documentId = computed(() => this._saved()?.id ?? null);
  /** Unicode code points, the unit Node uses for its limits. */
  readonly length = computed(() => codePointLength(this._content()));
  readonly tooLong = computed(() => this.length() > this.maxChars);

  readonly origin = computed<DocumentOrigin>(() => {
    const saved = this._saved();
    if (!saved) {
      return this._content() === SAMPLE_DOCUMENT.content && this._title() === SAMPLE_DOCUMENT.title
        ? 'sample'
        : 'draft';
    }
    return this._content() === saved.content && normalizeTitle(this._title()) === saved.title
      ? 'saved'
      : 'modified';
  });

  /** True when leaving would lose work the author typed. */
  readonly hasUnsavedChanges = computed(() => {
    const origin = this.origin();
    return origin === 'draft' || origin === 'modified';
  });

  readonly canSave = computed(
    () =>
      this._activity() === 'idle' &&
      !this._conflict() &&
      !this.tooLong() &&
      this.origin() !== 'saved',
  );

  setTitle(title: string): void {
    this._title.set(title);
  }

  setContent(content: string): void {
    this._content.set(content);
  }

  /** Starts a fresh, unsaved document from the sample. The saved one stays in Node. */
  resetToSample(): void {
    this._saved.set(null);
    this._conflict.set(false);
    this._title.set(SAMPLE_DOCUMENT.title);
    this._content.set(SAMPLE_DOCUMENT.content);
  }

  /**
   * Saves the title and content: creates the document the first time, then updates it with the
   * last known version. The content string is sent exactly as it is in the editor.
   */
  save(): void {
    if (!this.canSave()) {
      return;
    }
    const saved = this._saved();
    const title = normalizeTitle(this._title());
    const content = this._content();
    const request = saved
      ? this.api.update(saved.id, title, content, saved.version)
      : this.api.create(title, content);
    this.run('saving', request, {
      next: (doc) => {
        // Edits typed while the request was in flight stay unsaved: only what was sent is recorded.
        this._saved.set(snapshotOf(doc));
        this.notifications.success('Document saved.');
      },
      error: (error) => this.onSaveError(error),
    });
  }

  /** Opens a saved document, replacing the editor contents. */
  load(id: string): void {
    this.run('loading', this.api.get(id), {
      next: (doc) => this.apply(doc),
      error: (error) => {
        if (toApiError(error).kind !== 'unauthorized') {
          this.notifications.error(
            `Could not open the saved document. ${this.errors.userMessage(error, DOCUMENT_ERRORS)}`,
          );
        }
      },
    });
  }

  /** Throws away local edits and loads the version currently stored in Node. */
  reloadSaved(): void {
    const id = this.documentId();
    if (id) {
      this.load(id);
    }
  }

  /**
   * Called when the workspace opens; only the first call per session does anything. Loads the
   * requested document, or else (when `loadLatest`) the author's most recently saved one. If
   * there is none, the sample stays.
   */
  restore(options: { documentId?: string; loadLatest: boolean }): void {
    if (this.restored) {
      return;
    }
    this.restored = true;
    if (options.documentId) {
      this.load(options.documentId);
      return;
    }
    if (!options.loadLatest) {
      return;
    }
    const latest = this.api
      .latest()
      .pipe(switchMap((summary) => (summary ? this.api.get(summary.id) : of(null))));
    this.run('loading', latest, {
      next: (doc) => {
        if (doc) this.apply(doc);
      },
      error: () => undefined, // Not fatal: the author can still work and save a new document.
    });
  }

  private apply(doc: SavedDocument): void {
    this._saved.set(snapshotOf(doc));
    this._conflict.set(false);
    this._title.set(doc.title);
    this._content.set(doc.content);
  }

  private onSaveError(error: unknown): void {
    const apiError = toApiError(error);
    if (apiError.kind === 'unauthorized') {
      return; // the session-expired redirect explains it
    }
    if (apiError.code === 'DOCUMENT_VERSION_CONFLICT') {
      this._conflict.set(true);
    } else if (apiError.code === 'DOCUMENT_NOT_FOUND') {
      // Deleted elsewhere: the next save creates a new document from the current text.
      this._saved.set(null);
    }
    this.notifications.error(
      `Could not save the document. ${this.errors.userMessage(error, DOCUMENT_ERRORS)}`,
    );
  }

  private run<T>(
    activity: DocumentActivity,
    request: Observable<T>,
    handlers: { next: (value: T) => void; error: (error: unknown) => void },
  ): void {
    this._activity.set(activity);
    request
      .pipe(
        finalize(() => {
          if (this._activity() === activity) this._activity.set('idle');
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(handlers);
  }
}

const DOCUMENT_ERRORS = {
  DOCUMENT_VERSION_CONFLICT:
    'It was changed in another tab or device. Load the latest version, then make your edits again.',
  DOCUMENT_NOT_FOUND: 'The saved document no longer exists. Save again to create a new copy.',
  VALIDATION_FAILED: 'The title or content was rejected. Check the document and try again.',
};

function snapshotOf(doc: SavedDocument): Snapshot {
  return { id: doc.id, version: doc.version, title: doc.title, content: doc.content };
}
