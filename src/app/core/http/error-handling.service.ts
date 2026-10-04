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
  unknown: 'Something unexpected happened. Please try again.',
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
      (apiError.code ? overrides[apiError.code] : undefined) ??
      overrides[apiError.kind] ??
      DEFAULT_MESSAGES[apiError.kind]
    );
  }
}
