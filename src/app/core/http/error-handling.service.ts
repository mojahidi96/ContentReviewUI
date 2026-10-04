import { Service } from '@angular/core';
import { ApiError, toApiError } from './api-error';

/** Optional per-call overrides keyed by backend error code or by {@link ApiError.kind}. */
export type ErrorMessageOverrides = Readonly<Partial<Record<string, string>>>;

const DEFAULT_MESSAGES: Readonly<Record<ApiError['kind'], string>> = {
  network: 'We could not reach the server. Check your connection and try again.',
  timeout: 'The server took too long to respond. Please try again.',
  unauthorized: 'Your session has ended. Please sign in again.',
  forbidden: 'You do not have permission to perform this action.',
  not_found: 'The requested item could not be found.',
  conflict: 'This change conflicts with the current state. Refresh and try again.',
  validation: 'Some of the submitted information is invalid.',
  rate_limited: 'Too many requests. Please wait a moment and try again.',
  server: 'Something went wrong on our side. Please try again shortly.',
  invalid_response: 'The server sent a response we could not understand. Please try again.',
  unknown: 'Something unexpected happened. Please try again.',
};

/** Node codes whose HTTP status alone would produce misleading copy. */
const DEFAULT_CODE_MESSAGES: Readonly<Record<string, string>> = {
  CSRF_INVALID: 'Your security token has expired. Refresh the page and try again.',
  ORIGIN_NOT_ALLOWED: 'This site is not allowed to talk to the review service.',
  PAYLOAD_TOO_LARGE: 'The request is too large. Shorten the document and try again.',
  MALFORMED_JSON: 'Something unexpected happened. Please try again.',
};

/**
 * Maps API failures to user-facing copy. Backend messages are never shown verbatim
 * so internal details cannot leak into the UI.
 */
@Service()
export class ErrorHandlingService {
  toApiError(error: unknown): ApiError {
    return toApiError(error);
  }

  userMessage(error: unknown, overrides: ErrorMessageOverrides = {}): string {
    const apiError = toApiError(error);
    return (
      (apiError.code
        ? (overrides[apiError.code] ?? DEFAULT_CODE_MESSAGES[apiError.code])
        : undefined) ??
      overrides[apiError.kind] ??
      DEFAULT_MESSAGES[apiError.kind]
    );
  }
}
