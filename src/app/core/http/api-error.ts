import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import type { ApiErrorBody, ApiErrorDetail } from '../../shared/models/api.models';

export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'rate_limited'
  | 'server'
  | 'invalid_response'
  | 'unknown';

/** Normalized, UI-friendly representation of any failure coming out of the HTTP layer. */
export interface ApiError {
  readonly kind: ApiErrorKind;
  /** HTTP status, or 0 when the request never got a response. */
  readonly status: number;
  /** Machine-readable code from the backend envelope, when present. */
  readonly code?: string;
  /** Backend message. Untrusted: never shown verbatim, only logged/mapped by code. */
  readonly message: string;
  /** Validation messages from `details`, keyed by body field name (e.g. `email`). */
  readonly fieldErrors?: Readonly<Record<string, string>>;
  /** Correlation id from the error body or `X-Request-Id` header, for support. */
  readonly requestId?: string;
  /** Seconds from `Retry-After` on `429`, when the server sent one. */
  readonly retryAfterSeconds?: number;
}

/** Thrown by response mappers when a 2xx body does not match the contract. */
export class InvalidResponseError extends Error {
  constructor(what: string) {
    super(`Unexpected response shape: ${what}`);
    this.name = 'InvalidResponseError';
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false;
  }
  const inner = (value as { error: unknown }).error;
  return (
    typeof inner === 'object' &&
    inner !== null &&
    typeof (inner as { code?: unknown }).code === 'string' &&
    typeof (inner as { message?: unknown }).message === 'string'
  );
}

function kindForStatus(status: number): ApiErrorKind {
  switch (status) {
    case 0:
      return 'network';
    case 400:
    case 413:
    case 415:
    case 422:
      return 'validation';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 408:
    case 504:
      return 'timeout';
    case 409:
      return 'conflict';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'server' : 'unknown';
  }
}

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'status' in value &&
    'message' in value
  );
}

/** Converts anything thrown by an HttpClient pipeline into an {@link ApiError}. */
export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) {
    return error;
  }
  if (error instanceof TimeoutError) {
    return { kind: 'timeout', status: 0, message: 'The request timed out.' };
  }
  if (error instanceof InvalidResponseError) {
    return { kind: 'invalid_response', status: 0, message: error.message };
  }
  if (error instanceof HttpErrorResponse) {
    const body: unknown = error.error;
    const headerRequestId = error.headers?.get('X-Request-Id') ?? undefined;
    const retryAfterSeconds = parseRetryAfter(error.headers?.get('Retry-After') ?? null);
    const common = {
      kind: kindForStatus(error.status),
      status: error.status,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    };
    if (isApiErrorBody(body)) {
      const fieldErrors = toFieldErrors(body.error.details);
      const requestId = body.error.requestId ?? headerRequestId;
      return {
        ...common,
        code: body.error.code,
        message: body.error.message,
        ...(fieldErrors ? { fieldErrors } : {}),
        ...(requestId ? { requestId } : {}),
      };
    }
    return {
      ...common,
      message: error.message,
      ...(headerRequestId ? { requestId: headerRequestId } : {}),
    };
  }
  return {
    kind: 'unknown',
    status: 0,
    message: error instanceof Error ? error.message : 'Unexpected error',
  };
}

/** Keeps the first message per body field; `body.email` → `email`. Non-body paths are dropped. */
function toFieldErrors(
  details: readonly ApiErrorDetail[] | undefined,
): Readonly<Record<string, string>> | undefined {
  if (!Array.isArray(details)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const detail of details) {
    if (typeof detail?.path !== 'string' || typeof detail.message !== 'string') continue;
    const [location, field] = detail.path.split('.');
    if (location === 'body' && field && !(field in result)) {
      result[field] = detail.message;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

/** `Retry-After` as delta-seconds (Node's rate limiter never sends an HTTP date). */
function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^\d{1,6}$/.test(value.trim())) {
    return undefined;
  }
  return Number(value.trim());
}
