# 01 · Emailed 4-digit code: sign-in and password reset

**Status:** Needs backend. The UI and the mock API already implement it.
**UI:** `features/auth/otp-page/`, `AuthService.requestOtp / loginWithOtp / resetPassword`.
**Contract:** [`api-contract.md` → Emailed codes](../api-contract.md).

## Prompt

````markdown
# Task: add emailed 4-digit code sign-in and forgot-password to ContentReviewService

You are working in the Node.js ContentReviewService (Express, MongoDB, cookie-session JWT, CSRF, Zod
schemas). The Angular SPA already ships the UI for this and talks only to Node. Implement the four
endpoints below so the existing UI works unchanged. Read the existing `/auth/register`,
`/auth/login`, `/auth/logout` and `/auth/csrf` code first and match its conventions exactly:
router layout, Zod strict schemas, error envelope `{ error: { code, message, requestId, details[] } }`,
CSRF middleware, cookie options, rate limiter, logging, and tests.

## Endpoints (all under `/api/v1`, all require CSRF like the other unsafe auth routes, none require a session)

| Method | Path | Body (strict, unknown keys → 400) | Success |
|---|---|---|---|
| POST | `/auth/otp/request` | `{ email }` | `202 { "expiresInSeconds": 300 }` |
| POST | `/auth/password/forgot` | `{ email }` | `202 { "expiresInSeconds": 300 }` |
| POST | `/auth/otp/login` | `{ email, otp }` | `200 { user, csrfToken }` + session cookie |
| POST | `/auth/password/reset` | `{ email, otp, newPassword }` | `200 { user, csrfToken }` + session cookie |

- `otp` is a string matching `^\d{4}$`. `email` uses the same validation as register (max 254).
- `newPassword` uses the same rules as register's `password` (12 characters minimum, 72 UTF-8 bytes
  maximum). Validation failures return `400 VALIDATION_FAILED` with `details` paths like `body.otp` and
  `body.newPassword`.
- `otp/login` and `password/reset` responses are identical in shape to `POST /auth/login`: same user
  DTO, same session cookie (`content_review_session`), same CSRF token rotation (`csrfToken` bound to
  the new session), `Cache-Control: no-store`. They also set the refresh cookie when prompt 03 is
  implemented.
- Both request endpoints must **always return the same `202`** for any well-formed email, whether or not
  the account exists, and with similar response time (do the email send asynchronously, after
  responding). This prevents account enumeration.

## Behaviour

- Generate the code with `crypto.randomInt(0, 10000)`, zero-padded to 4 digits.
- Store it **hashed** (HMAC-SHA256 with a server secret, or similar) in a MongoDB collection, with:
  `userId`, `purpose` (`login` | `reset`), `codeHash`, `expiresAt`, `attempts`, `createdAt`. Add a TTL
  index on `expiresAt`. Keep only one active code per `(userId, purpose)`: a new request replaces the
  old one. Purposes are independent: a login code cannot be used to reset a password, and vice versa.
- TTL is 5 minutes (`OTP_TTL_SECONDS`, default 300). Codes are single-use: delete on successful use.
- Verification: compare in constant time. Max 5 failed attempts per code (`OTP_MAX_ATTEMPTS`); after
  that, delete the code. Wrong, expired, missing or unknown-email cases all return the same
  `401 OTP_INVALID` ("The code is invalid or has expired.") so nothing leaks. An exhausted code
  returns `429 RATE_LIMITED`. Always do a dummy comparison for unknown emails to keep timing similar.
- `password/reset`: on a valid code, hash the new password with the existing bcrypt path, update the
  user, and **revoke every other session and refresh token for that user**. Then start a new session
  exactly as login does.
- A verified code proves email ownership. Don't add any other side effects.
- Rate limits, in addition to the global auth limiter (20 per 15 min per IP): code requests are limited
  per email (for example 3 per 15 min) and per IP; verify endpoints are limited per IP. Exceeding a
  limit returns `429 RATE_LIMITED` with `Retry-After`. Don't reveal account existence via limit
  behaviour (apply the per-email limit whether or not the account exists).
- Never log codes, code hashes or passwords. Log only request ids and outcome.

## Email delivery

- Add a small `EmailService` interface (`sendOtp({ to, code, purpose, expiresInMinutes })`) with
  two implementations chosen by env: an SMTP one (nodemailer; `SMTP_URL`, `MAIL_FROM`) and a
  console/log one for local dev (`MAIL_TRANSPORT=console`) that prints the code to stdout, in dev only.
  Refuse to start with the console transport when `NODE_ENV=production`.
- Subject and body: plain text and simple HTML, "Your ContentReview code is 0420. It expires in 5
  minutes. If you didn't request it, ignore this email." Use different wording for sign-in versus
  password reset. Don't include links.
- Email send failures must not change the HTTP response (still `202`); log the error and don't retry
  inline.

## Config

Add to `.env.example` and the config validation: `OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS`,
`OTP_HMAC_SECRET` (required in production), `MAIL_TRANSPORT`, `SMTP_URL`, `MAIL_FROM`.

## Tests

Cover: success paths for both flows; the same `202` for unknown and known emails; wrong code
increments attempts and the 6th attempt is blocked; expired code; reuse of a consumed code; a login
code rejected for reset and vice versa; a new request invalidates the previous code; reset changes the
password (old fails, new works) and revokes other sessions; strict-schema 400s; missing CSRF → 403;
per-email rate limit; no secrets in logs.

## Docs

Update the repo's API docs/OpenAPI with the four endpoints and the error codes `OTP_INVALID` and
`RATE_LIMITED`.

## Deliverables

Implementation, tests, docs and `.env.example` changes on a new branch, with a short summary of design
choices (hashing, session revocation mechanism, rate-limit values). Don't change existing endpoint
behaviour. Ask before adding any new dependency other than nodemailer.
````
