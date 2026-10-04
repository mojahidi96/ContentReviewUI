# API contract: ContentReviewUI ↔ ContentReviewService (Node.js)

This is the contract the Angular app depends on. The architecture is fixed:

```
Angular (browser) ──► Node.js ContentReviewService ──► Python ContentReviewOpenAI ──► Gemini
```

The browser only ever talks to Node, under one base URL (`/api/v1`). It never calls the Python
service or Gemini, and the frontend holds no service URL, token or API key for them.

## How to read this document

Every endpoint and field is tagged:

| Tag | Meaning |
| --- | --- |
| ✅ **Verified** | Read in the Node **source code** (not only its docs) at ContentReviewService commit `dce36b5` (2026-10-04, clean working tree), and implemented by the UI. |
| 🟡 **Proposed** | Needed or wanted by the UI but **not implemented in Node**. Requires agreement before the UI can rely on it. The mock API may implement it, clearly marked. |
| ⛔ **Not available** | Exists only further down the stack (Python) or not at all. The UI does not use it. |

Open questions are numbered `Q1…` and collected in
[integration-status.md](integration-status.md#questions-for-the-nodejs-team). Where the Node
repository's own `docs/api-contract.md` and its code disagree, the code wins and the difference is
called out.

TypeScript types below match `src/app/core/auth/auth.models.ts`,
`src/app/features/content-review/review.models.ts` and `src/app/shared/models/api.models.ts`.
The UI keeps its own domain types and converts in one place
(`toUser()`, `review.mappers.ts`), so a contract change touches one file.

## Endpoint summary

| Method | Path | Auth | CSRF | Status | Used by the UI |
| --- | --- | --- | --- | --- | --- |
| GET | `/auth/csrf` | – | – | ✅ | Before the first state-changing request |
| POST | `/auth/register` | – | ✓ | ✅ | Register page |
| POST | `/auth/login` | – | ✓ | ✅ | Login page |
| POST | `/auth/logout` | ✓ | ✓ | ✅ | Sign out |
| GET | `/auth/me` | ✓ | – | ✅ | Session restore at startup |
| POST | `/auth/guest` | – | ✓ | 🟡 mock-only | "Continue as guest" (feature flag, off for Node) |
| POST | `/reviews` | ✓ | ✓ | ✅ | Run Content Review |
| GET | `/reviews` | ✓ | – | ✅ | Review history (paginated) |
| GET | `/reviews/{reviewId}` | ✓ | – | ✅ | Final snapshot, reload restore, history "Open" |
| GET | `/reviews/{reviewId}/events` | ✓ | – | ✅ | Live progress (SSE) |
| PATCH | `/reviews/{reviewId}/findings/{findingId}` | ✓ | ✓ | ✅ | Dismiss; Save Changes (`accepted`) |
| DELETE | `/reviews/{reviewId}` | ✓ | ✓ | ✅ | Not used yet (no delete UI) |
| PATCH | `/reviews/{reviewId}` (content) | ✓ | ✓ | 🟡 | Would persist saved edits ([Q3](integration-status.md#q3)) |
| POST/GET/DELETE | `/documents…` | ✓ | ✓ | ⛔ | No upload UI; Node has no endpoint |
| POST | `/chat` | ✓ | ✓ | ⛔ | No chat UI; Node has no endpoint |

Node's health endpoints are mounted at `/health` (outside `/api`) and the browser does not use them.

---

## 1. Conventions ✅

- **Base path:** `/api/v1`, configured once as `APP_CONFIG.apiBaseUrl`.
- **Content type:** `application/json; charset=utf-8` for requests and responses, except the SSE
  stream. Node only parses `application/json` bodies (`415 UNSUPPORTED_MEDIA_TYPE` otherwise).
- **Timestamps:** ISO-8601 UTC strings, for example `2026-10-04T00:00:00.000Z`.
- **IDs:** `reviewId` is 24 lowercase hex characters (a MongoDB ObjectId); `findingId` matches
  `^fnd_[a-f0-9]{24}$`. A malformed id is `400 VALIDATION_FAILED`, not `404`.
- **Strict requests:** unknown body fields are rejected with `400 VALIDATION_FAILED`. The UI
  sends exactly the documented fields.
- **Tolerant responses:** clients must ignore unknown response fields. The UI's mappers check
  only the fields they use and ignore the rest.
- **Correlation:** every response has `X-Request-Id`, and error bodies repeat it as
  `error.requestId`. The UI keeps it on `ApiError.requestId` for support output.
- **Caching:** auth and review reads are sent with `Cache-Control: no-store`.

---

## 2. Authentication, cookies and CSRF ✅

### Session cookie

Login and registration set an **HttpOnly** cookie holding a signed JWT. JavaScript can never read
it and it never appears in a response body. Sessions are also stored server-side, so logout revokes
a session immediately even if the cookie is replayed.

| Attribute | Value (Node config) |
| --- | --- |
| Name | `content_review_session` (`AUTH_COOKIE_NAME`) |
| `HttpOnly` | always |
| `Secure` | `AUTH_COOKIE_SECURE`; required to be `true` in production |
| `SameSite` | `Lax` by default (`strict`/`lax`/`none`; `none` requires `Secure`) |
| `Path` | `/api` |
| `Max-Age` | `AUTH_TOKEN_TTL`, default **15 minutes**, **fixed** (no sliding renewal, no refresh endpoint, see [Q5](integration-status.md#q5)) |

Before login, `GET /auth/csrf` also sets an HttpOnly anonymous-identity cookie
(`content_review_session_anon`, 24 h) that binds the pre-login CSRF token to the browser.

**What the UI does:**

- Every request under `apiBaseUrl` is sent with `withCredentials: true` (`apiInterceptor`).
  Requests to any other origin never are. With the recommended same-origin deployment the flag is
  not strictly required, but it keeps cross-origin deployments working.
- The UI never reads, stores or sends a JWT. Nothing auth-related is written to
  `localStorage` or `sessionStorage`. The only per-user storage is the theme preference.

### CSRF: signed double-submit token

Every `POST`, `PATCH`, `PUT` and `DELETE`, **including `login` and `register`**, must carry
`X-CSRF-Token: <token>`. The CSRF cookie (`content_review_csrf`) is **HttpOnly**, so Angular's
built-in cookie-reading XSRF support cannot work and is switched off
(`withNoXsrfProtection()`).

UI implementation (`CsrfService` + `csrfInterceptor`):

1. Before the first state-changing request, `GET /auth/csrf` → `{ "csrfToken": "…" }`.
   Concurrent writes share one request. The token is kept **in memory only**.
2. The interceptor adds `X-CSRF-Token` to `POST`/`PUT`/`PATCH`/`DELETE` requests under
   `apiBaseUrl` only.
3. Tokens are bound to the session. The `csrfToken` returned by `login` and `register` replaces
   the stored token. After `logout`, or when the session expires, the token is cleared and the next
   write fetches a new one.
4. On `403 CSRF_INVALID` the interceptor fetches a new token and **retries the request once**.
   A second failure, or any other `403`, is returned to the caller.

The Node doc suggests calling `/auth/csrf` on app start. The UI fetches it lazily before the first
write instead, which needs one request fewer for a signed-in reload and is otherwise equivalent.

### Origins and CORS

- State-changing requests whose `Origin` (or `Referer`) is not in Node's `FRONTEND_ORIGIN` list
  get `403 ORIGIN_NOT_ALLOWED`. For local development `FRONTEND_ORIGIN` must include
  `http://localhost:4200`. The Angular proxy keeps the browser's `Origin` (`changeOrigin: false`).
- CORS headers are only sent to allow-listed origins. Allowed request headers: `Content-Type`,
  `X-CSRF-Token`, `X-Request-Id`, `Last-Event-ID`. Exposed: `X-Request-Id`, `Location`,
  `RateLimit`, `RateLimit-Policy`, `Retry-After`.

### Expired sessions and unauthorized responses

- A `401` from any protected call clears local auth state, drops the CSRF token and redirects to
  `/login?reason=session-expired&returnUrl=<current URL>` (`authErrorInterceptor`). The login page
  explains what happened, and after signing in the user returns to the same URL. Because the open
  review id is in that URL, the review is restored too.
- `GET /auth/me` at startup, `login`, `register`, `logout` and `/auth/csrf` opt out of the redirect
  (`SKIP_SESSION_EXPIRY`). A `401` there is an expected answer, which is what prevents redirect loops.
- `returnUrl` is accepted only if it is an in-app absolute path (`safeReturnUrl`).
- Route guards (`authGuard`, `guestGuard`, `authorGuard`) are UX only. Node authorizes every
  request and scopes every review to its owner.

---

## 3. Errors ✅

All JSON errors use one envelope:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request is invalid.",
    "requestId": "3f0c8a7e-6a51-4c0e-9d0b-2f3c1b7a9e10",
    "details": [{ "path": "body.categories", "message": "At least one category is required" }]
  }
}
```

```ts
interface ApiErrorDetail { path: string; message: string } // path = "<body|query|params>.<field>"
interface ApiErrorBody {
  error: { code: string; message: string; requestId?: string; details?: ApiErrorDetail[] };
}
```

`details` is present only for `VALIDATION_FAILED`. The UI turns `body.*` details into field
errors (`body.displayName` → the "Full name" field). Node says `message` is safe to display, but
the UI still treats it as untrusted. It shows fixed copy chosen by `code` (falling back to HTTP
status) and never renders backend text as HTML.

| HTTP | `code` | Meaning | UI handling |
| --- | --- | --- | --- |
| 400 | `VALIDATION_FAILED` | Body, params or query failed validation | Field errors where mapped, plus a summary alert |
| 400 | `MALFORMED_JSON` | Body is not JSON | Generic error (a UI bug if it happens) |
| 401 | `AUTH_REQUIRED` | No valid session (missing, expired, revoked) | Session-expired redirect (except opt-outs) |
| 401 | `INVALID_CREDENTIALS` | Login failed; same for unknown email or wrong password | "The email or password is incorrect." |
| 403 | `CSRF_INVALID` | Missing or invalid `X-CSRF-Token` | Refresh token and retry once, then "security token expired" copy |
| 403 | `ORIGIN_NOT_ALLOWED` | Origin not allow-listed | Deployment error copy |
| 404 | `NOT_FOUND` | Unknown route | Generic not-found copy |
| 404 | `REVIEW_NOT_FOUND` | Review missing **or owned by someone else** | "That review no longer exists." |
| 404 | `FINDING_NOT_FOUND` | Finding not in this review | Toast on Dismiss/Save |
| 409 | `EMAIL_ALREADY_REGISTERED` | Duplicate registration | Inline on the email field, with a sign-in link |
| 409 | `REVIEW_NOT_COMPLETED` | Finding update before completion | Toast (the UI only offers actions on completed reviews) |
| 409 | `INVALID_STATE_TRANSITION` | Finding transition not allowed | Toast |
| 409 | `CONFLICT` | Concurrent modification | Toast: reload and retry |
| 413 | `PAYLOAD_TOO_LARGE` | Body over `BODY_LIMIT` (512 kB) | "Shorten the document" |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Unsupported encoding | Generic validation copy |
| 429 | `RATE_LIMITED` | Too many requests; see `RateLimit` and `Retry-After` | "Too many requests"; `retryAfterSeconds` kept on `ApiError` |
| 500 | `INTERNAL_ERROR` | Unexpected | Generic server copy |
| 503 | `SERVICE_UNAVAILABLE` | Node shutting down or dependency down (code exists in Node) | Generic server copy |

Network failures (status 0), client-side timeouts (`requestTimeoutMs`, 15 s; never applied to
SSE) and 2xx bodies that fail the shape checks (`invalid_response`) also have fixed copy. The UI
logs no request bodies, document content or cookies.

**Review processing failures are not HTTP errors.** They appear as `status: "failed"` with
`errorCode` and `errorMessage` on the review and in the `review.failed` event. The UI maps
`errorCode` to fixed copy and ignores `errorMessage`:

| `errorCode` | UI copy (summary) |
| --- | --- |
| `LLM_SERVICE_UNAVAILABLE`, `LLM_SERVICE_RATE_LIMITED` | Service temporarily unavailable; document unchanged |
| `LLM_SERVICE_TIMEOUT` | Took longer than expected; retry |
| `LLM_INVALID_RESPONSE` | Unusable results; run again |
| `LLM_REQUEST_REJECTED` | This content could not be reviewed |
| `PROCESSING_TIMEOUT`, `PROCESSING_FAILED`, unknown codes | The review failed; run again |

---

## 4. Auth endpoints

### `GET /auth/csrf` ✅

`200` with `Cache-Control: no-store`:

```json
{ "csrfToken": "b6f0…e21" }
```

### `POST /auth/register` ✅ (CSRF)

```json
{ "email": "alice@example.com", "password": "correct horse battery", "displayName": "Alice" }
```

| Field | Node rule | UI rule |
| --- | --- | --- |
| `email` | trimmed, valid email, ≤ 254 chars; stored lower-case | Same, plus a dot in the domain |
| `password` | ≥ 12 chars and ≤ 72 UTF-8 bytes | Same length rule **plus** lower, upper, digit and symbol ([Q11](integration-status.md#q11)) |
| `displayName` | 1–100 chars after trimming, well-formed Unicode | Labelled "Full name", 2–100 chars |

`201`, plus the session cookie:

```json
{
  "user": {
    "id": "6720f1c2a4b5c6d7e8f90001",
    "email": "alice@example.com",
    "displayName": "Alice",
    "createdAt": "2026-10-04T00:00:00.000Z"
  },
  "csrfToken": "9a1c…07f"
}
```

Errors: `400 VALIDATION_FAILED`, `403 CSRF_INVALID`/`ORIGIN_NOT_ALLOWED`,
`409 EMAIL_ALREADY_REGISTERED`, `429 RATE_LIMITED` (20 auth requests per 15 min per IP).

### `POST /auth/login` ✅ (CSRF)

```json
{ "email": "alice@example.com", "password": "correct horse battery" }
```

`200 { "user": User, "csrfToken": "…" }` plus the session cookie. Errors: `401 INVALID_CREDENTIALS`
(generic), `400`, `403`, `429`. The login page ignores repeat submissions while one is in flight
(`exhaustMap`) and clears the password after a failure.

### `POST /auth/logout` ✅ (auth, CSRF)

`204`. Revokes the session and clears the session and CSRF cookies. The UI clears local state even
if this request fails, and treats `401` as "already signed out".

### `GET /auth/me` ✅ (auth)

`200 { "user": User }`, or `401 AUTH_REQUIRED`. Called once before the first navigation
(`provideAppInitializer`). A `401` simply means "anonymous".

### `User`

```ts
// Wire (Node)
interface UserDto {
  id: string;
  email: string;        // lower-case
  displayName: string;
  createdAt: string;
  role?: 'author' | 'reader'; // 🟡 proposed — Node never sends it (Q1)
  guest?: boolean;            // 🟡 mock-only (Q2)
}

// UI domain (toUser())
interface User {
  id: string;
  fullName: string;          // ← displayName
  email: string;
  role: 'author' | 'reader'; // missing role → 'author' (Node lets every account review)
  guest?: true;
}
```

### `POST /auth/guest` 🟡 mock-only

No body. `201 { "user": UserDto & { guest: true, email: "" }, "csrfToken": "…" }` plus the session
cookie. The guest account is a temporary author, and it is deleted along with its reviews when the
session ends. **Node has no such endpoint**, so the button is behind `features.guestLogin`, which
is on only in the `mock` build configuration ([Q2](integration-status.md#q2)).

---

## 5. Review endpoints

All require authentication, and every query is scoped to the current user. Another user's
review is reported as `404 REVIEW_NOT_FOUND`.

### `POST /reviews` ✅ (CSRF)

```json
{
  "documentTitle": "Quarterly Business Report",
  "content": "The report have several mistake.",
  "categories": ["grammar", "spelling", "profanity"]
}
```

| Field | Rule |
| --- | --- |
| `documentTitle` | 1–200 chars after trimming. The UI sends the editor title trimmed, or `Untitled document` if it is empty. |
| `content` | Not blank; ≤ `REVIEW_MAX_CONTENT_CHARS` **code points** (default 50 000); well-formed Unicode. Stored **exactly as sent**, so offsets stay valid. The UI counts code points, and its `review.maxChars` (50 000) must match Node's setting. |
| `categories` | Non-empty, unique subset of `grammar`, `spelling`, `profanity`. The UI has no picker, so it sends all three (`review.categories`), which preserves the earlier "review everything" behaviour. |

`202 Accepted`, with header `Location: /api/v1/reviews/{reviewId}`. Analysis runs in the background:

```json
{
  "reviewId": "6720f1c2a4b5c6d7e8f90123",
  "status": "pending",
  "eventsUrl": "/api/v1/reviews/6720f1c2a4b5c6d7e8f90123/events",
  "createdAt": "2026-10-04T00:00:00.000Z"
}
```

The UI then follows the event stream (§6) and finally fetches `GET /reviews/{id}`.

### `GET /reviews?page=1&limit=20&status=completed` ✅

| Query | Default | Rule |
| --- | --- | --- |
| `page` | 1 | integer 1–10 000 |
| `limit` | 20 | integer 1–50 (UI: `review.pageSize` = 20) |
| `status` | – | optional: `pending`, `processing`, `completed`, `failed`, `cancelled` (the UI does not filter yet) |

Newest first. `200`:

```json
{
  "items": [
    {
      "reviewId": "6720f1c2a4b5c6d7e8f90123",
      "documentTitle": "Quarterly Business Report",
      "status": "completed",
      "categories": ["grammar", "spelling", "profanity"],
      "findingCount": 3,
      "errorCode": null,
      "errorMessage": null,
      "createdAt": "2026-10-04T00:00:00.000Z",
      "updatedAt": "2026-10-04T00:00:07.000Z",
      "completedAt": "2026-10-04T00:00:07.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 42,
  "totalPages": 3
}
```

The summary has **no per-status finding counts and no `contentLength`**, so the history page now
shows the review status and the finding total ([Q8](integration-status.md#q8)). Pagination uses
Previous/Next buttons. Empty list: "No reviews yet".

### `GET /reviews/{reviewId}` ✅

`200 { "review": Review }`, which includes `content` and all `findings`. This is the authoritative
snapshot, used after `review.completed`/`review.failed`, after a dropped stream, after a reload
(`/workspace?review=<id>`) and when opening a review from history. Errors: `400` (malformed id),
`404 REVIEW_NOT_FOUND`.

```json
{
  "review": {
    "reviewId": "6720f1c2a4b5c6d7e8f90123",
    "documentTitle": "Quarterly Business Report",
    "status": "completed",
    "categories": ["grammar", "spelling", "profanity"],
    "findingCount": 1,
    "errorCode": null,
    "errorMessage": null,
    "createdAt": "2026-10-04T00:00:00.000Z",
    "updatedAt": "2026-10-04T00:00:07.000Z",
    "completedAt": "2026-10-04T00:00:07.000Z",
    "content": "Hi 😀 we was happy.",
    "contentLength": 18,
    "eventsUrl": "/api/v1/reviews/6720f1c2a4b5c6d7e8f90123/events",
    "findings": [
      {
        "findingId": "fnd_0892cccffd6ddca2ba38f7f1",
        "category": "grammar",
        "severity": "medium",
        "originalText": "we was",
        "suggestedText": "we were",
        "explanation": "Subject–verb agreement: \"we\" takes \"were\".",
        "startOffset": 5,
        "endOffset": 11,
        "status": "pending",
        "createdAt": "2026-10-04T00:00:07.000Z",
        "updatedAt": "2026-10-04T00:00:07.000Z"
      }
    ]
  }
}
```

### `PATCH /reviews/{reviewId}/findings/{findingId}` ✅ (CSRF)

```json
{ "status": "dismissed" }
```

`status` must be `accepted` or `dismissed`. `resolved` is **system-managed** and rejected with
`400`. Allowed transitions (setting the current status again is a no-op `200`):

| From | To |
| --- | --- |
| `pending` | `accepted`, `dismissed` |
| `accepted` | `dismissed` |
| `dismissed` | `accepted` |
| `resolved` | – |

`200 { "finding": Finding }`. Errors: `409 REVIEW_NOT_COMPLETED`, `409 INVALID_STATE_TRANSITION`,
`409 CONFLICT`, `404 REVIEW_NOT_FOUND`, `404 FINDING_NOT_FOUND`.

How the UI uses it:

| UI action | Request | Notes |
| --- | --- | --- |
| **Accept** / **Undo** | none | Local only: applies or reverts the suggestion in the editor and can be undone in any order (unchanged behaviour). |
| **Save Changes** | `PATCH {status:"accepted"}` per accepted finding, in parallel | The UI used to send `resolved`, which Node rejects. Locally the finding is shown as "Resolved" and the edited text becomes the new baseline. **Node does not store the edited text** ([Q3](integration-status.md#q3)). |
| **Dismiss** | `PATCH {status:"dismissed"}` immediately | New. Only offered for `pending` findings that are not locally accepted. Final, because there is no transition back to `pending` ([Q4](integration-status.md#q4)). |

### `DELETE /reviews/{reviewId}` ✅ (CSRF), not used yet

`204`. Permanently deletes the review, its findings and its event history. The UI has no delete
action yet, and adding one is a UI decision, not a contract gap.

### Review types

```ts
type ReviewStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
type Category = 'grammar' | 'spelling' | 'profanity';

interface FindingDto {
  findingId: string;                       // stable across retries and reconnects
  category: string;                        // Category; unknown values are shown as "Other"
  severity: 'low' | 'medium' | 'high';
  originalText: string;
  suggestedText: string;                   // '' means "remove this text"
  explanation: string;
  startOffset: number;                     // code points, inclusive
  endOffset: number;                       // code points, exclusive
  status: 'pending' | 'accepted' | 'dismissed' | 'resolved';
  createdAt: string;
  updatedAt: string;
}

interface ReviewSummaryDto {
  reviewId: string;
  documentTitle: string;
  status: ReviewStatus;
  categories: Category[];
  findingCount: number;                    // 0 until completed
  errorCode: string | null;                // set when failed
  errorMessage: string | null;             // ignored by the UI
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface ReviewDto extends ReviewSummaryDto {
  content: string;
  contentLength: number;                   // code points
  findings: FindingDto[];                  // ordered by startOffset
  eventsUrl: string;
}
```

Lifecycle: `pending → processing → completed | failed`. `cancelled` is reserved (Node has no cancel
endpoint, see [Q10](integration-status.md#q10)). The UI treats `completed`, `failed` and
`cancelled` as terminal.

---

## 6. Server-Sent Events: `GET /reviews/{reviewId}/events` ✅

Served by **Node** (not Python), authenticated by the **session cookie**. Because it is a plain
`GET` with no custom headers, the UI uses the native **`EventSource`** with
`withCredentials: true`. No JWT, CSRF token or other secret ever goes in the URL. The only query
parameter is the non-secret `lastEventId`.

Authorization and ownership are checked **before** the stream opens, so failures are ordinary
JSON errors (`400`, `401`, `404`). `EventSource` cannot read their bodies, so the UI handles them
through the snapshot fallback below.

```
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-store, no-transform
X-Accel-Buffering: no

retry: 3000

id: 1
event: review.started
data: {"reviewId":"…","status":"processing","occurredAt":"…"}

: heartbeat
```

- `id` is a positive integer, strictly increasing **per review** (gaps allowed).
- A `: heartbeat` comment is sent every 15 s (`SSE_HEARTBEAT_MS`).
- The server **closes the stream after `review.completed` or `review.failed`**.
- If the review is already terminal and nothing is left after the given id, the response is
  **`204 No Content`**, which tells `EventSource` to stop reconnecting.

### Events

Every payload includes `reviewId` and `occurredAt`.

| `event` | `data` | UI |
| --- | --- | --- |
| `review.started` | `{ reviewId, status: "processing", occurredAt }` | "Checking spelling, grammar and language…" |
| `review.progress` | `{ reviewId, stage, attempt, nextAttemptAt?, occurredAt }` | Stage label (see below) |
| `finding.detected` | `{ reviewId, finding: Finding, occurredAt }` | "N findings so far" (findings are not actionable until completion) |
| `review.completed` | `{ reviewId, status: "completed", findingCount, completedAt, occurredAt }` | Close the stream, then `GET` the snapshot |
| `review.failed` | `{ reviewId, status: "failed", errorCode, errorMessage, occurredAt }` | Close the stream, then `GET` the snapshot and show the `errorCode` copy |

`stage` is one of `analyzing`, `validating`, `persisting` or `retrying` (`nextAttemptAt` is only
sent with `retrying`). Node's TypeScript type also lists `queued`, which the code never emits and
its doc doesn't mention. The UI accepts it anyway ("Waiting for the review service…") ([Q6](integration-status.md#q6)).

`finding.detected` events are sent **after** all findings have been validated and persisted.
This is not token streaming. Typical sequence: `started → progress(analyzing) →
(progress(retrying) → progress(analyzing))* → progress(validating) → progress(persisting) →
finding.detected* → completed`.

### Reconnection and recovery (what the UI implements)

`ReviewEventsService.follow()` and `ReviewStore.followUntilDone()`:

1. Events are persisted and delivered at least once. The UI drops any event whose `id` is ≤ the
   last id it handled.
2. **Transient drop** (`readyState` CONNECTING): the browser reconnects by itself and sends
   `Last-Event-ID`, and Node resumes after it. The UI waits, but gives up after
   `reviewEvents.maxReconnects` (5) consecutive errors without a successful open.
3. **Stream closed for good** (`readyState` CLOSED: `204`, `401`, `404`, `5xx`, or too many
   errors): after `reconnectDelayMs` (3 s) the UI fetches `GET /reviews/{id}`.
   - Terminal → show the snapshot (completed findings or the failure copy).
   - Still `pending`/`processing` → open a new stream with `?lastEventId=<last id>`, up to
     `maxReconnects` times.
   - `401` → the normal session-expired redirect.
   - Out of attempts → "We lost contact with the review…". **Resume review** reloads the same
     review id and does **not** submit a duplicate.
4. After a terminal event the UI always fetches the snapshot, because that is the authoritative
   content and finding list.
5. Streams are closed on terminal events, when a newer review is submitted or opened
   (`switchMap`), when the workspace is destroyed (sign-out), and on unsubscribe. A late event from
   an old stream can never overwrite a newer review.
6. After a full reload, `/workspace?review=<id>` fetches the snapshot first and only opens a
   stream if the review is still running (stream from the start, de-duplicated).

`Last-Event-ID` takes precedence over the `lastEventId` query parameter on the server.

---

## 7. Text offsets ✅

`startOffset`/`endOffset` are **Unicode code point** indexes into the review `content`, forming a
half-open range `[startOffset, endOffset)`. This is Python's `content[start:end]` and JavaScript's
`Array.from(content).slice(start, end).join('')`, **not** `String.prototype.slice`. Node
guarantees that this slice equals `originalText` for every persisted finding, and never normalizes
content.

The UI works in UTF-16 internally (DOM, string APIs, its range engine). `codePointRangeToUtf16()`
converts each finding once, at the API boundary, and **drops the range if the converted slice is
not exactly `originalText`**. Such a finding is still listed, but it can't be highlighted or
accepted ("no longer has a location in the text").

| Content | Code points | `"wrld"` offsets | UTF-16 range in the UI |
| --- | --- | --- | --- |
| `Hi wrld` | 7 | `[3, 7)` | `[3, 7)` |
| `Hi 😀 wrld` | 9 | `[5, 9)` | `[6, 10)` |
| `Hi 👋🏽 wrld` | 10 | `[6, 10)` | `[8, 12)` |
| `Hé wrld` | 8 | `[4, 8)` | `[4, 8)` |

These rows are unit-tested in `review.mappers.spec.ts`.

---

## 8. UI states

| State | Trigger | What the user sees |
| --- | --- | --- |
| Idle | No review yet | "No review yet" and **Run Content Review** |
| Validation | Empty content, or more than 50 000 code points | Inline warning; no request sent |
| Submitting | `POST /reviews` in flight | "Submitting your document…" |
| Pending / processing | 202 received; events arriving | Spinner with stage label and "N findings so far"; `aria-busy` |
| Completed, empty | `findingCount = 0` | "No issues found" |
| Completed | Snapshot loaded | Findings with Accept / Undo / Dismiss; highlights; Save Changes |
| Failed | `review.failed` / `status: failed` | Fixed copy for the `errorCode`, **Retry review** (resubmits the current editor text) |
| Interrupted | Stream could not be resumed | "We lost contact…", **Resume review** (same review id) |
| Request error | 4xx/5xx/network/timeout on submit or load | Mapped copy and **Retry review** |
| Stale | Editor text ≠ text the findings refer to | Highlights, Accept and Undo disabled; re-run or restore |
| History loading / empty / error | `GET /reviews` | Spinner / "No reviews yet" / alert with **Try again** |

---

## 9. Limits ✅

| Limit | Default | Node config |
| --- | --- | --- |
| Request body | 512 kB | `BODY_LIMIT` |
| Review content | 50 000 code points | `REVIEW_MAX_CONTENT_CHARS` (keep `review.maxChars` in sync) |
| API rate limit | 300 requests / 15 min / IP | `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS` |
| Login/register rate limit | 20 requests / 15 min / IP | `AUTH_RATE_LIMIT_MAX` |
| Page size | 1–50 | — |
| Review retention | 90 days, then auto-deleted | `REVIEW_RETENTION_DAYS` |
| Session lifetime | 15 min, fixed | `AUTH_TOKEN_TTL` |

SSE (re)connections and snapshot fetches count towards the API rate limit
([Q12](integration-status.md#q12)).

---

## 10. Proposed and unavailable capabilities

These are **not implemented in Node**. Nothing in the UI depends on them except where noted
(the mock-only guest flag and the optional `role`).

### 10.1 Roles 🟡 ([Q1](integration-status.md#q1))

The UI has a read-only "reader" experience (no editor, no review tools, no history). Node has no
roles: every account may create reviews and update findings. The UI therefore treats a missing
`role` as `author`. If Node adds `role: 'author' | 'reader'` to `User`, and returns
`403 FORBIDDEN` for reader writes, the UI needs no further changes.

### 10.2 Guest sessions 🟡 ([Q2](integration-status.md#q2))

`POST /auth/guest` as described in §4. Only the mock implements it.

### 10.3 Persisting edited content 🟡 ([Q3](integration-status.md#q3))

Node stores the submitted `content` as a snapshot and nothing else. A proposal that keeps Node's
offset guarantees:

```
PATCH /api/v1/reviews/{reviewId}/findings/{findingId}
{ "status": "resolved" }            // allow users to mark an accepted finding as applied
```

or a document resource that owns the current text (`PUT /documents/{id}` with
`{ title, content, basedOnReviewId }`). Until one of these exists, saved edits live only in the
browser session; a reload restores the review's original snapshot.

### 10.4 Document upload and RAG chat ⛔ ([Q13](integration-status.md#q13))

**Current state:** the UI has **no upload or chat feature**, and Node has **no `/documents` or
`/chat` routes**. The Python service has internal endpoints
(`/internal/v1/documents`, `/internal/v1/chat`) that require a service token and an
`X-Tenant-ID`, so they must never be exposed to the browser. Nothing here is implemented in the UI.

If the feature is built, the browser would talk to Node only. A starting point derived from the
Python contract, **to be agreed with Node**:

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| POST | `/api/v1/documents` | `multipart/form-data`: `file` (required; `.pdf`, `.docx`, `.xlsx`; max size TBD = Python `MAX_UPLOAD_SIZE_MB`), `metadata` (optional JSON, ≤ 20 string pairs) | `201` (`status: "ready"`) or `202` (`status: "uploaded"`) with the document resource |
| GET | `/api/v1/documents/{documentId}` | – | Document resource; poll until `ready` or `failed` (or Node adds SSE) |
| DELETE | `/api/v1/documents/{documentId}` | – | `204`; `409` while `uploaded`/`processing` |
| POST | `/api/v1/chat` | `{ conversationId, documentIds[1..10], question (≤ 2000), history? }` | `{ conversationId, answer, insufficientEvidence, sources[] }` with `[S1]` markers |

```ts
type DocumentStatus = 'uploaded' | 'processing' | 'ready' | 'failed';
interface DocumentResource {
  documentId: string; fileName: string; fileType: 'pdf' | 'docx' | 'xlsx'; sizeBytes: number;
  status: DocumentStatus; createdAt: string; updatedAt: string;
  pageCount: number | null; sheetNames: string[]; chunkCount: number; warnings: string[];
  error: { code: string; message: string; retryable: boolean } | null;
}
interface ChatSource {
  sourceId: string; documentId: string; documentName: string; pageNumber: number | null;
  sheetName: string | null; cellRange: string | null; heading: string | null; excerpt: string;
}
```

Node would own authentication, map the session user to `X-Tenant-ID`, and decide whether to pass
through `model` and `usage` (the UI does not need them).

---

## 11. Local development and deployment

| Setup | Command | API |
| --- | --- | --- |
| Mock (no Node, Mongo or Python) | `npm run dev` | `mock-server/` on :3000; `mock` build configuration (guest login on) |
| Real Node | Start ContentReviewService on :3000 (`FRONTEND_ORIGIN=http://localhost:4200`, `AUTH_COOKIE_SECURE=false` on plain http), then `npm start` | `development` configuration (guest login off) |

`proxy.conf.json` forwards `/api` to `http://localhost:3000`, so the browser sees one origin and
the `SameSite=Lax` cookie is first-party. Production should do the same with a reverse proxy
(`/` → SPA, `/api` → Node), with buffering disabled for `text/event-stream` (Node already sends
`X-Accel-Buffering: no`). If the SPA and API are ever on different sites, Node needs
`AUTH_COOKIE_SAMESITE=none` with `Secure`, and `apiBaseUrl` would become absolute.
`withCredentials` already handles that case.
