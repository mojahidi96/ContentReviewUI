# 03 · Refresh token and sliding session

**Status:** Needs backend. The UI and the mock API already implement it.
**Why:** the session cookie is a 15-minute JWT with no renewal, so a user who is actively working
gets "Your session has expired" every 15 minutes. With a refresh token the session renews silently
while the user is active, and only ends after **2 days without use**.
**UI:** `AuthService.refreshSession()`, `authErrorInterceptor` (on a protected `401`: refresh once,
repeat the request, otherwise "session expired"), and `restoreSession()` (falls back to a refresh
when `/auth/me` is `401`, e.g. the user returns the next day).
**Mock:** `mock-server/server.mjs` (`POST /auth/refresh`, `MOCK_REFRESH_IDLE_TTL_MS`).
**Contract:** [`api-contract.md` → Refresh token](../api-contract.md).

## Prompt

````markdown
# Task: add a rotating, sliding refresh token to ContentReviewService

Today a login creates one session cookie (`content_review_session`, a JWT valid `AUTH_TOKEN_TTL`,
15 minutes) that is never renewed. Add a refresh token so a user who keeps using the app is never
signed out, while someone idle for 2 days must sign in again. The Angular SPA already calls the
endpoint below; keep the contract exactly.

## Cookies

- **Session cookie** (unchanged): `content_review_session`, HttpOnly JWT, `AUTH_TOKEN_TTL` (15 min).
- **Refresh cookie** (new): `content_review_refresh`, an opaque 256-bit random token, HttpOnly,
  `Secure` in production, `SameSite=Lax`, **`Path=/api/v1/auth`** (so it is only sent to auth
  routes), `Max-Age` = the idle TTL.
- Store only a hash (SHA-256) of the token in MongoDB (`refresh_tokens`): `tokenHash`, `userId`,
  `chainId`, `chainStartedAt`, `createdAt`, `lastUsedAt`, `expiresAt`, `usedAt?`, `userAgent?`.
  TTL index on `expiresAt`.

## Lifetime (the important rule)

- **Idle expiry, sliding: 2 days** (`AUTH_REFRESH_IDLE_TTL_SECONDS`, default 172800). Every successful
  refresh issues a *new* token with `expiresAt = now + idle TTL`. Because the session cookie lasts
  15 minutes, an active user refreshes at least that often, so the refresh token never gets close to
  expiring; a user who does not use the app for 2 days finds the refresh token expired and signs in.
- **Absolute cap** (`AUTH_REFRESH_ABSOLUTE_TTL_SECONDS`, default 2592000 = 30 days): a chain of
  refreshes never lives longer than this from the original login (`expiresAt = min(now + idle,
  chainStartedAt + absolute)`). Set it to 0 to disable the cap.

## Endpoint

`POST /api/v1/auth/refresh` — no body, no session required.

- Reads `content_review_refresh`. **CSRF:** the session may already be gone, so a session-bound
  CSRF token cannot be used. The SPA first calls `GET /auth/csrf` (anonymous identity, same as before
  login) and sends that token as `X-CSRF-Token`; accept an anonymous-identity token on this route
  (and a session-bound one if a valid session happens to exist).
- Success: `200 { user, csrfToken }`, identical in shape to `POST /auth/login`. Sets a **new session
  cookie**, a **new refresh cookie** (rotation) and returns a `csrfToken` bound to the new session.
  `Cache-Control: no-store`.
- Failure: `401 REFRESH_INVALID` when the cookie is missing, unknown, expired, revoked or reused;
  also clear the refresh cookie. `403 CSRF_INVALID` and `429 RATE_LIMITED` behave as elsewhere. Use
  the same message for every 401 cause.

## Rotation and theft detection

- Every refresh invalidates the presented token (`usedAt = now`) and issues its successor in the same
  `chainId`.
- If a token that was already used is presented again, treat it as theft: revoke the whole chain
  (delete every token with that `chainId`) and answer `401 REFRESH_INVALID`.
- **Grace window:** two tabs can send the same cookie at the same moment. Within 10 seconds
  (`AUTH_REFRESH_REUSE_GRACE_SECONDS`) of `usedAt`, a repeated token is *not* theft: answer it like a
  normal refresh (issue a fresh successor in the same chain).

## Where tokens are created and revoked

- Create a new chain (new `chainId`, new refresh cookie) on `POST /auth/login`, `/auth/register`,
  `/auth/otp/login` and `/auth/password/reset` (prompt 01).
- `POST /auth/logout`: revoke the caller's chain and clear **both** cookies.
- `POST /auth/password/reset` (and any future password change): revoke **all** chains of the user.
- Guest or temporary accounts (mock only) get no refresh token.
- `GET /auth/me` is unchanged: it still returns `401` when the session cookie has expired; the SPA
  then calls `/auth/refresh`.

## Security and operations

- Never log tokens or hashes; log request id, user id and outcome (`refreshed`, `reused`, `expired`).
- Rate-limit `/auth/refresh` per IP (it counts towards the auth limiter or gets its own, generous
  enough for several tabs).
- Config: add `AUTH_REFRESH_IDLE_TTL_SECONDS`, `AUTH_REFRESH_ABSOLUTE_TTL_SECONDS`,
  `AUTH_REFRESH_REUSE_GRACE_SECONDS` to `.env.example` and config validation.
- CORS/origin checks are unchanged: the cookie is first-party (same origin behind the reverse proxy).

## Tests

Cover: login sets both cookies with the right attributes and path; refresh rotates and returns a
working session; the old token fails after the grace window and revokes the chain; reuse inside the
grace window succeeds; idle expiry after 2 days (fake clock) → `REFRESH_INVALID`; sliding extension
after a refresh; absolute cap; logout revokes and clears both cookies; password reset revokes all
chains; missing/invalid CSRF → 403; guest has none; no token or hash in logs.

## Docs and deliverables

Update the repo's API docs/OpenAPI with `POST /auth/refresh` and `REFRESH_INVALID`. Deliver
implementation, tests, docs and `.env.example` on a new branch, plus a short summary of the storage
and revocation design. Don't change the behaviour of existing endpoints beyond setting the new cookie.
````
