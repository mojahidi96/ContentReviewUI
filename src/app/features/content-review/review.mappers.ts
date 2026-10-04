import { InvalidResponseError } from '../../core/http/api-error';
import {
  REVIEW_STATUSES,
  type CreatedReview,
  type Finding,
  type FindingDto,
  type FindingSeverity,
  type ReviewEventPayloads,
  type ReviewEventType,
  type ReviewPage,
  type ReviewStatus,
  type Review,
  type ReviewSummary,
  type TextRange,
} from './review.models';

/**
 * Converts Node's code-point offsets `[start, end)` into a UTF-16 range for JavaScript string
 * APIs. Returns `undefined` when the offsets are unusable or do not select `originalText`, so a
 * bad offset can never highlight or replace the wrong text.
 */
export function codePointRangeToUtf16(
  content: string,
  startOffset: number,
  endOffset: number,
  originalText: string,
): TextRange | undefined {
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)) return undefined;
  if (startOffset < 0 || endOffset <= startOffset) return undefined;
  let codePoint = 0;
  let utf16 = 0;
  let start = -1;
  for (const char of content) {
    if (codePoint === startOffset) start = utf16;
    if (codePoint === endOffset) break;
    utf16 += char.length;
    codePoint++;
  }
  if (codePoint === startOffset && start === -1) start = utf16;
  if (start === -1 || codePoint !== endOffset) return undefined;
  return content.slice(start, utf16) === originalText ? { start, end: utf16 } : undefined;
}

/** Counts Unicode code points, the unit Node uses for limits and offsets. */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

export function toFinding(dto: FindingDto, content: string): Finding {
  const range = codePointRangeToUtf16(content, dto.startOffset, dto.endOffset, dto.originalText);
  return {
    id: dto.findingId,
    category: dto.category,
    severity: dto.severity,
    excerpt: dto.originalText,
    suggestion: dto.suggestedText,
    explanation: dto.explanation,
    ...(range ? { range } : {}),
    status: dto.status,
  };
}

export function toReview(body: unknown): Review {
  const dto = field(body, 'review', isRecord, 'review response');
  const content = field(dto, 'content', isString, 'review.content');
  const findings = field(dto, 'findings', Array.isArray, 'review.findings').map((f, i) =>
    toFinding(findingDto(f, `review.findings[${i}]`), content),
  );
  return {
    ...summaryFields(dto, 'review'),
    categories: field(dto, 'categories', isStringArray, 'review.categories'),
    content,
    contentLength: field(dto, 'contentLength', isCount, 'review.contentLength'),
    findings,
  };
}

export function toReviewPage(body: unknown): ReviewPage {
  const items = field(body, 'items', Array.isArray, 'review list').map((item, i) =>
    reviewSummary(item, `items[${i}]`),
  );
  return {
    items,
    page: field(body, 'page', isCount, 'review list page'),
    totalPages: field(body, 'totalPages', isCount, 'review list totalPages'),
    total: field(body, 'total', isCount, 'review list total'),
  };
}

export function toCreatedReview(body: unknown): CreatedReview {
  return {
    id: field(body, 'reviewId', isString, 'created reviewId'),
    status: field(body, 'status', isReviewStatus, 'created status'),
  };
}

export function toUpdatedFinding(body: unknown, content: string): Finding {
  return toFinding(findingDto(field(body, 'finding', isRecord, 'finding'), 'finding'), content);
}

/**
 * Parses and checks an SSE `data` line. Only the fields the UI relies on are checked; unknown
 * extra fields are ignored as the contract requires.
 */
export function parseEventData<T extends ReviewEventType>(
  type: T,
  raw: string,
): ReviewEventPayloads[T] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new InvalidResponseError(`${type} data is not JSON`);
  }
  field(data, 'reviewId', isString, `${type}.reviewId`);
  switch (type) {
    case 'review.progress':
      field(data, 'stage', isString, `${type}.stage`);
      break;
    case 'finding.detected':
      findingDto(field(data, 'finding', isRecord, `${type}.finding`), `${type}.finding`);
      break;
    case 'review.completed':
      field(data, 'findingCount', isCount, `${type}.findingCount`);
      break;
    case 'review.failed':
      field(data, 'errorCode', isString, `${type}.errorCode`);
      break;
  }
  return data as ReviewEventPayloads[T];
}

// ---------------------------------------------------------------- helpers

function reviewSummary(value: unknown, what: string): ReviewSummary {
  return summaryFields(field({ v: value }, 'v', isRecord, what), what);
}

function summaryFields(dto: Record<string, unknown>, what: string): ReviewSummary {
  return {
    id: field(dto, 'reviewId', isString, `${what}.reviewId`),
    title: field(dto, 'documentTitle', isString, `${what}.documentTitle`),
    createdAt: field(dto, 'createdAt', isString, `${what}.createdAt`),
    status: field(dto, 'status', isReviewStatus, `${what}.status`),
    findingCount: field(dto, 'findingCount', isCount, `${what}.findingCount`),
    errorCode: field(dto, 'errorCode', isStringOrNull, `${what}.errorCode`),
  };
}

const SEVERITIES: readonly string[] = ['low', 'medium', 'high'];
const FINDING_STATUSES_DTO: readonly string[] = ['pending', 'accepted', 'dismissed', 'resolved'];

function findingDto(value: unknown, what: string): FindingDto {
  const f = field({ v: value }, 'v', isRecord, what);
  field(f, 'findingId', isString, `${what}.findingId`);
  field(f, 'category', isString, `${what}.category`);
  field(f, 'originalText', isString, `${what}.originalText`);
  field(f, 'suggestedText', isString, `${what}.suggestedText`);
  field(f, 'explanation', isString, `${what}.explanation`);
  field(f, 'startOffset', Number.isInteger, `${what}.startOffset`);
  field(f, 'endOffset', Number.isInteger, `${what}.endOffset`);
  field(f, 'severity', (v): v is FindingSeverity => SEVERITIES.includes(v as string), what);
  field(f, 'status', (v) => FINDING_STATUSES_DTO.includes(v as string), `${what}.status`);
  return f as unknown as FindingDto;
}

function field<T>(
  value: unknown,
  key: string,
  check: ((v: unknown) => v is T) | ((v: unknown) => boolean),
  what: string,
): T {
  const v = isRecord(value) ? value[key] : undefined;
  if (!check(v)) {
    throw new InvalidResponseError(what);
  }
  return v as T;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const isString = (v: unknown): v is string => typeof v === 'string';
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isReviewStatus = (v: unknown): v is ReviewStatus =>
  (REVIEW_STATUSES as readonly unknown[]).includes(v);
