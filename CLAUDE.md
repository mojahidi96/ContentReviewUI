# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — mock API (http://localhost:3000/api/v1) + Angular dev server (http://localhost:4200, `mock` build configuration, guest login on) together. The dev server proxies `/api` to port 3000 (`proxy.conf.json`), so cookies stay same-origin.
- `npm start` — Angular dev server only, `development` configuration, for the **real Node ContentReviewService** on `localhost:3000` (its `FRONTEND_ORIGIN` must include `http://localhost:4200`). `npm run start:mock` serves the mock configuration.
- `npm run mock-api` — mock API only; runs with `node --watch`, so editing `mock-server/` restarts it and wipes all in-memory users, sessions and reviews.
- `npm run build` / `npx ng build --configuration development`
- `npm run lint` — angular-eslint, including template a11y rules (e.g. click handlers on non-focusable elements fail lint).
- `npm run test:ci` — all Vitest tests once (`npm test` watches).
- Single spec file: `npx ng test --watch=false --include src/app/core/theme/theme.service.spec.ts`
- Single test by name: add `--filter "part of the test name"`.
- `npm run format` — Prettier for `src/**` and `mock-server/**` only (README and `docs/` are not Prettier-formatted).

Demo accounts (seeded in `mock-server/server.mjs`, mock only; real Node has no seeded users): `demo@example.com` / `Demo!Passw0rd2026` (author) and `reader@example.com` / `Reader!Passw0rd2026` (read-only via the mock-only `role` field). Self-registered accounts are authors. "Continue as guest" (`POST /auth/guest`, mock-only) creates a temporary author flagged `guest: true` that is deleted, with its reviews, when the session ends. Mock sessions expire after 15 minutes like Node's; `.env.example` lists knobs such as `MOCK_REVIEW_FAILURE_RATE` and `MOCK_SESSION_TTL_MS`.

## Architecture

Angular 22 SPA (zoneless, standalone, signals) for an AI content-review service: Angular → Node ContentReviewService → Python → Gemini, and the browser only ever calls Node. `docs/api-contract.md` is the contract, verified against the Node source and tagged ✅ verified / 🟡 proposed / ⛔ unavailable. `docs/integration-status.md` lists the gaps and the open questions for Node (Q1–Q13). `mock-server/` mirrors the verified contract in memory, plus clearly marked mock-only extensions (guest, reader role). `docs/architecture.md` has the longer design notes; keep all three docs and the mock in sync when behaviour changes.

- **Wire vs domain types:** Node DTOs (`*Dto` in `auth.models.ts` and `review.models.ts`) are mapped to the UI's domain types in one place: `toUser()` and `review.mappers.ts` (shape-checked; malformed bodies throw `InvalidResponseError` → `invalid_response`). Components never see DTOs.

- **Auth is cookie-based.** The session is Node's HttpOnly `content_review_session` cookie (a JWT the SPA never sees); `AuthService` (`core/auth`) only mirrors "who am I". `provideAppInitializer` calls `restoreSession()` (`GET /auth/me`) before the first navigation, so a 401 on `/auth/me` at startup is expected. **CSRF:** Node's CSRF cookie is HttpOnly, so `CsrfService` fetches the token from `GET /auth/csrf` (lazily, shared between concurrent writes), keeps it in memory, and replaces it with the `csrfToken` from login/register. `csrfInterceptor` sends `X-CSRF-Token` on unsafe API requests and retries once on `403 CSRF_INVALID`. Angular's XSRF support is off (`withNoXsrfProtection`).
- **HTTP pipeline** (`app.config.ts`): `apiInterceptor` adds `withCredentials` and a timeout only to URLs under `APP_CONFIG.apiBaseUrl`, with per-request overrides via the `REQUEST_TIMEOUT_MS` context token. `authErrorInterceptor` turns protected-call 401s into a "session expired" redirect unless the request sets `SKIP_SESSION_EXPIRY`. Order: `authErrorInterceptor`, `csrfInterceptor`, `apiInterceptor`. Errors are normalised by `toApiError()` (Node's `{ code, message, requestId, details[] }` envelope; `body.*` details become `fieldErrors`) and turned into fixed user-facing text by `ErrorHandlingService`; backend messages are never shown.
- **Roles:** `User.role` is `author` or `reader`, and anything other than `author` is read-only (`AuthService.canEdit`). Readers get `ReadOnlyDocument` instead of the editor and findings panel, the side panel hides review tools, and `authorGuard` protects `/workspace/history`. Node sends no role, so `toUser()` maps a missing role to `author`; only the mock's reader account exercises read-only mode. Guards are UX only.
- **Saved documents:** `DocumentService` (`features/workspace`) persists the editor through `DocumentApiService` (`/api/v1/documents`, which needs the ContentReviewService `feature/documents` branch). The content string is sent and stored **unchanged** (never trim or normalise it). It keeps a snapshot of the stored `id`/`version`/`title`/`content`; `origin` is `sample` | `draft` | `saved` | `modified`; `save()` POSTs once and then PUTs with `version`; `409 DOCUMENT_VERSION_CONFLICT` blocks saving until `reloadSaved()`. `DocumentPage` calls `restore()` once per session (`?document=`, or the latest document unless a `?review=` link supplies the text) and mirrors `?document=`. The editor has Save, Ctrl/⌘+S, a conflict alert and a `beforeunload` prompt.
- **Workspace scoping:** `WorkspaceShell` provides `DocumentService` and `ReviewStore` (plain `@Injectable()`, not root), so all document and review state is created on login and discarded on logout or reload. Routes are lazy (`app.routes.ts` → `features/workspace/workspace.routes.ts`).
- **ReviewStore** (`features/content-review/review.store.ts`) is the core logic:
  - Reviews are async: `POST /reviews` → `202` → `ReviewEventsService.follow()` (native `EventSource` with `withCredentials`, de-duplicated by event id, injectable via `EVENT_SOURCE_FACTORY`) → on a terminal event, `GET /reviews/:id` is the authoritative snapshot. A stream that closes early is re-checked via `GET` and re-followed from `lastEventId` (up to `reviewEvents.maxReconnects`), then shown as interrupted, and Retry resumes the same review id. Everything runs through one `switchMap`, so a newer submit or load closes the old stream.
  - The open review id is mirrored to `/workspace?review=<id>` by `DocumentPage`, and a reload restores it (`loadReview(id, { restoreDocument: true })`).
  - Node offsets are code points; `review.mappers.ts` converts them to UTF-16 and drops ranges that don't match `originalText`. Finding ranges in the store are UTF-16 offsets into `_reviewedText`. Content limits count code points.
  - Accepted suggestions are a local `acceptedChanges` list and never call the API on their own.
  - The expected document text is derived as `applyReplacements(reviewedText, accepted)`, and Accept/Undo just edit the list and write that text to `DocumentService`. This is why changes can be undone in any order.
  - Displayed ranges come from `mapRange()`. A finding that overlaps an accepted change loses its range until that change is undone.
  - `isStale` (document ≠ derived text) disables highlights, Accept and Undo.
  - `saveChanges()` PATCHes each accepted finding to `accepted` (Node rejects `resolved`) with `forkJoin`, then commits the derived text as the new reviewed text and shows those findings as "resolved" locally. Node does not store edited text. `dismiss()` PATCHes `dismissed` immediately and is final.
  - `actionsFor(finding)` decides what each card may offer.
- **Text rendering** (`text-ranges.ts`, `highlighted-document.ts`): `buildSegments` splits overlapping ranges into non-overlapping segments whose text concatenates back to the original exactly. The highlighted document renders only through interpolation (never `innerHTML`), on one line of template under `prettier-ignore` because whitespace would leak into the `pre-wrap` output. Inline suggestion chips (`[data-suggestion]`) and struck-through originals (`[data-original]`) are extra DOM that specs strip before comparing text.
- **Theming:** `ThemeService` (`core/theme`) toggles `.dark` on `<html>` and stores the choice per user (`contentReview.theme.user.<id>`) plus a device-level key that an inline script in `src/index.html` reads before first paint. Keep the key names in sync. Tailwind v4 has `@custom-variant dark` keyed to that class. Every colour utility needs a `dark:` counterpart.
- **Design tokens** live in `src/styles.css` `@theme`: `brand-*` (indigo), `focus` (focus ring, lighter in dark mode), and the `action`/`positive`/`negative` solid button fills. These are tuned to the lightest shades that keep white text at 4.5:1, so don't lighten them further. Buttons use the `appButton` directive (`shared/components/button.directive.ts`) with variants.
- **Accessibility is verified with axe** in both themes (CLAUDE.md requires passing AXE and WCAG AA). Absolutely positioned `sr-only` text inside a scroll container needs that container to be `relative`, otherwise it inflates the outer page's scroll height.

## Testing notes

- `src/app/testing/test-providers.ts` has `provideTestHttp(routes?, config?)` (real interceptors plus `HttpTestingController`, and a `FakeEventSource` in place of `EventSource`), `TEST_USER` (author), `TEST_READER`, `toUserDto()`, `makeFinding()`/`makeReview()` (domain) and `makeFindingDto()`/`makeReviewDto()`/`findingToDto()`/`reviewBody()` (Node wire format).
- Specs that need a signed-in user call `signIn(user)`, which answers the CSRF and login requests. Any spec that sends a POST/PATCH/DELETE without signing in must call `flushCsrf(http)` before expecting that request.
- `completeReviewFlow(http, content, findings)` plays a whole review after `ReviewStore.submit()` (CSRF → 202 → `review.completed` event → snapshot). Drive streams manually with `FakeEventSource.latest()` (`open()`, `emit()`, `drop()` for a retryable error, `fail()` for a closed stream). Resume paths wait on a timer, so `await` a macrotask before expecting the snapshot `GET`.
- The test config's `review.maxChars` is 100, so the sample document is too long to submit in tests.

## Coding guidelines

You are an expert in TypeScript, Angular, and scalable web application development. You write functional, maintainable, performant, and accessible code following Angular and TypeScript best practices.

## TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

## Angular Best Practices

- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default in Angular v20+.
- Do NOT set `changeDetection: ChangeDetectionStrategy.OnPush` explicitly. `OnPush` is the default in Angular v22+.
- Use signals for state management
- Implement lazy loading for feature routes
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead
- Use `NgOptimizedImage` for all static images.
  - `NgOptimizedImage` does not work for inline base64 images.

## Accessibility Requirements

- It MUST pass all AXE checks.
- It MUST follow all WCAG AA minimums, including focus management, color contrast, and ARIA attributes.

### Components

- Keep components small and focused on a single responsibility
- Use `input()` and `output()` functions instead of decorators
- Use `model()` for two-way bound properties with `[(prop)]` syntax instead of pairing `input()` with `output()`
- Use `computed()` for derived state
- Use `linkedSignal()` for state derived from multiple reactive sources that must stay synchronized
- Templates longer than 10 lines go in their own file: the component gets a folder named after it (`login.page.ts` → `login-page/`) holding `.ts`, `.html` (`templateUrl`), `.scss` (`styleUrl`) and `.spec.ts`. Shorter templates stay inline (`template`), and so does `highlighted-document`'s one-line template (see Text rendering).
- Prefer Signal Forms (`@angular/forms/signals`) for new forms. They are stable in Angular v22+ and provide signal-based state, type-safe field access, and schema-based validation
- When not using Signal Forms, prefer Reactive forms instead of Template-driven ones
- Do NOT use `ngClass`, use `class` bindings instead
- Do NOT use `ngStyle`, use `style` bindings instead
- Do NOT import `CommonModule`, import only the directives and pipes the template uses, such as `AsyncPipe` or `DatePipe`
- When using external templates/styles, use paths relative to the component TS file.

## State Management

- Use signals for local component state
- Use `computed()` for derived state
- Keep state transformations pure and predictable
- Do NOT use `mutate` on signals, use `update` or `set` instead

## Templates

- Keep templates simple and avoid complex logic
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Use the async pipe to handle observables
- Do not assume globals like (`new Date()`) are available.

## Services

- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Prefer the `@Service` decorator over `@Injectable({providedIn: 'root'})` for new singleton services (Angular v22+)
- Use the `inject()` function instead of constructor injection
