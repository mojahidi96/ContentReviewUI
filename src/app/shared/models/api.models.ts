/** One validation problem. `path` is `<location>.<field>`, e.g. `body.email` or `query.page`. */
export interface ApiErrorDetail {
  readonly path: string;
  readonly message: string;
}

/** Error envelope returned by the Node ContentReviewService for every non-2xx JSON response. */
export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    /** Correlation id; also sent as the `X-Request-Id` header. Safe to show for support. */
    readonly requestId?: string;
    /** Present only for `400 VALIDATION_FAILED`. */
    readonly details?: readonly ApiErrorDetail[];
  };
}
