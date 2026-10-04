# Architecture

## Overview

```
Browser (Angular SPA) ──HTTPS, same site──► Node ContentReviewService ──► Python LLM service
        │                                   (auth, sessions, CSRF,          (never called from
        │                                    persistence, orchestration)      the browser)
        └── dev: Angular dev-server proxy ► mock-server/server.mjs
```

The SPA is a thin client. It holds UI state only, and every security decision (authentication, authorization, input limits) is enforced by the Node service.

## Source layout

```
src/app
├── core/                    Singletons used across features
│   ├── auth/                AuthService (signals), models, safe returnUrl helper
│   ├── config/              APP_CONFIG injection token (built from src/environments)
│   ├── guards/              authGuard, guestGuard, authorGuard (functional)
│   ├── http/                ApiError normalisation, ErrorHandlingService, HttpContext tokens
│   ├── interceptors/        apiInterceptor (credentials + timeout), authErrorInterceptor (401)
│   ├── layout/              ViewportService (breakpoint signal)
│   └── notifications/       NotificationService (toast queue)
├── features/
│   ├── auth/                Login and register pages, validators, password input
│   ├── workspace/           Shell, header, side panel, DocumentService, editor, sample doc
│   └── content-review/      API client, ReviewStore, findings UI, highlighting, history
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
| Document title and content | `DocumentService` | Provided by `WorkspaceShell` |
| Review, findings, filters, view mode | `ReviewStore` | Provided by `WorkspaceShell` |
| Sidebar collapsed / drawer open | `WorkspaceShell` | Component |

`DocumentService` and `ReviewStore` are provided by the workspace shell component, not in root. When the user logs out the shell is destroyed, so document and review data cannot leak into the next session in the same tab.

### Review request flow

```
submit() ─► validate (non-empty, ≤ maxChars) ─► requests$.next(api.createReview(...))
                                                   │
                         switchMap ◄───────────────┘  (a newer request cancels an older one)
                             │
                ok ─► showReview()   error ─► fail()  →  user-facing message + Retry
```

- `submit()` reads `DocumentService.content()` at call time, so the request always carries the text currently in the editor.
- Submitting a review and opening one from history go through the same `switchMap` stream. Whichever the user asked for last wins, and a late response from an earlier request is discarded.
- Retry calls `submit()` again. The editor content is never cleared or modified when a request fails.

### Findings and offsets

- Ranges are UTF-16 offsets into the **reviewed text**, the text the findings were computed for.
- Accepted suggestions are a local list (`ReviewStore.acceptedChanges`), never sent to the API on their own. The **baseline** is derived: `applyReplacements(reviewedText, accepted)`. Accept and Undo just add or remove a list entry and write the new baseline to the document, so changes can be undone in any order and Undo always restores the exact original text.
- Displayed finding ranges are derived with `mapRange()`: later findings shift by the length difference of earlier accepted changes, accepted findings point at their improved text, and a finding that overlaps an accepted change loses its location (and cannot be accepted) until that change is undone.
- `isStale = baseline !== document.content()`. When the document is stale, highlights, Accept and Undo are turned off, so a range is never applied to the wrong text. The user can re-run the review or restore the reviewed text (with accepted changes still applied).
- `buildSegments()` validates ranges, widens any range that would split a surrogate pair, and splits overlapping or nested ranges into non-overlapping segments. Joining every segment's text gives back the original exactly, and the unit tests check this.
- **Save Changes** is the only write: after confirmation it PATCHes every accepted finding to `resolved` in parallel. On success the baseline becomes the new reviewed text and the list is cleared, so saved changes can no longer be undone. On failure nothing is committed locally and the user can retry.

## Security model

| Concern | Approach |
| --- | --- |
| Session | Backend-managed `HttpOnly; Secure; SameSite=Strict` cookie. The SPA stores no token in JS or in localStorage. |
| CSRF | Double-submit `XSRF-TOKEN` cookie and `X-XSRF-TOKEN` header, using Angular's built-in support (`withXsrfConfiguration`). It only works same-site, which is why the API base URL is relative. |
| Credential scope | `withCredentials` is added only for URLs under `apiBaseUrl`, so third-party requests never carry cookies. |
| Unauthorized | A 401 from a protected endpoint clears local auth state and redirects to `/login?reason=session-expired&returnUrl=…`. Login and the `/me` probe opt out of this through an `HttpContext` token. |
| Open redirect | `safeReturnUrl()` only accepts in-app absolute paths. |
| XSS | Document text is rendered only through interpolation. There is no `innerHTML` or `bypassSecurityTrust*`. A test renders HTML-like content to prove it stays text. |
| Error leakage | Backend messages are never displayed. Error codes map to fixed UI copy. |
| Guards | Route guards are a UX convenience. The backend authorizes every request. |
| Roles | `User.role` is `author` or `reader`; anything but `author` is treated as read-only (`AuthService.canEdit`). Readers get a read-only document view, no review tools, and `authorGuard` keeps them off authoring routes. The API returns `403 FORBIDDEN` for reader writes. |
| Secrets | There are none in the frontend. The environment files hold only public configuration. |

## Accessibility

- Every form control has a label. Errors are linked with `aria-describedby`, inputs get `aria-invalid`, focus moves to the first invalid field on submit, and server errors use `role="alert"`.
- The sidebar toggle uses `aria-expanded` and `aria-controls`. The mobile drawer is `inert` while closed, moves focus into itself when opened, closes on Escape and returns focus to the menu button.
- Category, severity and status are always shown as text with an icon, never as colour alone. Highlights also use a distinct underline style per category.
- Live regions announce review progress and the result count, and toasts use polite regions (assertive for errors).
- The confirm dialogs use the native `<dialog>` element, which provides a focus trap and Escape handling.
- Smooth scrolling and spinners respect `prefers-reduced-motion`.
- The project lint config includes `templateAccessibility`.
