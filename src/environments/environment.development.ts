import type { AppConfig } from '../app/core/config/app-config';

/** Development configuration. `/api` is proxied to the mock backend by proxy.conf.json. */
export const environment: AppConfig = {
  production: false,
  apiBaseUrl: '/api/v1',
  requestTimeoutMs: 15_000,
  reviewTimeoutMs: 60_000,
  review: {
    maxChars: 20_000,
  },
};
