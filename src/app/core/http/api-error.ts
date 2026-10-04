import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import type { ApiErrorBody } from '../../shared/models/api.models';

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
  | 'unknown';

/** Normalized, UI-friendly representation of any failure coming out of the HTTP layer. */
export interface ApiError {
  readonly kind: ApiErrorKind;
  /** HTTP status, or 0 when the request never got a response. */
  readonly status: number;
  /** Machine-readable code from the backend envelope, when present. */
  readonly code?: string;
  /** Backend message. Not guaranteed to be suitable for end users. */
  readonly message: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
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
  if (error instanceof HttpErrorResponse) {
    const body: unknown = error.error;
    if (isApiErrorBody(body)) {
      return {
        kind: kindForStatus(error.status),
        status: error.status,
        code: body.error.code,
        message: body.error.message,
        fieldErrors: body.error.fieldErrors,
      };
    }
    return { kind: kindForStatus(error.status), status: error.status, message: error.message };
  }
  return {
    kind: 'unknown',
    status: 0,
    message: error instanceof Error ? error.message : 'Unexpected error',
  };
}
