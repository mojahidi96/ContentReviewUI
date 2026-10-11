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
    /** `POST /reviews` answers `202` at once, so a slow answer means the request is stuck. */
    readonly createTimeoutMs: number;
  };
  readonly reviewEvents: {
    /** Times the UI re-opens a dropped event stream before reporting the review as interrupted. */
    readonly maxReconnects: number;
    /** Delay before re-opening a stream that the browser gave up on. */
    readonly reconnectDelayMs: number;
  };
  /** Keeps the progress view honest when a review takes long or its stream goes quiet. */
  readonly reviewWatchdog: {
    /** After this long without a terminal event, say the review is still working. */
    readonly stillWorkingMs: number;
    /** After this long, stop the spinner and offer Check status / Cancel and retry. */
    readonly stalledMs: number;
    /** Interval for polling `GET /reviews/:id` while the event stream is down. */
    readonly pollMs: number;
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
