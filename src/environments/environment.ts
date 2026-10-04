import type { AppConfig } from '../app/core/config/app-config';

/**
 * Production configuration. `apiBaseUrl` is relative on purpose: the SPA and the Node
 * ContentReviewService are expected to be served from the same origin (reverse proxy), which
 * keeps the session cookie first-party and avoids CORS entirely.
 */
export const environment: AppConfig = {
  production: true,
  apiBaseUrl: '/api/v1',
  requestTimeoutMs: 15_000,
  review: {
    maxChars: 50_000,
    categories: ['grammar', 'spelling', 'profanity'],
    pageSize: 20,
  },
  reviewEvents: { maxReconnects: 5, reconnectDelayMs: 3_000 },
  features: { guestLogin: false },
};
