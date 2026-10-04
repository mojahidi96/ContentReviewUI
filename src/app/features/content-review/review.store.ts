import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, catchError, finalize, forkJoin, map, of, switchMap } from 'rxjs';
import { APP_CONFIG } from '../../core/config/app-config';
import { toApiError } from '../../core/http/api-error';
import {
  ErrorHandlingService,
  type ErrorMessageOverrides,
} from '../../core/http/error-handling.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { DocumentService } from '../workspace/document.service';
import { ContentReviewApiService } from './content-review-api.service';
import type { Finding, FindingCategory, FindingStatus, Review, TextRange } from './review.models';
import { applyReplacements, mapRange, normalizeRange, type TextReplacement } from './text-ranges';

export type ReviewPhase = 'idle' | 'loading' | 'success' | 'error';
export type ReviewValidationError = 'empty' | 'too_long';
/** Whether the workspace shows the editable text or the highlighted review rendering. */
export type DocumentViewMode = 'edit' | 'review';

export interface FindingFilters {
  readonly category: string;
  readonly status: FindingStatus | 'all';
}

const ALL_FILTERS: FindingFilters = { category: 'all', status: 'all' };

const REVIEW_ERROR_MESSAGES: ErrorMessageOverrides = {
  CONTENT_EMPTY: 'There is no content to review. Add some text and try again.',
  CONTENT_TOO_LARGE: 'The document is too long to review in one pass. Shorten it and try again.',
  REVIEW_UNAVAILABLE:
    'The review service is temporarily unavailable. Your document has not changed — try again in a moment.',
  REVIEW_NOT_FOUND: 'That review no longer exists.',
  timeout: 'The review took longer than expected. Your document has not changed — please retry.',
};

/** A suggestion the user accepted in this session. Kept locally until "Save Changes". */
export interface AcceptedChange {
  readonly findingId: string;
  readonly category: FindingCategory;
  readonly original: string;
  readonly improved: string;
  readonly explanation: string;
  /** Where `original` sits in the reviewed text. */
  readonly range: TextRange;
  readonly acceptedAt: string;
}

/** What a finding card may offer, and why Accept is unavailable when it is. */
export interface FindingActions {
  /** The suggestion is applied to the document but not saved yet. */
  readonly applied: boolean;
  readonly canAccept: boolean;
  readonly canUndo: boolean;
  readonly note: string | null;
}

type ReviewResult = { ok: true; review: Review } | { ok: false; error: unknown };

/**
 * State and workflow for content review: submission, findings, status updates and applying
 * suggestions. Scoped to the workspace shell so it is discarded on logout.
 */
@Injectable()
export class ReviewStore {
  private readonly api = inject(ContentReviewApiService);
  private readonly document = inject(DocumentService);
  private readonly config = inject(APP_CONFIG);
  private readonly errors = inject(ErrorHandlingService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _phase = signal<ReviewPhase>('idle');
  private readonly _error = signal<string | null>(null);
  private readonly _validationError = signal<ReviewValidationError | null>(null);
  private readonly _review = signal<Review | null>(null);
  /**
   * The text the findings' ranges refer to: the reviewed snapshot, moved forward each time
   * accepted changes are saved.
   */
  private readonly _reviewedText = signal<string | null>(null);
  /** Findings as last confirmed by the server; ranges point into `_reviewedText`. */
  private readonly _savedFindings = signal<readonly Finding[]>([]);
  /** Accepted but unsaved changes. Lives as long as the workspace (the signed-in session). */
  private readonly _accepted = signal<readonly AcceptedChange[]>([]);
  private readonly _saving = signal(false);
  private readonly _activeFindingId = signal<string | null>(null);
  /** Incremented on every selection so re-selecting the same finding scrolls to it again. */
  private readonly _focusTick = signal(0);

  readonly phase = this._phase.asReadonly();
  readonly error = this._error.asReadonly();
  readonly validationError = this._validationError.asReadonly();
  readonly review = this._review.asReadonly();
  readonly acceptedChanges = this._accepted.asReadonly();
  readonly isSaving = this._saving.asReadonly();
  readonly activeFindingId = this._activeFindingId.asReadonly();
  readonly focusTick = this._focusTick.asReadonly();
  readonly filters = signal<FindingFilters>(ALL_FILTERS);
  readonly viewMode = signal<DocumentViewMode>('edit');
  /** When false, the document only highlights the finding the user selected. */
  readonly showAllIssues = signal(false);

  readonly isLoading = computed(() => this._phase() === 'loading');
  readonly maxChars = this.config.review.maxChars;

  readonly acceptedIds = computed(() => new Set(this._accepted().map((c) => c.findingId)));
  readonly hasUnsavedChanges = computed(() => this._accepted().length > 0);

  private readonly replacements = computed<TextReplacement[]>(() =>
    this._accepted().map((c) => ({ range: c.range, text: c.improved })),
  );

  /** The reviewed text with every accepted change applied — what the document should contain. */
  private readonly baseline = computed(() => {
    const text = this._reviewedText();
    return text === null ? null : applyReplacements(text, this.replacements());
  });

  /** True when the document no longer matches the text the findings were computed for. */
  readonly isStale = computed(() => {
    const baseline = this.baseline();
    return baseline !== null && baseline !== this.document.content();
  });

  /**
   * Findings as shown to the user: locally accepted ones read as "accepted" and point at their
   * improved text; the rest have ranges shifted past accepted edits (or lose them on overlap).
   */
  readonly findings = computed<readonly Finding[]>(() => {
    const text = this._reviewedText() ?? '';
    const accepted = this.acceptedIds();
    const replacements = this.replacements();
    return this._savedFindings().map((f) => {
      const range = normalizeRange(text, f.range);
      if (!range) {
        return { ...f, range: undefined };
      }
      if (accepted.has(f.id)) {
        const others = replacements.filter((r) => r.range.start !== range.start);
        const start = mapRange(range, others)?.start ?? range.start;
        return {
          ...f,
          status: 'accepted' as const,
          range: { start, end: start + (f.suggestion ?? '').length },
        };
      }
      return { ...f, range: mapRange(range, replacements) ?? undefined };
    });
  });

  /** Findings that can safely be drawn on top of the current document. */
  readonly highlightedFindings = computed(() =>
    this.isStale()
      ? []
      : this.findings().filter(
          (f) => f.range !== undefined && (f.status === 'pending' || f.status === 'accepted'),
        ),
  );

  /**
   * What the review view actually draws: every highlightable finding, or just the selected one.
   * Accepted changes are always shown so the user can see what they changed.
   */
  readonly documentHighlights = computed(() => {
    const highlightable = this.highlightedFindings();
    if (this.showAllIssues()) {
      return highlightable;
    }
    const active = this._activeFindingId();
    const accepted = this.acceptedIds();
    return highlightable.filter((f) => f.id === active || accepted.has(f.id));
  });

  readonly categories = computed(() => [...new Set(this.findings().map((f) => f.category))]);

  readonly visibleFindings = computed(() => {
    const { category, status } = this.filters();
    return this.findings().filter(
      (f) =>
        (category === 'all' || f.category === category) &&
        (status === 'all' || f.status === status),
    );
  });

  readonly counts = computed(() => {
    const counts: Record<FindingStatus, number> = {
      pending: 0,
      accepted: 0,
      dismissed: 0,
      resolved: 0,
    };
    for (const f of this.findings()) {
      counts[f.status]++;
    }
    return { total: this.findings().length, ...counts };
  });

  /** Every review request goes through here; switchMap drops responses that are no longer wanted. */
  private readonly requests$ = new Subject<Observable<Review>>();

  constructor() {
    this.requests$
      .pipe(
        switchMap((request) =>
          request.pipe(
            map((review): ReviewResult => ({ ok: true, review })),
            catchError((error: unknown) => of<ReviewResult>({ ok: false, error })),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) =>
        result.ok ? this.showReview(result.review) : this.fail(result.error),
      );
  }

  /** Reviews whatever text is currently in the editor. */
  submit(): void {
    const content = this.document.content();
    const validationError: ReviewValidationError | null =
      content.trim().length === 0 ? 'empty' : content.length > this.maxChars ? 'too_long' : null;
    if (validationError) {
      this._validationError.set(validationError);
      this.clearFailure();
      return;
    }
    this._validationError.set(null);
    this.startLoading();
    this.requests$.next(this.api.createReview({ title: this.document.title().trim(), content }));
  }

  /** Retrying always re-reads the current editor content; nothing in the editor is touched. */
  retry(): void {
    this.submit();
  }

  loadReview(reviewId: string): void {
    this._validationError.set(null);
    this.startLoading();
    this.requests$.next(this.api.getReview(reviewId));
  }

  selectFinding(findingId: string | null): void {
    this._activeFindingId.set(findingId);
    if (findingId !== null && !this.isStale()) {
      this.viewMode.set('review');
      this._focusTick.update((tick) => tick + 1);
    }
  }

  setShowAllIssues(show: boolean): void {
    this.showAllIssues.set(show);
    if (show && !this.isStale()) {
      this.viewMode.set('review');
    }
  }

  setFilters(filters: Partial<FindingFilters>): void {
    this.filters.update((current) => ({ ...current, ...filters }));
  }

  actionsFor(finding: Finding): FindingActions {
    const applied = this.acceptedIds().has(finding.id);
    const stale = this.isStale();
    const busy = this._saving();
    if (applied) {
      return { applied, canAccept: false, canUndo: !stale && !busy, note: null };
    }
    let note: string | null = null;
    if (finding.status === 'resolved') {
      note = null;
    } else if (finding.suggestion === undefined) {
      note = 'There is no AI suggestion to apply.';
    } else if (!this.originalRange(finding)) {
      note = 'This finding no longer has a location in the text.';
    } else if (!finding.range) {
      note = 'Overlaps a change you accepted. Undo that change to accept this one.';
    }
    const canAccept = finding.status !== 'resolved' && note === null && !stale && !busy;
    return { applied, canAccept, canUndo: false, note };
  }

  /** Applies the suggestion to the document locally. Nothing is sent to the server. */
  accept(findingId: string): boolean {
    const finding = this.findings().find((f) => f.id === findingId);
    const range = finding && this.originalRange(finding);
    if (!finding || !range || !this.actionsFor(finding).canAccept) {
      return false;
    }
    this._accepted.update((list) => [
      ...list,
      {
        findingId,
        category: finding.category,
        original: finding.excerpt,
        improved: finding.suggestion ?? '',
        explanation: finding.explanation,
        range,
        acceptedAt: new Date().toISOString(),
      },
    ]);
    this.syncDocument();
    return true;
  }

  /** Puts the original text back and forgets the accepted change. */
  undo(findingId: string): boolean {
    const finding = this.findings().find((f) => f.id === findingId);
    if (!finding || !this.actionsFor(finding).canUndo) {
      return false;
    }
    this._accepted.update((list) => list.filter((c) => c.findingId !== findingId));
    this.syncDocument();
    return true;
  }

  /**
   * Saves every accepted change by resolving its finding on the server. Afterwards the changes
   * are part of the reviewed text and can no longer be undone.
   */
  saveChanges(): void {
    const review = this._review();
    const changes = this._accepted();
    if (!review || changes.length === 0 || this._saving()) {
      return;
    }
    this._saving.set(true);
    forkJoin(changes.map((c) => this.api.updateFindingStatus(review.id, c.findingId, 'resolved')))
      .pipe(
        finalize(() => this._saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          if (this._review()?.id !== review.id) {
            return;
          }
          const saved = new Set(changes.map((c) => c.findingId));
          // Commit: the current view (ranges into the applied text) becomes the saved state.
          this._savedFindings.set(
            this.findings().map((f) => (saved.has(f.id) ? { ...f, status: 'resolved' } : f)),
          );
          this._reviewedText.set(this.baseline());
          this._accepted.update((list) => list.filter((c) => !saved.has(c.findingId)));
          this.notifications.success(
            changes.length === 1 ? '1 change saved.' : `${changes.length} changes saved.`,
          );
        },
        error: (error: unknown) => {
          if (toApiError(error).kind !== 'unauthorized') {
            this.notifications.error(
              `Could not save your changes. ${this.errors.userMessage(error, {
                FINDING_NOT_FOUND: 'One of the findings no longer exists on the server.',
              })}`,
            );
          }
        },
      });
  }

  /** Puts the text the findings refer to back into the editor (e.g. after opening an old review). */
  restoreReviewedContent(): void {
    const baseline = this.baseline();
    if (baseline !== null) {
      this.document.setContent(baseline);
    }
  }

  private startLoading(): void {
    this._phase.set('loading');
    this._error.set(null);
  }

  private showReview(review: Review): void {
    this._review.set(review);
    this._savedFindings.set(review.findings);
    this._reviewedText.set(review.content);
    this._accepted.set([]);
    this._activeFindingId.set(null);
    this.showAllIssues.set(false);
    this.filters.set(ALL_FILTERS);
    this._phase.set('success');
    if (!this.isStale()) {
      this.viewMode.set('review');
    }
  }

  /** Drops a previous request error so it isn't shown next to an unrelated validation message. */
  private clearFailure(): void {
    if (this._phase() === 'error') {
      this._phase.set(this._review() ? 'success' : 'idle');
      this._error.set(null);
    }
  }

  private fail(error: unknown): void {
    this._phase.set('error');
    this._error.set(this.errors.userMessage(error, REVIEW_ERROR_MESSAGES));
  }

  /** The finding's range in the reviewed text, if it still matches its excerpt. */
  private originalRange(finding: Finding): TextRange | null {
    const text = this._reviewedText() ?? '';
    const saved = this._savedFindings().find((f) => f.id === finding.id);
    const range = normalizeRange(text, saved?.range);
    return range && text.slice(range.start, range.end) === finding.excerpt ? range : null;
  }

  private syncDocument(): void {
    const baseline = this.baseline();
    if (baseline !== null) {
      this.document.setContent(baseline);
    }
  }
}
