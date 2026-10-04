import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Observable,
  Subject,
  catchError,
  concat,
  finalize,
  forkJoin,
  map,
  of,
  switchMap,
  throwError,
  timer,
} from 'rxjs';
import { APP_CONFIG } from '../../core/config/app-config';
import { toApiError } from '../../core/http/api-error';
import {
  ErrorHandlingService,
  type ErrorMessageOverrides,
} from '../../core/http/error-handling.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { DocumentService } from '../workspace/document.service';
import { ContentReviewApiService } from './content-review-api.service';
import { ReviewEventsService, ReviewStreamClosedError } from './review-events.service';
import { codePointLength } from './review.mappers';
import type {
  Finding,
  FindingCategory,
  FindingStatus,
  ProgressStage,
  Review,
  ReviewProgress,
  TextRange,
} from './review.models';
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

const UNAVAILABLE =
  'The review service is temporarily unavailable. Your document has not changed — try again in a moment.';

/**
 * Fixed copy for request errors and for Node's processing `errorCode`s. Backend messages
 * (including the `errorMessage` of a failed review) are never shown verbatim.
 */
const REVIEW_ERROR_MESSAGES: ErrorMessageOverrides = {
  VALIDATION_FAILED: 'The review request was rejected. Check the title and content and try again.',
  PAYLOAD_TOO_LARGE: 'The document is too long to review in one pass. Shorten it and try again.',
  REVIEW_NOT_FOUND: 'That review no longer exists.',
  LLM_SERVICE_UNAVAILABLE: UNAVAILABLE,
  LLM_SERVICE_RATE_LIMITED: UNAVAILABLE,
  LLM_SERVICE_TIMEOUT:
    'The review took longer than expected. Your document has not changed — please retry.',
  LLM_INVALID_RESPONSE: 'The review service returned unusable results. Please run it again.',
  LLM_REQUEST_REJECTED: 'This content could not be reviewed.',
  PROCESSING_TIMEOUT: 'The review did not finish. Please run it again.',
  PROCESSING_FAILED: 'The review failed unexpectedly. Please run it again.',
  REVIEW_INTERRUPTED:
    'We lost contact with the review while it was running. It may still finish — resume to check.',
  rate_limited: 'Too many requests. Please wait a moment and try again.',
  timeout: 'The review took longer than expected. Your document has not changed — please retry.',
};

/** A review that reached `failed` (or `cancelled`) on the server. */
class ReviewFailedError extends Error {
  constructor(readonly code: string) {
    super(`Review failed: ${code}`);
  }
}

/** The event stream could not be re-established; the review may still be running. */
class ReviewInterruptedError extends Error {
  readonly code = 'REVIEW_INTERRUPTED';
  constructor(readonly reviewId: string) {
    super('Review progress was interrupted.');
  }
}

const FINDING_ERRORS: ErrorMessageOverrides = {
  FINDING_NOT_FOUND: 'One of the findings no longer exists on the server.',
  REVIEW_NOT_FOUND: 'This review no longer exists on the server.',
  REVIEW_NOT_COMPLETED: 'The review has not finished yet.',
  INVALID_STATE_TRANSITION: 'That finding can no longer be changed this way.',
  CONFLICT: 'The finding was changed elsewhere. Reload the review and try again.',
};

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

const STAGE_LABELS: Record<ProgressStage, string> = {
  queued: 'Waiting for the review service…',
  analyzing: 'Checking spelling, grammar and language…',
  validating: 'Validating findings…',
  persisting: 'Saving results…',
  retrying: 'The review service is busy. Retrying…',
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
  /** Dismissing is sent to the server immediately and cannot be reverted to "pending". */
  readonly canDismiss: boolean;
  readonly note: string | null;
}

type FlowEvent =
  { type: 'progress'; progress: ReviewProgress } | { type: 'review'; review: Review };
type FlowResult = FlowEvent | { type: 'error'; error: unknown };

export interface LoadReviewOptions {
  /** Put the reviewed title and text into the editor (used when restoring after a reload). */
  readonly restoreDocument?: boolean;
}

/**
 * State and workflow for content review: submission, findings, status updates and applying
 * suggestions. Scoped to the workspace shell so it is discarded on logout.
 */
@Injectable()
export class ReviewStore {
  private readonly api = inject(ContentReviewApiService);
  private readonly events = inject(ReviewEventsService);
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
  private readonly _dismissing = signal<ReadonlySet<string>>(new Set());
  /** Server-side progress of the review being run, while `phase` is `loading`. */
  private readonly _stage = signal<ProgressStage | null>(null);
  private readonly _detected = signal(0);
  /** A review whose progress stream was lost; Retry resumes it instead of submitting again. */
  private readonly _interruptedReviewId = signal<string | null>(null);
  /** The review being created or loaded, before it reaches a terminal state. */
  private readonly _trackingId = signal<string | null>(null);
  private readonly _activeFindingId = signal<string | null>(null);
  /** Incremented on every selection so re-selecting the same finding scrolls to it again. */
  private readonly _focusTick = signal(0);

  readonly phase = this._phase.asReadonly();
  readonly error = this._error.asReadonly();
  readonly validationError = this._validationError.asReadonly();
  readonly review = this._review.asReadonly();
  readonly acceptedChanges = this._accepted.asReadonly();
  readonly isSaving = this._saving.asReadonly();
  readonly progressLabel = computed(() => {
    const stage = this._stage();
    return stage ? STAGE_LABELS[stage] : null;
  });
  readonly detectedCount = this._detected.asReadonly();
  readonly canResume = computed(() => this._interruptedReviewId() !== null);
  /** Id of the review shown or being run — what the URL should point at. */
  readonly currentReviewId = computed(() => this._trackingId() ?? this._review()?.id ?? null);
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

  /**
   * Every review flow goes through here. switchMap cancels the previous flow — including closing
   * its event stream — so a stale review can never overwrite a newer one.
   */
  private readonly flows$ = new Subject<{
    flow: Observable<FlowEvent>;
    options: LoadReviewOptions;
  }>();

  constructor() {
    this.flows$
      .pipe(
        switchMap(({ flow, options }) =>
          flow.pipe(
            map((event): [FlowResult, LoadReviewOptions] => [event, options]),
            catchError((error: unknown) =>
              of<[FlowResult, LoadReviewOptions]>([{ type: 'error', error }, options]),
            ),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(([event, options]) => {
        switch (event.type) {
          case 'progress':
            this.onProgress(event.progress);
            break;
          case 'review':
            this.showReview(event.review, options);
            break;
          case 'error':
            this.fail(event.error);
            break;
        }
      });
  }

  /** Reviews whatever text is currently in the editor. */
  submit(): void {
    const content = this.document.content();
    const validationError: ReviewValidationError | null =
      content.trim().length === 0
        ? 'empty'
        : codePointLength(content) > this.maxChars
          ? 'too_long'
          : null;
    if (validationError) {
      this._validationError.set(validationError);
      this.clearFailure();
      return;
    }
    this._validationError.set(null);
    this.startLoading(null);
    const request = {
      title: this.document.title().trim() || 'Untitled document',
      content,
      categories: this.config.review.categories,
    };
    this.flows$.next({
      flow: this.api.createReview(request).pipe(
        switchMap((created) => {
          this._trackingId.set(created.id);
          return this.followUntilDone(created.id, 0, 0);
        }),
      ),
      options: {},
    });
  }

  /**
   * After an interrupted stream, resumes the same review (no duplicate review is created).
   * Otherwise re-reads the current editor content and submits it; the editor is not touched.
   */
  retry(): void {
    const interrupted = this._interruptedReviewId();
    if (interrupted) {
      this.loadReview(interrupted);
    } else {
      this.submit();
    }
  }

  /** Opens a stored review; if it is still running, follows it until it finishes. */
  loadReview(reviewId: string, options: LoadReviewOptions = {}): void {
    this._validationError.set(null);
    this.startLoading(reviewId);
    this.flows$.next({
      flow: this.api
        .getReview(reviewId)
        .pipe(
          switchMap((review) =>
            TERMINAL.has(review.status)
              ? of<FlowEvent>({ type: 'review', review })
              : this.followUntilDone(reviewId, 0, 0),
          ),
        ),
      options,
    });
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
    const busy = this._saving() || this._dismissing().has(finding.id);
    if (applied) {
      return { applied, canAccept: false, canUndo: !stale && !busy, canDismiss: false, note: null };
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
    const canDismiss = finding.status === 'pending' && !busy;
    return { applied, canAccept, canUndo: false, canDismiss, note };
  }

  /**
   * Dismisses a finding on the server right away. Node has no transition back to `pending`, so
   * this is final (a dismissed suggestion can still be accepted later).
   */
  dismiss(findingId: string): void {
    const review = this._review();
    const finding = this.findings().find((f) => f.id === findingId);
    if (!review || !finding || !this.actionsFor(finding).canDismiss) {
      return;
    }
    this._dismissing.update((ids) => new Set(ids).add(findingId));
    this.api
      .updateFindingStatus(review.id, findingId, 'dismissed', review.content)
      .pipe(
        finalize(() =>
          this._dismissing.update((ids) => {
            const next = new Set(ids);
            next.delete(findingId);
            return next;
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          if (this._review()?.id !== review.id) {
            return;
          }
          this._savedFindings.update((list) =>
            list.map((f) => (f.id === findingId ? { ...f, status: 'dismissed' } : f)),
          );
        },
        error: (error: unknown) => {
          if (toApiError(error).kind !== 'unauthorized') {
            this.notifications.error(
              `Could not dismiss the finding. ${this.errors.userMessage(error, FINDING_ERRORS)}`,
            );
          }
        },
      });
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
   * Saves every accepted change by marking its finding `accepted` on the server (Node's only
   * user-settable equivalent). Locally the change becomes part of the reviewed text, shown as
   * "resolved", and can no longer be undone. Node does not store the edited text itself.
   */
  saveChanges(): void {
    const review = this._review();
    const changes = this._accepted();
    if (!review || changes.length === 0 || this._saving()) {
      return;
    }
    this._saving.set(true);
    forkJoin(
      changes.map((c) =>
        this.api.updateFindingStatus(review.id, c.findingId, 'accepted', review.content),
      ),
    )
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
              `Could not save your changes. ${this.errors.userMessage(error, FINDING_ERRORS)}`,
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

  private startLoading(trackingId: string | null): void {
    this._phase.set('loading');
    this._error.set(null);
    this._stage.set(null);
    this._detected.set(0);
    this._interruptedReviewId.set(null);
    this._trackingId.set(trackingId);
  }

  /**
   * Follows the event stream until a terminal event, then fetches the persisted review (the
   * authoritative snapshot with content and findings). If the stream drops, it checks the
   * snapshot and re-subscribes from the last seen event id, up to `maxReconnects` times.
   */
  private followUntilDone(
    reviewId: string,
    afterEventId: number,
    attempt: number,
  ): Observable<FlowEvent> {
    const { maxReconnects, reconnectDelayMs } = this.config.reviewEvents;
    const fetchSnapshot = this.api.getReview(reviewId);
    const resume = (lastEventId: number): Observable<FlowEvent> =>
      fetchSnapshot.pipe(
        switchMap((review) => {
          if (TERMINAL.has(review.status)) {
            return of<FlowEvent>({ type: 'review', review });
          }
          if (attempt >= maxReconnects) {
            return throwError(() => new ReviewInterruptedError(reviewId));
          }
          return this.followUntilDone(reviewId, lastEventId, attempt + 1);
        }),
      );

    return concat(
      this.events
        .follow(reviewId, afterEventId)
        .pipe(map((progress): FlowEvent => ({ type: 'progress', progress }))),
      fetchSnapshot.pipe(map((review): FlowEvent => ({ type: 'review', review }))),
    ).pipe(
      catchError((error: unknown) =>
        error instanceof ReviewStreamClosedError
          ? timer(reconnectDelayMs).pipe(switchMap(() => resume(error.lastEventId)))
          : throwError(() => error),
      ),
    );
  }

  private onProgress(progress: ReviewProgress): void {
    switch (progress.kind) {
      case 'started':
        this._stage.set('analyzing');
        break;
      case 'progress':
        this._stage.set(progress.stage);
        break;
      case 'finding':
        this._detected.update((n) => n + 1);
        break;
      default:
        // Terminal events: the snapshot that follows decides what is shown.
        this._stage.set('persisting');
    }
  }

  private showReview(review: Review, options: LoadReviewOptions = {}): void {
    this._trackingId.set(null);
    this._stage.set(null);
    if (review.status !== 'completed') {
      this.fail(new ReviewFailedError(review.errorCode ?? 'PROCESSING_FAILED'));
      return;
    }
    if (options.restoreDocument) {
      this.document.setTitle(review.title);
      this.document.setContent(review.content);
    }
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
    this._stage.set(null);
    this._trackingId.set(null);
    this._phase.set('error');
    if (error instanceof ReviewInterruptedError) {
      this._interruptedReviewId.set(error.reviewId);
      this._error.set(REVIEW_ERROR_MESSAGES[error.code] ?? null);
    } else if (error instanceof ReviewFailedError) {
      this._error.set(
        REVIEW_ERROR_MESSAGES[error.code] ?? 'The review failed. Please run it again.',
      );
    } else {
      this._error.set(this.errors.userMessage(error, REVIEW_ERROR_MESSAGES));
    }
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
