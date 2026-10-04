import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';

export interface AppConfig {
  readonly production: boolean;
  /** Base URL of the Node ContentReviewService API, e.g. `/api/v1`. */
  readonly apiBaseUrl: string;
  /** Default timeout for API calls. */
  readonly requestTimeoutMs: number;
  /** Longer timeout for review requests, which wait on the LLM pipeline. */
  readonly reviewTimeoutMs: number;
  readonly review: {
    /** Upper bound on characters submitted for review; must match the backend limit. */
    readonly maxChars: number;
  };
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG', {
  providedIn: 'root',
  factory: () => environment,
});
