# Integration status: ContentReviewUI → ContentReviewService (Node.js)

Status as of 2026-10-05. Compared against ContentReviewService commit `dce36b5` (clean working
tree) and ContentReviewOpenAI's docs. The contract itself is in [api-contract.md](api-contract.md).

**Summary:** the UI now speaks the verified Node v1 contract for authentication, CSRF, reviews,
SSE and errors. It has been run end to end against the **real Node service** (backed by an
in-memory MongoDB and Node's own mock LLM client) as well as against the updated mock API. Five
UI behaviours have no Node equivalent. Each is described below, flagged in the UI, and listed as
an open question rather than silently changed.

## 1. Initial assessment (before this change)

The UI had been built against a contract of its own (`mock-server/`, the old
`docs/api-contract.md`), not against Node. Almost every request and response differed:

| Area | UI assumed | Node actually does (verified in code) |
| --- | --- | --- |
| CSRF | Readable `XSRF-TOKEN` cookie → `X-XSRF-TOKEN` (Angular built-in) | HttpOnly CSRF cookie; token only via `GET /auth/csrf` or login/register JSON → `X-CSRF-Token`; also required on login/register |
| Session cookie | `sid`, `SameSite=Strict`, 30 min | `content_review_session`, `SameSite=Lax`, **15 min fixed** |
| User | `{ id, fullName, email, role }` | `{ id, email, displayName, createdAt }`, **no role** |
| Login/register response | `{ user }` | `{ user, csrfToken }` |
| Register body / errors | `fullName`; `409 EMAIL_TAKEN`; `422` + `fieldErrors` map | `displayName`; `409 EMAIL_ALREADY_REGISTERED`; `400` + `details[{path,message}]` |
| Password policy | 12–128 chars + 4 character classes | 12 chars to 72 UTF-8 bytes, no class rules |
| Error envelope | `{ code, message, fieldErrors? }` | `{ code, message, requestId, details? }` + `X-Request-Id` |
| Create review | `{ title, content }` → **synchronous** `201` full review (60 s timeout) | `{ documentTitle, content, categories }` → **`202`** `{ reviewId, status, eventsUrl }`; results via SSE + GET |
| Review body | bare `Review` | wrapped: `{ review }` |
| Review fields | `id`, `title`, `contentHash` | `reviewId`, `documentTitle`, no hash; `categories`, `errorCode`, `completedAt`, … |
| Statuses | `completed`, `failed` | `pending`, `processing`, `completed`, `failed`, `cancelled` |
| Finding fields | `id`, `excerpt`, `suggestion?`, `range{start,end}` | `findingId`, `originalText`, `suggestedText` (always a string), `startOffset`/`endOffset` |
| Offsets | UTF-16 code units | **Unicode code points** |
| Categories | `spelling`, `grammar`, `vulgar_language` | `grammar`, `spelling`, `profanity` (required in the request) |
| Finding PATCH | `{status:'resolved'}` → bare finding | only `accepted`/`dismissed` (`resolved` rejected) → `{ finding }` |
| List reviews | `{ items }` with per-status `findingCounts`, `contentLength` | paginated `{ items, page, limit, total, totalPages }`, only `findingCount` |
| Content limit | 20 000 UTF-16 units | 50 000 code points |
| SSE | none ("needs an agreed streaming contract") | `GET /reviews/:id/events` with five event types, replay and `204` |
| Roles / guest | `author`/`reader`; `POST /auth/guest` | neither exists |
| Upload / chat | not in UI | not in Node (Python has internal endpoints only) |

What was reused unchanged: the routes and guards, the workspace shell and its scoping, the
editor, the highlight renderer (`buildSegments`), the local accept/undo engine
(`applyReplacements`/`mapRange`), stale-text protection, theming, accessibility work, and all
presentational components. The UI keeps its domain model, and Node's wire format is mapped at the
API boundary.

## 2. What changed in the UI

| Area | Change | Files |
| --- | --- | --- |
| CSRF | New in-memory `CsrfService` and `csrfInterceptor` (token fetch shared by concurrent writes, header on unsafe API requests only, one retry on `CSRF_INVALID`). Angular's cookie XSRF is turned off. | `core/auth/csrf.service.ts`, `core/interceptors/csrf.interceptor.ts`, `app.config.ts` |
| Auth | Node DTOs and `toUser()` (`displayName`→`fullName`, missing role→author); `csrfToken` from login/register stored; token cleared on logout and expiry; guest call marked mock-only. | `core/auth/auth.models.ts`, `core/auth/auth.service.ts` |
| Errors | `details[]` mapped to field errors, plus `requestId`, `Retry-After`, the `invalid_response` kind and fixed copy for `CSRF_INVALID`/`ORIGIN_NOT_ALLOWED`/`PAYLOAD_TOO_LARGE`. | `core/http/api-error.ts`, `core/http/error-handling.service.ts`, `shared/models/api.models.ts` |
| Review API | Node request/response DTOs; shape-checked mappers; code point → UTF-16 conversion that drops any range not matching `originalText`; pagination. | `content-review/review.models.ts`, `review.mappers.ts`, `content-review-api.service.ts` |
| SSE | `ReviewEventsService` (native `EventSource`, `withCredentials`, de-duplication by id, closes on terminal events and on unsubscribe) behind an injectable factory. | `content-review/review-events.service.ts` |
| Review flow | Submit → 202 → follow events → GET snapshot; resume after closed streams; "interrupted" state with **Resume review** (no duplicate submission); progress stage and live finding count; failure copy by `errorCode`; `switchMap` closes stale streams. | `content-review/review.store.ts`, `findings-panel.ts` |
| Findings | **Dismiss** action (immediate `PATCH dismissed`). **Save Changes** sends `accepted` instead of `resolved`. | `review.store.ts`, `finding-card.ts` |
| Reload | Open review mirrored to `/workspace?review=<id>`; a reload restores the snapshot and its text. | `workspace/document.page.ts` |
| History | Paginated (Previous/Next), status badge and finding total. | `content-review/review-history.page.ts` |
| Limits | Code-point counting in the editor and validation; `maxChars` 50 000. | `workspace/document.service.ts`, `review.store.ts` |
| Register | `EMAIL_ALREADY_REGISTERED`; `displayName` errors land on "Full name"; 72-byte password cap. | `auth/register.page.ts`, `auth/auth.validators.ts` |
| Config | `review.categories`, `review.pageSize`, `reviewEvents`, `features.guestLogin`; removed `reviewTimeoutMs` (creation is no longer long-running). New `mock` build configuration. | `core/config/app-config.ts`, `src/environments/*`, `angular.json`, `package.json` |
| Mock API | Rewritten to the verified Node contract (CSRF, cookies, envelope, 202 + SSE with replay, `Last-Event-ID`, `204`, code-point offsets, transitions, pagination). Guest and reader are kept as **marked mock-only extensions**. | `mock-server/` |

### Deliberate UI decisions Node should confirm

These keep existing behaviour working without assuming an API that doesn't exist:

1. **Missing `role` means author.** Node lets every account write, so treating users as readers
   would block all functionality. An explicit `role: 'reader'` from a future API still makes the
   UI read-only.
2. **Save Changes → `accepted`.** It is the only user-settable status that means "I took this
   suggestion". Locally the finding is still shown as "Resolved", meaning applied in this session.
3. **All three categories are always sent**, because the UI has no category picker. This matches
   the previous behaviour of reviewing everything.
4. **Failure text comes from `errorCode`, never `errorMessage`.** Node says `errorMessage` is
   user-safe, but the UI's policy is to never show backend text.
5. **CSRF token fetched lazily** before the first write, rather than on app start.

## 3. Known gaps (blocked on Node or out of scope)

| Gap | Impact today | Question |
| --- | --- | --- |
| No roles in Node | The read-only experience is unreachable with Node; it still works with the mock's reader account. | [Q1](#q1) |
| No guest endpoint | "Continue as guest" is hidden in development and production builds; only `npm run dev` (mock) shows it. | [Q2](#q2) |
| Edited text is not persisted | After Save Changes and a reload, the review's **original** snapshot comes back with those findings marked `accepted` (the user can re-apply them). Before, the mock behaved the same, but it was undocumented. | [Q3](#q3) |
| Dismiss is final | No way back to `pending`; a dismissed finding can still be accepted. | [Q4](#q4) |
| 15-minute fixed session | Users are signed out mid-edit; unsaved local changes are lost (the review itself is restored via `?review=`). | [Q5](#q5) |
| History detail | No per-status counts or length per review in the list. | [Q8](#q8) |
| Upload / RAG chat | Not built in the UI; no Node endpoints. A proposal is in [api-contract.md §10.4](api-contract.md#104-document-upload-and-rag-chat--q13). | [Q13](#q13) |
| Delete review | Node supports it; the UI has no delete action yet (UI backlog). | – |

## 4. Questions for the Node.js team

<a id="q1"></a>**Q1. Roles.** Will `User` gain `role: 'author' | 'reader'`, with `403 FORBIDDEN` on
reader writes? If roles are not planned, the UI's reader mode and `authorGuard` should be removed.

<a id="q2"></a>**Q2. Guest access.** Is anonymous or guest review in scope? If so, the proposed
shape is `POST /auth/guest` → `201 { user: { …, guest: true }, csrfToken }` (CSRF-protected,
heavily rate-limited, with the account and its reviews deleted when the session ends). Otherwise
the UI feature stays mock-only or is removed.

<a id="q3"></a>**Q3. Persisting accepted edits.** Nothing in Node ever sets a finding to
`resolved`, and there is no way to store the edited text. Which do you prefer: (a) allow users to
set `resolved` after `accepted`, (b) a content update that re-bases or invalidates findings, or (c)
a separate document resource? Until then Save Changes only records `accepted`.

<a id="q4"></a>**Q4. Undoing a dismissal.** `dismissed → pending` is not allowed. Is that
intended? The UI shows Dismiss as final.

<a id="q5"></a>**Q5. Session lifetime.** `AUTH_TOKEN_TTL` is a fixed 15 minutes with no sliding
renewal and no refresh endpoint. Can Node extend the session on activity, or add a refresh
endpoint? Long editing sessions currently end in a forced sign-in.

<a id="q6"></a>**Q6. `queued` stage.** `ProgressStage` in `review-events.ts` includes `queued`,
but the processor never emits it and the Node docs don't list it. Is it planned? The UI already
handles it.

<a id="q7"></a>**Q7. Contract doc drift.** Node's `docs/api-contract.md` omits `SERVICE_UNAVAILABLE`
(defined in `error-codes.ts`) and the `queued` stage. Please treat the code or this document as
the reference until the Node doc is updated.

<a id="q8"></a>**Q8. Review summaries.** Could `ReviewSummary` include per-status finding counts
(`pending`, `accepted`, `dismissed`, `resolved`) and `contentLength`? The history page used to show
"N need review" from these.

<a id="q9"></a>**Q9. `errorCode` stability.** Is the list of processing `errorCode`s (`LLM_*`,
`PROCESSING_*`) stable? The UI maps each to fixed copy and falls back to a generic message for
unknown codes.

<a id="q10"></a>**Q10. Cancellation.** `cancelled` is reserved. Is a cancel endpoint planned
(for example `POST /reviews/:id/cancel`)? The UI would offer "Stop review" while processing.

<a id="q11"></a>**Q11. Password policy.** Node only enforces 12 chars to 72 bytes; the UI also
requires lower, upper, digit and symbol. Should Node enforce the same rules, or should the UI relax
them? The UI is stricter today, which is safe but inconsistent for API clients.

<a id="q12"></a>**Q12. Rate limits and SSE.** SSE reconnects and snapshot GETs count towards
300 requests per 15 minutes per IP, which is shared by every user behind one NAT. Should
`/events` be exempt or limited per user?

<a id="q13"></a>**Q13. Document upload and chat.** Should Node expose `/documents` and `/chat` in
front of Python's internal endpoints? If yes, please confirm the proposed shapes in
[api-contract.md §10.4](api-contract.md#104-document-upload-and-rag-chat--q13), the upload size
limit, polling versus SSE for ingestion status, how `X-Tenant-ID` maps to users, and whether
`model`/`usage` are passed through.

## 5. Verification performed

- **Unit and component tests:** `npm run test:ci`, 19 files and 215 tests, all passing. New or
  updated coverage includes CSRF bootstrap, header scoping, concurrent sharing and the single
  retry; token rotation on login and refresh after logout; Node DTO mapping and malformed bodies;
  code point → UTF-16 mapping using Node's example table; the 202 + SSE flow with progress,
  de-duplication, failure codes, closed-stream resume, the interrupted state with Resume (no
  duplicate POST), malformed events and stale-stream cancellation; Dismiss and Save (`accepted`);
  reload restore via `?review=`; and the guest flag.
- **Lint and builds:** `npm run lint` is clean, and the `development` and `mock` builds succeed.
- **Real Node, end to end:** the unmodified ContentReviewService (`tsx src/server.ts`,
  `PYTHON_LLM_MODE=mock`, in-memory MongoDB from its own dev dependencies, `FRONTEND_ORIGIN=http://localhost:4200`)
  behind the Angular dev proxy, driven in a browser. Register → `POST /reviews` 202 → SSE 200 →
  snapshot → Dismiss and Save PATCHes 200 → reload restores the review → paginated history →
  logout (204) → login. The guest button is hidden. No unexpected console errors.
- **Mock API, end to end:** the same flow, plus checks with curl: `CSRF_INVALID` without the
  header, strict-body `VALIDATION_FAILED` details, `202` + `Location`, the SSE event sequence,
  `Last-Event-ID` taking precedence over `?lastEventId`, `204` for a finished stream, code-point
  offsets around an emoji, `resolved` rejected, pagination, and the `404` envelope.

**Not verified:** the real Python service and Gemini (Node's mock LLM client was used), production
TLS and cookie settings, cross-site deployment, and Node's rate limiter under real load. An axe
accessibility pass on the new Dismiss button, progress text and pagination is still to be done.

## 6. Running against Node locally

```bash
# ContentReviewService (.env): MONGODB_URI=…, FRONTEND_ORIGIN=http://localhost:4200,
# AUTH_COOKIE_SECURE=false, AUTH_JWT_SECRET/CSRF_SECRET (32+ chars),
# PYTHON_LLM_MODE=mock (or http + PYTHON_LLM_SERVICE_URL/TOKEN for the real Python service)
npm run dev            # in ContentReviewService, port 3000

npm start              # in ContentReviewUI: development configuration, proxies /api → :3000
```

Use `npm run dev` in this repository instead to run against the in-memory mock.
