/** Categories the backend currently emits. Unknown categories are still rendered (as "Other"). */
export const KNOWN_CATEGORIES = ['spelling', 'grammar', 'vulgar_language'] as const;
export type KnownFindingCategory = (typeof KNOWN_CATEGORIES)[number];
// `string & {}` keeps autocomplete for known values while accepting configured extras.
export type FindingCategory = KnownFindingCategory | (string & {});

export type FindingSeverity = 'low' | 'medium' | 'high';

export const FINDING_STATUSES = ['pending', 'accepted', 'dismissed', 'resolved'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

/** Half-open `[start, end)` range in UTF-16 code units (JavaScript string indices). */
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export interface Finding {
  /** Stable backend identifier — never an array index. */
  readonly id: string;
  readonly category: FindingCategory;
  readonly severity: FindingSeverity;
  /** The text the finding refers to, as it appeared in the reviewed content. */
  readonly excerpt: string;
  /** AI-proposed replacement text, if any. Never applied without explicit user action. */
  readonly suggestion?: string;
  readonly explanation: string;
  readonly range?: TextRange;
  readonly status: FindingStatus;
}

export type ReviewStatus = 'completed' | 'failed';

export interface Review {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly status: ReviewStatus;
  /** Snapshot of the content that was reviewed; finding ranges refer to this text. */
  readonly content: string;
  readonly contentLength: number;
  readonly contentHash: string;
  readonly findings: readonly Finding[];
}

export interface FindingCounts {
  readonly total: number;
  readonly pending: number;
  readonly accepted: number;
  readonly dismissed: number;
  readonly resolved: number;
}

export interface ReviewSummary {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly status: ReviewStatus;
  readonly contentLength: number;
  readonly findingCounts: FindingCounts;
}

export interface CreateReviewRequest {
  readonly title: string;
  readonly content: string;
}

export interface ReviewListResponse {
  readonly items: readonly ReviewSummary[];
}

export interface UpdateFindingRequest {
  readonly status: FindingStatus;
}
