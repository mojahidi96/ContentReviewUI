import type { AppConfig } from '../app/core/config/app-config';

/**
 * Development against a real Node ContentReviewService on localhost:3000 (`npm start`).
 * `/api` is proxied by proxy.conf.json, so the browser sees one origin.
 */
export const environment: AppConfig = {
  production: false,
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
