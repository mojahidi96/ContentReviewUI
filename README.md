# ContentReview UI

An Angular 22 frontend for an AI-powered content review platform. Users sign in, edit a document, send it to the review service, and work through the findings for spelling, grammar and inappropriate language. Each finding can be inspected in context, and its AI suggestion accepted (applied to the text) or undone before the changes are saved.

![Workspace with review findings](docs/screenshots/workspace-findings.png)

| Sign in | Review history | Mobile |
| --- | --- | --- |
| ![Login](docs/screenshots/login.png) | ![History](docs/screenshots/review-history.png) | ![Mobile](docs/screenshots/mobile.png) |

## Highlights

- **Angular 22, idiomatic:** standalone components, zoneless change detection, OnPush by default, signals for state, RxJS for HTTP, functional guards and interceptors, `@Service`, lazy-loaded routes, and typed Reactive Forms.
- **Real review workflow:** the review sends the text that is in the editor when you click. Reviews run asynchronously in the Node service, and the UI follows their progress over Server-Sent Events, resumes dropped streams without resubmitting, and restores the open review after a reload. It handles loading, progress, empty, validation, failure and interrupted states, keeps the document intact on errors, and supports retry. Stale streams and responses are cancelled.
- **Safe highlighting:** overlapping and nested finding ranges are split into non-overlapping segments, rendered with interpolation only (never `innerHTML`), and turned off automatically when the text no longer matches the review.
- **You stay in control:** AI suggestions are clearly labelled and are only applied after explicit confirmation. Later highlights are re-based after each edit.
- **Security-aware:** HttpOnly session cookie, Node's signed CSRF token kept in memory and sent as `X-CSRF-Token`, credentials sent only to the API, a central 401 handler, open-redirect protection, and no tokens or secrets in the browser. The browser only talks to Node, never to Python or the LLM.
- **Accessible:** labelled controls, linked error messages, focus management, a keyboard-operable drawer and dialogs, live regions, no colour-only meaning, and the Angular ESLint accessibility rules.
- **Tested:** 215 unit and component tests (Vitest) against a mocked backend, covering validation, guards, interceptors and CSRF, response mapping and offsets, the SSE review flow, highlighting edge cases and the interactive UI. Also run end to end against the real Node service.

## Tech stack

| | |
| --- | --- |
| Framework | Angular 22 (standalone, zoneless), TypeScript 6 in strict mode with strict templates |
| Styling | Tailwind CSS 4 with design tokens in `src/styles.css` |
| Icons | Font Awesome (solid set, imported per icon so it tree-shakes) |
| Forms | Typed Reactive Forms |
| Testing | Vitest via `@angular/build:unit-test`, jsdom, `HttpTestingController` |
| Linting | ESLint 10 with `angular-eslint`, including template accessibility rules; Prettier |
| Backend | Node ContentReviewService (contract: [docs/api-contract.md](docs/api-contract.md)); an in-memory Express mock of it in `mock-server/` for development |

## Getting started

### Prerequisites

- Node.js **22.12+** (developed on Node 24)
- npm 10+

### Install and run

```bash
npm install
npm run dev
```

`npm run dev` starts:

- the **mock API** on http://localhost:3000/api/v1, an in-memory copy of the Node contract
- the **Angular dev server** on http://localhost:4200 (`mock` configuration), which proxies `/api` to the mock, so cookies stay same-origin

To use the **real Node ContentReviewService** instead, start it on port 3000 with
`FRONTEND_ORIGIN=http://localhost:4200` and `AUTH_COOKIE_SECURE=false`, then run `npm start`. See
[docs/integration-status.md](docs/integration-status.md#6-running-against-node-locally).

Open http://localhost:4200 and sign in with a demo account (mock only):

| Email | Password | Role |
| --- | --- | --- |
| `demo@example.com` | `Demo!Passw0rd2026` | **Author**: edits the document, runs reviews, accepts and saves changes |
| `reader@example.com` | `Reader!Passw0rd2026` | **Read only**: sees the document text only |

You can also register a new account (new accounts are authors), or click **Continue as guest** to start a temporary author session with no credentials; the guest account and its reviews are deleted when you sign out or the session expires. Guest sign-in and the read-only role are **mock-only**: the Node service has neither yet, so the guest button is hidden in the `development` and production builds. The mock keeps data in memory, so a restart clears registered users, sessions and reviews.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Mock API and Angular dev server (`mock` configuration) together |
| `npm start` | Angular dev server only, for the real Node service on `localhost:3000` |
| `npm run start:mock` | Angular dev server only, `mock` configuration |
| `npm run mock-api` | Mock API only |
| `npm run build` | Production build to `dist/content-review-ui` |
| `npm test` | Unit tests in watch mode |
| `npm run test:ci` | Unit tests, single run |
| `npm run lint` | ESLint (TypeScript and templates) |
| `npm run format` | Prettier |

## Configuration

The frontend has **no secrets**. Its public configuration lives in `src/environments/`:

```ts
// src/environments/environment.ts (production). environment.development.ts is used by `ng serve`,
// environment.mock.ts by `npm run dev`.
export const environment: AppConfig = {
  production: true,
  apiBaseUrl: '/api/v1',           // the only backend URL: Node. Keep it same-origin (reverse proxy).
  requestTimeoutMs: 15_000,        // not applied to the SSE stream
  review: {
    maxChars: 50_000,              // code points; must match Node's REVIEW_MAX_CONTENT_CHARS
    categories: ['grammar', 'spelling', 'profanity'],
    pageSize: 20,
  },
  reviewEvents: { maxReconnects: 5, reconnectDelayMs: 3_000 },
  features: { guestLogin: false }, // only the mock implements POST /auth/guest
};
```

In production, serve the SPA and the API from the same origin, for example behind a reverse proxy that routes `/api` to the Node service with response buffering disabled for `text/event-stream`. In development, `proxy.conf.json` forwards `/api` to port 3000. There is no Python URL or LLM key anywhere in the frontend.

The mock API reads an optional `.env` file. Copy `.env.example` to `.env` to change its settings:

| Variable | Default | Use |
| --- | --- | --- |
| `MOCK_REVIEW_FAILURE_RATE` | `0` | Set to `1` to make reviews end in `review.failed` (demo the failure and retry UI) |
| `MOCK_SESSION_TTL_MS` | 15 min | Shorten to demo session-expiry handling |
| `MOCK_LATENCY_MS` / `MOCK_REVIEW_LATENCY_MS` | `300` / `1200` | Simulated request latency / analysis time |

## Demo walkthrough

1. **Auth:** visit `/workspace` while signed out and you are redirected to `/login?returnUrl=…`. Try submitting an empty form, a malformed email, a wrong password, or registering with `demo@example.com` (duplicate email).
2. **Workspace:** the sample Q3 report is labelled **Sample document · not saved**. Edit it and click **Save** (or press Ctrl/⌘+S): the text is stored in Node exactly as written, including indentation, tabs, blank lines and trailing spaces. The badge then shows **Saved**, and **Unsaved changes** after further edits. The URL gains `?document=<id>`, a reload reopens it, and after signing in your most recent document opens automatically. If the same document is saved from another tab first, you're asked to load the latest version instead of overwriting it.
3. **Side panel:** collapse it to an icon rail with the control at the bottom; the setting is remembered. Below 1024 px it becomes a drawer, which opens from the ☰ button and closes with Escape or the backdrop.
4. **Review:** click **Content Review**. While the review runs, the panel shows the stage reported by the server ("Checking spelling, grammar and language…", "Saving results…") and a live finding count, and the URL gains `?review=<id>`. The findings then appear as expanded cards showing the **Original** text, the **Improved** AI suggestion and an **Explanation**, and the document switches to **Review highlights**. Collapse cards individually from their header or with **Collapse all / Expand all**.
5. **Inspect:** click a card's body to scroll to and highlight just that issue, with its suggestion in green beside it. **Show all issues** highlights every issue at once. Filter findings by category or status.
6. **Act:** **Accept** applies the suggestion to the text immediately, without confirmation or an API call; **Undo** puts the original back. Accepted changes are kept locally for the session. **Save Changes** (enabled once something is accepted) asks for confirmation, then marks those findings `accepted` on the API and shows them as resolved; saved changes can't be undone. **Dismiss** marks a finding dismissed on the server straight away. Reload the page: the review comes back from the server.
7. **Stale protection:** edit the text after a review. Highlights turn off and the panel offers to re-run the review or restore the reviewed text.
8. **Failures:** run with `MOCK_REVIEW_FAILURE_RATE=1 npm run dev`. The review fails with a clear message, the document is unchanged, and **Retry review** is available. If the event stream can't be re-established, the panel offers **Resume review**, which picks up the same review instead of submitting a new one.
9. **Roles (mock only):** sign in as `reader@example.com`. The header shows **Read only**, the document is plain read-only text, and the review action, findings and Review history are not available (visiting `/workspace/history` redirects back). Node has no roles yet (see integration-status Q1).
10. **Session expiry:** restart the mock API while signed in, then act on a finding. You are sent to sign in with a "session expired" notice and returned to where you were afterwards.
11. **History:** **Review history** lists previous reviews, 20 per page, with their status. Open one to load its findings.

## Architecture

```
src/app
├── core/          auth service, config token, guards, interceptors, error mapping, notifications
├── features/
│   ├── auth/            login, registration, validators
│   ├── workspace/       shell, header, side panel, document state, editor
│   └── content-review/  API client, ReviewStore, findings UI, highlighting, history
├── shared/        reusable UI (button, badge, form field, dialog, spinner, toasts, empty state)
└── testing/       test providers and fixtures
```

- **State:** signals in small services. `AuthService` is a root singleton. `DocumentService` and `ReviewStore` are provided by the workspace shell, so all document and review state is discarded on logout.
- **HTTP:** a typed API client per feature, with Node's wire format mapped to UI types at the boundary. `apiInterceptor` adds credentials and timeouts for API URLs only, `csrfInterceptor` adds `X-CSRF-Token` to writes, and `authErrorInterceptor` handles 401s centrally. Errors are normalised into a typed `ApiError` and mapped to fixed user-facing copy.
- **Review flow:** submit → `202` → Server-Sent Events → snapshot, all through one `switchMap` stream, so the most recent request wins and old streams are closed. Code-point offsets are converted to UTF-16 once, the findings' baseline text is tracked to detect stale highlights, and ranges are re-based after suggestions are applied.

More detail is in [docs/architecture.md](docs/architecture.md), including the security model and accessibility notes. The backend contract (verified against the Node source) is in [docs/api-contract.md](docs/api-contract.md), and [docs/integration-status.md](docs/integration-status.md) tracks the gaps and open questions for the Node team.

## Security notes

- The session is Node's **HttpOnly** JWT cookie (`SameSite=Lax`, `Secure` in production). No token is ever readable by JavaScript or stored in Web Storage.
- **CSRF** uses Node's signed double-submit token: fetched from `GET /auth/csrf`, kept in memory, sent as `X-CSRF-Token` on every write including login, and refreshed and retried once on `403 CSRF_INVALID`.
- The SSE stream is authenticated by the same cookie; no secret is ever put in a URL.
- Route guards only improve the UX. **The backend authorizes every request**, and reviews are scoped to their owner.
- The Angular app never calls the Python LLM service. Only the Node service does.
- Document content is never rendered as HTML.
- Hiding controls for read-only users is only a convenience; the backend must enforce roles (Node has none yet).
- The **mock API is for local development only**. It binds to `localhost` by default because its demo credentials are public, and it compares passwords in constant time for unknown emails too, so login timing doesn't reveal which accounts exist. It has no rate limiting or security headers; the real backend must provide login rate limiting, a Content-Security-Policy (allowing the small inline theme script in `src/index.html` by hash, plus Google Fonts) and the usual hardening headers.

## Testing

```bash
npm run test:ci
```

The suite is 19 files and 215 tests, all running against `HttpTestingController`, a fake `EventSource`, or pure functions. No live API or LLM is needed. It covers:

- Login and registration validation, loading, duplicate-submit prevention, and server error mapping
- `AuthService` state and roles, Node user mapping, the auth/guest/author guards, `withCredentials` scoping, CSRF (bootstrap, scoping, sharing, rotation, single retry), 401 handling and timeouts
- `ContentReviewApiService` and the mappers: Node request and response shapes, code-point → UTF-16 offsets (Node's example table), malformed responses, pagination
- `ReviewStore`: current-content submission, validation, 202 + SSE progress, event de-duplication, failure codes, closed-stream resume, interrupted reviews resumed without resubmitting, stale-stream cancellation, accepting and undoing suggestions in any order, overlap blocking, dismissing, saving accepted changes, and restoring after a reload
- `buildSegments`, `applyReplacements` and `mapRange` edge cases: overlap, nesting, duplicates, out-of-bounds input, surrogate pairs, empty documents and whitespace
- Components: rendered text matches the source exactly and HTML is never interpreted, the side panel collapses, the drawer handles Escape and returns focus, the finding card accordion and Accept/Undo, and the confirmation before saving changes

## Not in v1

- A list of saved documents. Save, reopen-latest and `?document=` links work, but there is no page to browse older documents yet. Saving needs ContentReviewService's `feature/documents` branch.
- Document upload and RAG chat. Neither the UI nor Node has them yet; a proposed contract is in [docs/api-contract.md §10.4](docs/api-contract.md#104-document-upload-and-rag-chat--q13).
- Deleting reviews and choosing review categories. Node supports both; the UI does not offer them yet.
- End-to-end browser tests. The flows above were verified manually with Playwright, and a Playwright suite would be the next addition.
