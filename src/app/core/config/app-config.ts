import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';
import type { ReviewCategory } from '../../features/content-review/review.models';

export interface AppConfig {
  readonly production: boolean;
  /**
   * Base URL of the Node ContentReviewService API, e.g. `/api/v1`. The SPA never talks to the
   * Python service or the LLM provider; Node is the only backend it knows about.
   */
  readonly apiBaseUrl: string;
  /** Default timeout for API calls (not applied to the SSE stream). */
  readonly requestTimeoutMs: number;
  readonly review: {
    /** Upper bound in Unicode code points; must match Node's `REVIEW_MAX_CONTENT_CHARS`. */
    readonly maxChars: number;
    /** Categories sent with every review. The UI has no picker, so this is all of them. */
    readonly categories: readonly ReviewCategory[];
    /** Page size for review history (Node allows 1–50). */
    readonly pageSize: number;
  };
  readonly reviewEvents: {
    /** Times the UI re-opens a dropped event stream before reporting the review as interrupted. */
    readonly maxReconnects: number;
    /** Delay before re-opening a stream that the browser gave up on. */
    readonly reconnectDelayMs: number;
  };
  readonly features: {
    /**
     * "Continue as guest". Node has no guest endpoint, so this is only on for the mock API
     * (`npm run dev`, `mock` configuration).
     */
    readonly guestLogin: boolean;
  };
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG', {
  providedIn: 'root',
  factory: () => environment,
});
