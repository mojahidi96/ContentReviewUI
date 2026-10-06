# Architecture

## Overview

```
Browser (Angular SPA) ──HTTPS, same origin──► Node ContentReviewService ──► Python ContentReviewOpenAI ──► Gemini
        │        JSON + SSE (/api/v1)          (auth, sessions, CSRF,          (never called from
        │                                       persistence, job queue)          the browser)
        └── dev: Angular dev-server proxy ► real Node on :3000 (`npm start`)
                                            or mock-server/server.mjs (`npm run dev`)
```

The SPA is a thin client. It holds UI state only, and every security decision (authentication, authorization, input limits) is enforced by the Node service. The contract is in [api-contract.md](api-contract.md); what differs from the UI's earlier assumptions and what is still open is in [integration-status.md](integration-status.md).

## Source layout

```
src/app
├── core/                    Singletons used across features
│   ├── auth/                AuthService (signals), CsrfService, models + Node DTOs, safe returnUrl helper
│   ├── config/              APP_CONFIG injection token (built from src/environments)
│   ├── guards/              authGuard, guestGuard, authorGuard (functional)
│   ├── http/                ApiError normalisation, ErrorHandlingService, HttpContext tokens
│   ├── interceptors/        apiInterceptor (credentials + timeout), csrfInterceptor (X-CSRF-Token), authErrorInterceptor (401)
│   ├── layout/              ViewportService (breakpoint signal)
│   └── notifications/       NotificationService (toast queue)
├── features/
│   ├── auth/                Login and register pages, validators, password input
│   ├── workspace/           Shell, header, side panel, DocumentService, editor, sample doc
│   └── content-review/      API client + mappers, SSE client, ReviewStore, findings UI, highlighting, history
├── shared/
│   ├── components/          Button directive, badge, form field, dialog, spinner, toasts, empty state
│   └── models/              API error envelope
└── testing/                 Test-only providers and fixtures
```

Every route except the shell is lazy-loaded: `login`, `register`, the workspace shell, the document page and the history page each get their own chunk.

## State management

There is no state library. Signals hold the state and RxJS handles async work.

| State | Owner | Scope |
| --- | --- | --- |
| Current user and auth status | `AuthService` | Root singleton |
| Toasts | `NotificationService` | Root singleton |
| Document title and content, saved id/version, save state | `DocumentService` | Provided by `WorkspaceShell` |
| Review, findings, filters, view mode | `ReviewStore` | Provided by `WorkspaceShell` |
| Sidebar collapsed / drawer open | `WorkspaceShell` | Component |

`DocumentService` and `ReviewStore` are provided by the workspace shell component, not in root. When the user logs out the shell is destroyed, so document and review data cannot leak into the next session in the same tab.

### Review request flow

Reviews are asynchronous in Node: `POST /reviews` returns `202` immediately and the analysis runs in a job.

```
submit() ─► validate (non-empty, ≤ maxChars code points)
        ─► POST /reviews (202 { reviewId }) ─► follow GET /reviews/:id/events (EventSource)
              review.started / review.progress / finding.detected  → progress label, live count
              review.completed | review.failed                       → close stream
        ─► GET /reviews/:id (authoritative snapshot) ─► showReview() or fail(errorCode)

stream closed early ─► wait ─► GET snapshot ─► terminal? show it : re-follow from lastEventId
                                               (up to maxReconnects, then "interrupted" + Resume)
```

- `submit()` reads `DocumentService.content()` at call time, so the request always carries the text currently in the editor.
- Submitting a review and opening one (from history or `?review=` after a reload) go through the same `switchMap` stream. Whichever the user asked for last wins: the earlier flow is unsubscribed, which also closes its `EventSource`, so a late event or response can never overwrite a newer review.
- Retry after a failed submission calls `submit()` again. Retry after an interrupted stream (**Resume review**) reloads the same review id instead, so no duplicate review is created. The editor content is never cleared or modified when a request fails.
- `ReviewEventsService` wraps `EventSource` in an Observable: events are de-duplicated by their increasing `id`, a `CONNECTING` error is left to the browser's own reconnect (with `Last-Event-ID`), and a `CLOSED` error (`204`, `401`, `404`, `5xx`) surfaces as `ReviewStreamClosedError` so the store can re-check the snapshot. `EventSource` is injected through `EVENT_SOURCE_FACTORY`, so tests use a fake.

### Findings and offsets

- Node sends **code point** offsets. `review.mappers.ts` converts them once to UTF-16 ranges and drops any range whose slice is not exactly `originalText`. Everything below works in UTF-16.
- Ranges are UTF-16 offsets into the **reviewed text**, the text the findings were computed for.
- Accepted suggestions are a local list (`ReviewStore.acceptedChanges`), never sent to the API on their own. The **baseline** is derived: `applyReplacements(reviewedText, accepted)`. Accept and Undo just add or remove a list entry and write the new baseline to the document, so changes can be undone in any order and Undo always restores the exact original text.
- Displayed finding ranges are derived with `mapRange()`: later findings shift by the length difference of earlier accepted changes, accepted findings point at their improved text, and a finding that overlaps an accepted change loses its location (and cannot be accepted) until that change is undone.
- `isStale = baseline !== document.content()`. When the document is stale, highlights, Accept and Undo are turned off, so a range is never applied to the wrong text. The user can re-run the review or restore the reviewed text (with accepted changes still applied).
- `buildSegments()` validates ranges, widens any range that would split a surrogate pair, and splits overlapping or nested ranges into non-overlapping segments. Joining every segment's text gives back the original exactly, and the unit tests check this.
- **Save Changes**: after confirmation it PATCHes every accepted finding to `accepted` in parallel (Node reserves `resolved` for itself). On success the baseline becomes the new reviewed text, the findings are shown as "Resolved" locally, and the list is cleared, so saved changes can no longer be undone. On failure nothing is committed locally and the user can retry. Node does not store the edited text (see integration-status Q3).
- **Dismiss** PATCHes `dismissed` immediately. It is only offered for pending findings that are not locally accepted, and it is final because Node has no transition back to `pending`.

### Saving documents

`DocumentService` owns the open document and its persistence through `DocumentApiService`
(`/api/v1/documents`):

- It keeps a snapshot (`id`, `version`, `title`, `content`) of what Node has stored. `origin` is
  derived from it: `sample`, `draft` (never saved), `saved` (matches the snapshot) or `modified`.
- `save()` sends the editor string **unchanged**. It `POST`s the first time and `PUT`s with the
  snapshot `version` after that. The snapshot is replaced by the server's reply, so text typed
  while a save is in flight stays "modified".
- `409 DOCUMENT_VERSION_CONFLICT` sets `hasConflict`, which blocks Save; `reloadSaved()` loads the
  stored copy. `404 DOCUMENT_NOT_FOUND` drops the snapshot, so the next Save creates a new document.
- `restore()` runs once per workspace session. `DocumentPage` calls it with `?document=`, or asks
  for the latest document when no `?review=` link supplies the text. While it loads, the editor is
  read-only.
- `DocumentPage` mirrors `documentId` into `?document=`, but leaves the parameter alone while a load
  is in flight.

## Security model

| Concern | Approach |
| --- | --- |
| Session | Node's `content_review_session` cookie: an HttpOnly signed JWT, `SameSite=Lax`, `Path=/api`, `Secure` in production, 15 minutes. The SPA never sees the JWT and stores nothing auth-related in Web Storage. |
| CSRF | Node's signed double-submit token. The CSRF cookie is HttpOnly, so `CsrfService` gets the token from `GET /auth/csrf` (or the login/register response), keeps it in memory, and `csrfInterceptor` sends it as `X-CSRF-Token` on unsafe API requests. It is retried once after `403 CSRF_INVALID`. Angular's cookie-based XSRF is disabled (`withNoXsrfProtection`). |
| SSE | Same-origin `EventSource` with `withCredentials`; the session cookie authenticates it. No token or secret ever goes in the URL. |
| Credential scope | `withCredentials` is added only for URLs under `apiBaseUrl`, so third-party requests never carry cookies. |
| Unauthorized | A 401 from a protected endpoint clears local auth state and redirects to `/login?reason=session-expired&returnUrl=…`. Login and the `/me` probe opt out of this through an `HttpContext` token. |
| Open redirect | `safeReturnUrl()` only accepts in-app absolute paths. |
| XSS | Document text is rendered only through interpolation. There is no `innerHTML` or `bypassSecurityTrust*`. A test renders HTML-like content to prove it stays text. |
| Error leakage | Backend messages are never displayed. Error codes map to fixed UI copy. |
| Guards | Route guards are a UX convenience. The backend authorizes every request. |
| Roles | `User.role` is `author` or `reader`; anything but `author` is treated as read-only (`AuthService.canEdit`). Readers get a read-only document view, no review tools, and `authorGuard` keeps them off authoring routes. **Node sends no role**, so its users map to `author`; only the mock's reader account exercises read-only mode (integration-status Q1). |
| Guests | **Mock-only.** "Continue as guest" calls `POST /auth/guest`, which issues a normal session for a temporary author flagged `guest: true` that is deleted with its reviews when the session ends. Node has no such endpoint, so the button is behind `features.guestLogin`, which is on only in the `mock` configuration (integration-status Q2). |
| Secrets | There are none in the frontend. The environment files hold only public configuration. |

## Accessibility

- Every form control has a label. Errors are linked with `aria-describedby`, inputs get `aria-invalid`, focus moves to the first invalid field on submit, and server errors use `role="alert"`.
- The sidebar toggle uses `aria-expanded` and `aria-controls`. The mobile drawer is `inert` while closed, moves focus into itself when opened, closes on Escape and returns focus to the menu button.
- Category, severity and status are always shown as text with an icon, never as colour alone. Highlights also use a distinct underline style per category.
- Live regions announce review progress and the result count, and toasts use polite regions (assertive for errors).
- The confirm dialogs use the native `<dialog>` element, which provides a focus trap and Escape handling.
- Smooth scrolling and spinners respect `prefers-reduced-motion`.
- The project lint config includes `templateAccessibility`.
