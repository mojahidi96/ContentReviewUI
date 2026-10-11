# 02 · Review models and failure details

**Status:** Backend implemented (per the Node team). Kept as the reference for what the UI relies on.
**UI:** `ModelSelection`, `ModelPicker`, `ReviewFailureBanner`, `ReviewStore.failure`.
**Contract:** [`api-contract.md` → Review models and quota failures](../api-contract.md).

## Prompt (use to verify or re-implement)

````markdown
# Task: let authors pick the AI model, and report why a review failed

Under `/api/v1`, session cookie + `X-CSRF-Token` as for `POST /reviews`.

## Models

- `GET /reviews/models` (authenticated) → `200 { "defaultModel": "gemini-3.6-flash", "models": ["gemini-3.6-flash", "gemini-3.8-flash"] }`.
  `defaultModel` is always inside `models`. `503` when the list is unavailable.
  Register the route **before** `/reviews/:reviewId`.
- `POST /reviews` accepts an optional `"model"`. Omit it to use the default. An unknown value returns
  `400 VALIDATION_FAILED` with `error.details = [{ "path": "model", "message": "This model is not available." }]`.
- Review objects (`GET /reviews/{id}` and list items) include `model: string | null` (`null` = default).

## Failure details

A failed review (SSE event `review.failed` and `GET /reviews/{id}`) carries:

```json
{
  "status": "failed",
  "errorCode": "LLM_SERVICE_RATE_LIMITED",
  "errorMessage": "The daily quota for model gemini-3.6-flash is exhausted. It resets in about 1h 58m. Try again later or choose a different model.",
  "errorDetails": {
    "model": "gemini-3.6-flash",
    "quotaScope": "daily",
    "retryAfterSeconds": 7105,
    "resetAt": "2026-10-11T05:30:00+00:00"
  }
}
```

- `errorMessage` is user-safe: the UI displays it as sent. Never put stack traces, provider names
  or raw upstream text in it.
- `errorDetails` is non-null only for `errorCode = LLM_SERVICE_RATE_LIMITED`; every field may be
  null or missing. `quotaScope` is `daily | minute | unknown`; `resetAt` is ISO-8601 UTC.
- Other codes: `LLM_SERVICE_UNAVAILABLE`, `LLM_SERVICE_TIMEOUT`, `LLM_INVALID_RESPONSE`,
  `LLM_CONTENT_TOO_LARGE`, `LLM_REQUEST_REJECTED`, `PROCESSING_TIMEOUT`, `PROCESSING_FAILED`.
- SSE `review.progress` with `stage: "retrying"` (and `nextAttemptAt`) means the backend is waiting
  before another attempt; only `review.failed` is terminal.
- Worst case for one review is about 2 minutes (45 s Python budget, one retry after a timeout, plus
  queue and backoff). The UI shows "Still working…" at 30 s and a stalled panel at 150 s.
````
