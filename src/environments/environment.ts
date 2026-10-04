import type { AppConfig } from '../app/core/config/app-config';

/**
 * Production configuration. `apiBaseUrl` is relative on purpose: the SPA and the
 * Node ContentReviewService are expected to be served from the same site (reverse proxy),
 * which keeps the session cookie SameSite and lets Angular's XSRF support work.
 */
export const environment: AppConfig = {
  production: true,
  apiBaseUrl: '/api/v1',
  requestTimeoutMs: 15_000,
  reviewTimeoutMs: 60_000,
  review: {
    maxChars: 20_000,
  },
};
