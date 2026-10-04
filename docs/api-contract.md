# ContentReviewService API contract (v1)

This is the contract between the Angular frontend and the Node.js **ContentReviewService**. The frontend never talks to the Python LLM service directly; the Node service owns authentication, persistence and orchestration of the review pipeline.

The TypeScript source of truth is:

- [`src/app/core/auth/auth.models.ts`](../src/app/core/auth/auth.models.ts)
- [`src/app/features/content-review/review.models.ts`](../src/app/features/content-review/review.models.ts)
- [`src/app/shared/models/api.models.ts`](../src/app/shared/models/api.models.ts)

[`mock-server/server.mjs`](../mock-server/server.mjs) is a development-only implementation of this contract.

## Conventions

| Topic | Rule |
| --- | --- |
| Base URL | `/api/v1`, served from the **same site** as the SPA (a reverse proxy in production, the Angular dev-server proxy in development). |
| Format | JSON request and response bodies, UTF-8. |
| Auth | Session cookie `sid`: `HttpOnly; Secure; SameSite=Strict; Path=/api`. The SPA never sees a token. |
| CSRF | Double-submit cookie. The server sets a readable `XSRF-TOKEN` cookie. Every `POST`, `PUT`, `PATCH` and `DELETE` must send the same value in `X-XSRF-TOKEN`, or the server returns `403 CSRF_TOKEN_INVALID`. Angular adds the header automatically. |
| Authorization | Enforced server-side on every request. Reviews are scoped to their owner, and a review owned by someone else returns `404` (not `403`) so IDs don't leak. |
| Text offsets | `range.start` and `range.end` are a half-open `[start, end)` interval in **UTF-16 code units** (JavaScript string indices) into the reviewed `content`. Python tokenisers usually count code points, so the Node service must convert. |
| IDs | Opaque strings (`usr_…`, `rev_…`, `fnd_…`). The UI never uses array indexes as identity. |

## Error envelope

Every non-2xx response has this shape:

```json
{
  "error": {
    "code": "EMAIL_TAKEN",
    "message": "An account with this email already exists.",
    "fieldErrors": { "email": "…" }
  }
}
```

`code` is stable and machine-readable. `message` is for logs and debugging. The UI maps codes to its own copy and never shows `message` verbatim. `fieldErrors` is optional and only appears on validation failures.

| Status | Codes | Meaning |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Malformed JSON |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` | No session, an expired session, or a bad login |
| 403 | `CSRF_TOKEN_INVALID`, `FORBIDDEN` | Missing or mismatched CSRF header; or a `reader` calling an author-only endpoint |
| 404 | `REVIEW_NOT_FOUND`, `FINDING_NOT_FOUND`, `NOT_FOUND` | — |
| 409 | `EMAIL_TAKEN` | Registration conflict |
| 413 | `CONTENT_TOO_LARGE`, `PAYLOAD_TOO_LARGE` | Content above the limit (20,000 chars) or body above 100 kB |
| 422 | `VALIDATION_FAILED`, `CONTENT_EMPTY` | Field validation; `fieldErrors` is present |
| 429 | `RATE_LIMITED` | Reserved |
| 503 | `REVIEW_UNAVAILABLE` | The LLM pipeline is unavailable and the request can be retried |

## Authentication

### `POST /auth/register`

```json
{ "fullName": "Ada Lovelace", "email": "ada@example.com", "password": "Str0ng!Passw0rd" }
```

This returns `201 { "user": User }` and starts a session (it sets `sid`). The password policy is 12–128 characters with at least one lowercase letter, one uppercase letter, one digit and one symbol. Errors: `409 EMAIL_TAKEN` and `422 VALIDATION_FAILED`.

### `POST /auth/login`

```json
{ "email": "ada@example.com", "password": "…" }
```

This returns `200 { "user": User }` and sets `sid`. A failed login returns `401 INVALID_CREDENTIALS`, with the same response for an unknown email and a wrong password.

### `POST /auth/guest`

No body and no credentials. This creates a temporary guest account (role `author`, `guest: true`, empty `email`), returns `201 { "user": User }` and sets `sid`. A guest account and all of its reviews are deleted when its session ends, through logout or expiry. Like every `POST`, it needs the CSRF header.

### `POST /auth/logout`

This returns `204` and clears `sid`. It is idempotent. Logging out a guest deletes the guest account and its reviews.

### `GET /auth/me`

This returns `200 { "user": User }`, or `401` when there is no session. The SPA calls it on startup to restore the session.

```ts
interface User { id: string; fullName: string; email: string; role: 'author' | 'reader'; guest?: true }
// author: edits content and creates/updates reviews. reader: read-only.
// Self-registered accounts are authors. Guest accounts are authors with `guest: true` and email "".
```

## Reviews

### `POST /reviews`

**Authors only** (`403 FORBIDDEN` for readers). This creates and runs a review of the submitted text. The request is synchronous: it returns once the pipeline completes. The client applies a 60-second timeout.

```json
{ "title": "Q3 Operations Review", "content": "…full document text…" }
```

It returns `201 Review`:

```json
{
  "id": "rev_…",
  "title": "Q3 Operations Review",
  "createdAt": "2026-10-04T09:30:00.000Z",
  "status": "completed",
  "content": "…the exact text that was reviewed…",
  "contentLength": 1795,
  "contentHash": "sha256 hex",
  "findings": [
    {
      "id": "fnd_…",
      "category": "spelling",
      "severity": "low",
      "excerpt": "Comittee",
      "suggestion": "Committee",
      "explanation": "\"Comittee\" is misspelled.",
      "range": { "start": 53, "end": 61 },
      "status": "pending"
    }
  ]
}
```

| Field | Notes |
| --- | --- |
| `category` | `spelling`, `grammar`, `vulgar_language`, or any other configured string. Unknown categories are displayed under a humanised label. |
| `severity` | `low`, `medium` or `high`. |
| `suggestion` | Optional. An empty string means "remove this text". If it is absent, there is no automatic fix. |
| `range` | Optional. Findings without a range are listed but not highlighted. |
| `status` | `pending`, `accepted`, `dismissed` or `resolved`. New findings are `pending`. |

Errors: `422 CONTENT_EMPTY`, `413 CONTENT_TOO_LARGE`, `503 REVIEW_UNAVAILABLE` and `504`.

### `GET /reviews`

This returns `200 { "items": ReviewSummary[] }`, newest first, for the current user.

```ts
interface ReviewSummary {
  id: string; title: string; createdAt: string; status: 'completed' | 'failed'; contentLength: number;
  findingCounts: { total: number; pending: number; accepted: number; dismissed: number; resolved: number };
}
```

### `GET /reviews/:reviewId`

This returns `200 Review`, or `404 REVIEW_NOT_FOUND`.

### `PATCH /reviews/:reviewId/findings/:findingId`

**Authors only** (`403 FORBIDDEN` for readers).

```json
{ "status": "accepted" }
```

This returns `200 Finding`, the updated finding. Errors: `404` and `422 VALIDATION_FAILED`.

The status meanings are:

- **accepted**: the user agrees the issue is real.
- **dismissed**: the AI was wrong (a false positive).
- **resolved**: the issue has been fixed. The UI sets this for every accepted suggestion when the user confirms **Save Changes**.

Any transition is allowed, so the user can undo or reopen a finding.

## Not in v1

- **Streaming results (SSE).** Reviews return a completed response. Streaming needs its own agreed event contract before any UI work, and the UI does not simulate streaming.
- **Document persistence.** There are no document endpoints, so the editor content is a local draft. Each review stores a snapshot of the content it reviewed, which is what history restores.
- **Pagination of `GET /reviews`.** The response is wrapped in `{ items }` so cursors can be added without a breaking change.
