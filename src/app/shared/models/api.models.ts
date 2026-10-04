/** Error envelope returned by the ContentReviewService for every non-2xx response. */
export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    /** Field-level validation messages keyed by request field name. */
    readonly fieldErrors?: Readonly<Record<string, string>>;
  };
}
