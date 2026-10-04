// ================================================================ domain (what components use)

/** Categories Node accepts in `POST /reviews` and emits on findings. */
export const REVIEW_CATEGORIES = ['grammar', 'spelling', 'profanity'] as const;
export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];
// `string & {}` keeps autocomplete for known values while still rendering unknown ones ("Other").
export type FindingCategory = ReviewCategory | (string & {});

export type FindingSeverity = 'low' | 'medium' | 'high';

/**
 * `resolved` is UI-local: an accepted suggestion the user saved into the document this session.
 * On the wire it is sent as `accepted` (Node reserves `resolved` for system use).
 */
export const FINDING_STATUSES = ['pending', 'accepted', 'dismissed', 'resolved'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

/** Half-open `[start, end)` range in UTF-16 code units (JavaScript string indices). */
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export interface Finding {
  /** Stable backend identifier (`fnd_…`) — never an array index. */
  readonly id: string;
  readonly category: FindingCategory;
  readonly severity: FindingSeverity;
  /** The text the finding refers to, as it appeared in the reviewed content. */
  readonly excerpt: string;
  /** AI-proposed replacement text (`''` means "remove"). Never applied without user action. */
  readonly suggestion?: string;
  readonly explanation: string;
  /** Converted from Node's code-point offsets; absent when they do not match the content. */
  readonly range?: TextRange;
  readonly status: FindingStatus;
}

export const REVIEW_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface Review {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly status: ReviewStatus;
  readonly categories: readonly FindingCategory[];
  /** Snapshot of the content that was reviewed; finding ranges refer to this text. */
  readonly content: string;
  /** Length in Unicode code points, as Node counts it. */
  readonly contentLength: number;
  readonly findings: readonly Finding[];
  /** Set when `status === 'failed'`. */
  readonly errorCode: string | null;
}

export interface ReviewSummary {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly status: ReviewStatus;
  /** 0 until the review completes. Node does not report per-status counts. */
  readonly findingCount: number;
  readonly errorCode: string | null;
}

export interface ReviewPage {
  readonly items: readonly ReviewSummary[];
  readonly page: number;
  readonly totalPages: number;
  readonly total: number;
}

export interface CreateReviewRequest {
  readonly title: string;
  readonly content: string;
  readonly categories: readonly ReviewCategory[];
}

/** Result of `POST /reviews`: the review is queued, not analysed yet. */
export interface CreatedReview {
  readonly id: string;
  readonly status: ReviewStatus;
}

export type ProgressStage = 'queued' | 'analyzing' | 'validating' | 'persisting' | 'retrying';

/** A review's lifecycle as the UI follows it over SSE. */
export type ReviewProgress =
  | { readonly kind: 'started' }
  | { readonly kind: 'progress'; readonly stage: ProgressStage; readonly attempt: number }
  | { readonly kind: 'finding'; readonly findingId: string }
  | { readonly kind: 'completed'; readonly findingCount: number }
  | { readonly kind: 'failed'; readonly errorCode: string };

// ================================================================ wire format (Node v1)

export type FindingStatusDto = 'pending' | 'accepted' | 'dismissed' | 'resolved';
/** Statuses a user may set with PATCH. */
export type FindingActionDto = 'accepted' | 'dismissed';

export interface FindingDto {
  readonly findingId: string;
  readonly category: string;
  readonly severity: FindingSeverity;
  readonly originalText: string;
  readonly suggestedText: string;
  readonly explanation: string;
  /** Unicode code points, inclusive. */
  readonly startOffset: number;
  /** Unicode code points, exclusive. */
  readonly endOffset: number;
  readonly status: FindingStatusDto;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReviewSummaryDto {
  readonly reviewId: string;
  readonly documentTitle: string;
  readonly status: ReviewStatus;
  readonly categories: readonly string[];
  readonly findingCount: number;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface ReviewDto extends ReviewSummaryDto {
  readonly content: string;
  readonly contentLength: number;
  readonly findings: readonly FindingDto[];
  readonly eventsUrl: string;
}

export interface CreateReviewRequestDto {
  readonly documentTitle: string;
  readonly content: string;
  readonly categories: readonly ReviewCategory[];
}

/** `202 Accepted` body of `POST /reviews`. */
export interface CreatedReviewDto {
  readonly reviewId: string;
  readonly status: ReviewStatus;
  readonly eventsUrl: string;
  readonly createdAt: string;
}

export interface ReviewPageDto {
  readonly items: readonly ReviewSummaryDto[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface ReviewResponseDto {
  readonly review: ReviewDto;
}

export interface UpdateFindingRequestDto {
  readonly status: FindingActionDto;
}

export interface FindingResponseDto {
  readonly finding: FindingDto;
}

/** SSE `data` payloads of `GET /reviews/:id/events`, keyed by event name. */
export interface ReviewEventPayloads {
  'review.started': { reviewId: string; status: 'processing'; occurredAt: string };
  'review.progress': {
    reviewId: string;
    stage: ProgressStage;
    attempt: number;
    nextAttemptAt?: string;
    occurredAt: string;
  };
  'finding.detected': { reviewId: string; finding: FindingDto; occurredAt: string };
  'review.completed': {
    reviewId: string;
    status: 'completed';
    findingCount: number;
    completedAt: string;
    occurredAt: string;
  };
  'review.failed': {
    reviewId: string;
    status: 'failed';
    errorCode: string;
    errorMessage: string;
    occurredAt: string;
  };
}

export type ReviewEventType = keyof ReviewEventPayloads;

export const REVIEW_EVENT_TYPES: readonly ReviewEventType[] = [
  'review.started',
  'review.progress',
  'finding.detected',
  'review.completed',
  'review.failed',
];
