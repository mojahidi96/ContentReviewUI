# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — mock API (http://localhost:3000/api/v1) + Angular dev server (http://localhost:4200) together. The dev server proxies `/api` to the mock (`proxy.conf.json`), so cookies stay same-origin.
- `npm start` — Angular dev server only (expects an API on `localhost:3000`).
- `npm run mock-api` — mock API only; runs with `node --watch`, so editing `mock-server/` restarts it and wipes all in-memory users, sessions and reviews.
- `npm run build` / `npx ng build --configuration development`
- `npm run lint` — angular-eslint, including template a11y rules (e.g. click handlers on non-focusable elements fail lint).
- `npm run test:ci` — all Vitest tests once (`npm test` watches).
- Single spec file: `npx ng test --watch=false --include src/app/core/theme/theme.service.spec.ts`
- Single test by name: add `--filter "part of the test name"`.
- `npm run format` — Prettier for `src/**` and `mock-server/**` only (README and `docs/` are not Prettier-formatted).

Demo accounts (seeded in `mock-server/server.mjs`): `demo@example.com` / `Demo!Passw0rd2026` (author) and `reader@example.com` / `Reader!Passw0rd2026` (read-only). Self-registered accounts are authors. "Continue as guest" (`POST /auth/guest`) creates a temporary author flagged `guest: true` that is deleted, with its reviews, when the session ends. Mock sessions expire after 30 minutes; `.env.example` lists knobs such as `MOCK_REVIEW_FAILURE_RATE` and `MOCK_SESSION_TTL_MS`.

## Architecture

Angular 22 SPA (zoneless, standalone, signals) for an AI content-review service. `docs/api-contract.md` is the backend contract and `mock-server/` implements it in memory. `docs/architecture.md` has the longer design notes; keep both docs in sync when behaviour changes.

- **Auth is cookie-based.** The session is an HttpOnly `sid` cookie; `AuthService` (`core/auth`) only mirrors "who am I" and never stores a token. `provideAppInitializer` calls `restoreSession()` (`GET /auth/me`) before the first navigation, so a 401 on `/auth/me` at startup is expected. CSRF uses the double-submit `XSRF-TOKEN` cookie with Angular's `withXsrfConfiguration`.
- **HTTP pipeline** (`app.config.ts`): `apiInterceptor` adds `withCredentials` and a timeout only to URLs under `APP_CONFIG.apiBaseUrl`, with per-request overrides via the `REQUEST_TIMEOUT_MS` context token. `authErrorInterceptor` turns protected-call 401s into a "session expired" redirect unless the request sets `SKIP_SESSION_EXPIRY`. Errors are normalised by `toApiError()` and turned into user-facing text by `ErrorHandlingService`.
- **Roles:** `User.role` is `author` or `reader`, and anything other than `author` is read-only (`AuthService.canEdit`). Readers get `ReadOnlyDocument` instead of the editor and findings panel, the side panel hides review tools, and `authorGuard` protects `/workspace/history`. The mock API enforces this with `403 FORBIDDEN` on review writes. Guards are UX only.
- **Workspace scoping:** `WorkspaceShell` provides `DocumentService` and `ReviewStore` (plain `@Injectable()`, not root), so all document and review state is created on login and discarded on logout or reload. Routes are lazy (`app.routes.ts` → `features/workspace/workspace.routes.ts`).
- **ReviewStore** (`features/content-review/review.store.ts`) is the core logic:
  - Finding ranges are UTF-16 offsets into `_reviewedText`.
  - Accepted suggestions are a local `acceptedChanges` list and never call the API on their own.
  - The expected document text is derived as `applyReplacements(reviewedText, accepted)`, and Accept/Undo just edit the list and write that text to `DocumentService`. This is why changes can be undone in any order.
  - Displayed ranges come from `mapRange()`. A finding that overlaps an accepted change loses its range until that change is undone.
  - `isStale` (document ≠ derived text) disables highlights, Accept and Undo.
  - `saveChanges()` is the only write: it PATCHes each accepted finding to `resolved` with `forkJoin`, then commits the derived text as the new reviewed text.
  - `actionsFor(finding)` decides what each card may offer.
- **Text rendering** (`text-ranges.ts`, `highlighted-document.ts`): `buildSegments` splits overlapping ranges into non-overlapping segments whose text concatenates back to the original exactly. The highlighted document renders only through interpolation (never `innerHTML`), on one line of template under `prettier-ignore` because whitespace would leak into the `pre-wrap` output. Inline suggestion chips (`[data-suggestion]`) and struck-through originals (`[data-original]`) are extra DOM that specs strip before comparing text.
- **Theming:** `ThemeService` (`core/theme`) toggles `.dark` on `<html>` and stores the choice per user (`contentReview.theme.user.<id>`) plus a device-level key that an inline script in `src/index.html` reads before first paint. Keep the key names in sync. Tailwind v4 has `@custom-variant dark` keyed to that class. Every colour utility needs a `dark:` counterpart.
- **Design tokens** live in `src/styles.css` `@theme`: `brand-*` (indigo), `focus` (focus ring, lighter in dark mode), and the `action`/`positive`/`negative` solid button fills. These are tuned to the lightest shades that keep white text at 4.5:1, so don't lighten them further. Buttons use the `appButton` directive (`shared/components/button.directive.ts`) with variants.
- **Accessibility is verified with axe** in both themes (CLAUDE.md requires passing AXE and WCAG AA). Absolutely positioned `sr-only` text inside a scroll container needs that container to be `relative`, otherwise it inflates the outer page's scroll height.

## Testing notes

- `src/app/testing/test-providers.ts` has `provideTestHttp()` (real interceptors plus `HttpTestingController`), `TEST_USER` (author), `TEST_READER`, `makeFinding()` and `makeReview()`.
- Specs that need a signed-in user call `AuthService.login()` and flush `/api/v1/auth/login` with the fixture user.
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
- Prefer inline templates for small components
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
