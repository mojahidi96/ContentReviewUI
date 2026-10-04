/**
 * Development-only mock of the Node.js ContentReviewService (public API v1).
 *
 * Mirrors the *verified* contract in docs/api-contract.md (taken from the ContentReviewService
 * source) with in-memory storage, so the Angular app can be run and demoed from a clean clone
 * without MongoDB, Node or Python. NOT for production use.
 *
 * Mock-only extensions (NOT in the real Node service; see docs/integration-status.md):
 *   - POST /auth/guest              temporary guest author
 *   - User.role ("reader")          the seeded read-only account
 *   - User.guest
 *
 * Environment variables:
 *   PORT                       (default 3000)
 *   HOST                       interface to bind (default localhost, so the mock and its public
 *                              demo accounts are not reachable from the network)
 *   MOCK_LATENCY_MS            base latency for every response (default 300)
 *   MOCK_REVIEW_LATENCY_MS     simulated analysis time per review (default 1200)
 *   MOCK_REVIEW_FAILURE_RATE   0..1 probability that a review ends in review.failed (default 0)
 *   MOCK_SESSION_TTL_MS        session lifetime (default 15 minutes, like AUTH_TOKEN_TTL)
 *   COOKIE_SECURE              "true" to mark cookies Secure (default false, like Node in dev)
 */
import cookieParser from 'cookie-parser';
import express from 'express';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { analyze } from './review-rules.mjs';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? 'localhost';
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS ?? 300);
const REVIEW_LATENCY_MS = Number(process.env.MOCK_REVIEW_LATENCY_MS ?? 1200);
const FAILURE_RATE = Number(process.env.MOCK_REVIEW_FAILURE_RATE ?? 0);
const SESSION_TTL_MS = Number(process.env.MOCK_SESSION_TTL_MS ?? 15 * 60 * 1000);
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const MAX_CONTENT_CODE_POINTS = 50_000;
const SESSION_COOKIE = 'content_review_session';
const ANON_COOKIE = `${SESSION_COOKIE}_anon`;
const CSRF_HEADER = 'x-csrf-token';
const CATEGORIES = ['grammar', 'spelling', 'profanity'];
const REVIEW_STATUSES = ['pending', 'processing', 'completed', 'failed', 'cancelled'];
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const FINDING_TRANSITIONS = {
  pending: ['accepted', 'dismissed'],
  accepted: ['dismissed'],
  dismissed: ['accepted'],
  resolved: [],
};
const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEARTBEAT_MS = 15_000;
const SSE_RETRY_MS = 3_000;

// ---------------------------------------------------------------- storage
/** @type {Map<string, any>} keyed by lower-case email */
const usersByEmail = new Map();
/** Guest accounts (mock-only), keyed by id. Deleted with their reviews when the session ends. */
const guestUsers = new Map();
/** @type {Map<string, {userId:string, expiresAt:number}>} */
const sessions = new Map();
/** CSRF token per identity (`session:<sid>` or `anon:<id>`). */
const csrfTokens = new Map();
/** @type {Map<string, any>} */
const reviews = new Map();
/** Persisted events per review: [{ id, type, data }], ids strictly increasing. */
const reviewEvents = new Map();
/** Live SSE listeners per review. */
const listeners = new Map();

const hex24 = () => randomBytes(12).toString('hex');
const nowIso = () => new Date().toISOString();

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

function verifyPassword(password, user) {
  return timingSafeEqual(scryptSync(password, user.salt, 64), Buffer.from(user.hash, 'hex'));
}

/** Compared against when the email is unknown, so response time doesn't reveal which emails exist. */
const DUMMY_CREDENTIALS = hashPassword(randomBytes(16).toString('hex'));

function addUser(displayName, email, password, role) {
  const user = {
    id: hex24(),
    displayName,
    email: email.toLowerCase(),
    createdAt: nowIso(),
    ...(role ? { role } : {}),
    ...hashPassword(password),
  };
  usersByEmail.set(user.email, user);
  return user;
}

addUser('Demo Reviewer', 'demo@example.com', 'Demo!Passw0rd2026');
// `role: 'reader'` is a mock-only extension; Node has no roles.
addUser('Riley Reader', 'reader@example.com', 'Reader!Passw0rd2026', 'reader');

const publicUser = ({ id, email, displayName, createdAt, role, guest }) => ({
  id,
  email,
  displayName,
  createdAt,
  ...(role ? { role } : {}),
  ...(guest ? { guest: true } : {}),
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (req, res, status, code, message, details) =>
  res.status(status).json({
    error: { code, message, requestId: req.requestId, ...(details ? { details } : {}) },
  });

// ---------------------------------------------------------------- app
const app = express();
app.disable('x-powered-by');
app.disable('etag');
app.use((req, res, next) => {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.set('X-Request-Id', req.requestId);
  next();
});
app.use('/api', express.json({ limit: '512kb', strict: true }));
app.use('/api', cookieParser());
app.use(async (_req, _res, next) => {
  await sleep(LATENCY_MS);
  next();
});

const cookieOptions = (maxAge) => ({
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: 'lax',
  path: '/api',
  ...(maxAge ? { maxAge } : {}),
});

/** Resolves the session cookie into req.auth; invalid or expired cookies are ignored. */
app.use('/api', (req, res, next) => {
  const sid = req.cookies[SESSION_COOKIE];
  const session = sid && sessions.get(sid);
  if (session && session.expiresAt > Date.now()) {
    const user =
      guestUsers.get(session.userId) ??
      [...usersByEmail.values()].find((u) => u.id === session.userId);
    if (user) req.auth = { sid, user };
  } else if (sid) {
    endSession(sid);
    res.clearCookie(SESSION_COOKIE, cookieOptions());
  }
  next();
});

function identity(req) {
  if (req.auth) return `session:${req.auth.sid}`;
  const anon = req.cookies[ANON_COOKIE];
  return anon ? `anon:${anon}` : null;
}

/** Issues (or re-uses) the CSRF token for the caller; creates an anonymous id if needed. */
function issueCsrfToken(req, res, rotate = false) {
  let id = identity(req);
  if (!id) {
    const anon = randomBytes(24).toString('hex');
    res.cookie(ANON_COOKIE, anon, cookieOptions(24 * 60 * 60 * 1000));
    req.cookies[ANON_COOKIE] = anon;
    id = `anon:${anon}`;
  }
  if (rotate || !csrfTokens.has(id)) csrfTokens.set(id, randomBytes(32).toString('hex'));
  return csrfTokens.get(id);
}

function csrfProtect(req, res, next) {
  const id = identity(req);
  const expected = id && csrfTokens.get(id);
  if (!expected || req.get(CSRF_HEADER) !== expected) {
    return fail(req, res, 403, 'CSRF_INVALID', 'The CSRF token is missing or invalid.');
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.auth) return fail(req, res, 401, 'AUTH_REQUIRED', 'Authentication required.');
  next();
}

function startSession(req, res, user) {
  const sid = randomBytes(32).toString('hex');
  sessions.set(sid, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
  res.cookie(SESSION_COOKIE, sid, cookieOptions(SESSION_TTL_MS));
  res.clearCookie(ANON_COOKIE, cookieOptions());
  req.auth = { sid, user };
  return issueCsrfToken(req, res, true);
}

/** Ends a session; a guest's account and reviews go with it. */
function endSession(sid) {
  const session = sessions.get(sid);
  sessions.delete(sid);
  csrfTokens.delete(`session:${sid}`);
  if (session && guestUsers.delete(session.userId)) {
    for (const [id, review] of reviews) {
      if (review.ownerId === session.userId) deleteReview(id);
    }
  }
}

const validation = (req, res, details) =>
  fail(req, res, 400, 'VALIDATION_FAILED', 'The request is invalid.', details);

/** Rejects unknown body keys, like Node's strict Zod schemas. */
function unknownKeys(body, allowed) {
  return Object.keys(body ?? {})
    .filter((k) => !allowed.includes(k))
    .map((k) => ({ path: `body.${k}`, message: `Unrecognized key: "${k}"` }));
}

const api = express.Router();

// ---------------------------------------------------------------- auth
api.get('/auth/csrf', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ csrfToken: issueCsrfToken(req, res) });
});

api.post('/auth/register', csrfProtect, (req, res) => {
  const { email, password, displayName } = req.body ?? {};
  const details = unknownKeys(req.body, ['email', 'password', 'displayName']);
  if (typeof email !== 'string' || email.length > 254 || !EMAIL_RULE.test(email.trim()))
    details.push({ path: 'body.email', message: 'Must be a valid email address' });
  if (typeof password !== 'string' || password.length < 12)
    details.push({ path: 'body.password', message: 'Password must be at least 12 characters' });
  else if (Buffer.byteLength(password, 'utf8') > 72)
    details.push({ path: 'body.password', message: 'Password must be at most 72 bytes' });
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 100)
    details.push({ path: 'body.displayName', message: 'Display name is required' });
  if (details.length) return validation(req, res, details);
  if (usersByEmail.has(email.trim().toLowerCase()))
    return fail(
      req,
      res,
      409,
      'EMAIL_ALREADY_REGISTERED',
      'An account with this email already exists.',
    );
  const user = addUser(displayName.trim(), email.trim(), password);
  const csrfToken = startSession(req, res, user);
  res
    .status(201)
    .set('Cache-Control', 'no-store')
    .json({ user: publicUser(user), csrfToken });
});

api.post('/auth/login', csrfProtect, (req, res) => {
  const { email, password } = req.body ?? {};
  const user = typeof email === 'string' ? usersByEmail.get(email.trim().toLowerCase()) : undefined;
  const passwordOk =
    typeof password === 'string' && verifyPassword(password, user ?? DUMMY_CREDENTIALS);
  if (!user || !passwordOk) {
    return fail(req, res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
  const csrfToken = startSession(req, res, user);
  res.set('Cache-Control', 'no-store').json({ user: publicUser(user), csrfToken });
});

/** MOCK-ONLY: starts a session for a new temporary guest author. Not in the Node service. */
api.post('/auth/guest', csrfProtect, (req, res) => {
  const user = {
    id: hex24(),
    displayName: 'Guest User',
    email: '',
    createdAt: nowIso(),
    guest: true,
  };
  guestUsers.set(user.id, user);
  const csrfToken = startSession(req, res, user);
  res
    .status(201)
    .set('Cache-Control', 'no-store')
    .json({ user: publicUser(user), csrfToken });
});

api.post('/auth/logout', requireAuth, csrfProtect, (req, res) => {
  endSession(req.auth.sid);
  res.clearCookie(SESSION_COOKIE, cookieOptions());
  res.status(204).end();
});

api.get('/auth/me', requireAuth, (req, res) =>
  res.set('Cache-Control', 'no-store').json({ user: publicUser(req.auth.user) }),
);

// ---------------------------------------------------------------- reviews
const summary = (r) => ({
  reviewId: r.reviewId,
  documentTitle: r.documentTitle,
  status: r.status,
  categories: r.categories,
  findingCount: r.findingCount,
  errorCode: r.errorCode,
  errorMessage: r.errorMessage,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  completedAt: r.completedAt,
});
const eventsUrl = (id) => `/api/v1/reviews/${id}/events`;
const full = (r) => ({
  ...summary(r),
  content: r.content,
  contentLength: r.contentLength,
  findings: r.findings,
  eventsUrl: eventsUrl(r.reviewId),
});

function emit(review, type, data) {
  const log = reviewEvents.get(review.reviewId);
  if (!log) return; // deleted
  const event = {
    id: log.length + 1,
    type,
    data: { reviewId: review.reviewId, ...data, occurredAt: nowIso() },
  };
  log.push(event);
  for (const listener of listeners.get(review.reviewId) ?? []) listener(event);
}

function setStatus(review, status, extra = {}) {
  Object.assign(review, { status, updatedAt: nowIso() }, extra);
}

/** Simulates the job worker: queued → analyzing → validating → persisting → findings → completed. */
async function processReview(review) {
  await sleep(150);
  if (!reviews.has(review.reviewId)) return;
  setStatus(review, 'processing');
  emit(review, 'review.started', { status: 'processing' });
  emit(review, 'review.progress', { stage: 'analyzing', attempt: 1 });
  await sleep(REVIEW_LATENCY_MS);
  if (!reviews.has(review.reviewId)) return;
  if (Math.random() < FAILURE_RATE) {
    const errorCode = 'LLM_SERVICE_UNAVAILABLE';
    const errorMessage = 'The analysis service is temporarily unavailable.';
    setStatus(review, 'failed', { errorCode, errorMessage });
    emit(review, 'review.failed', { status: 'failed', errorCode, errorMessage });
    return;
  }
  emit(review, 'review.progress', { stage: 'validating', attempt: 1 });
  const findings = analyze(review.content, review.categories, () => `fnd_${hex24()}`);
  emit(review, 'review.progress', { stage: 'persisting', attempt: 1 });
  const completedAt = nowIso();
  setStatus(review, 'completed', { findings, findingCount: findings.length, completedAt });
  for (const finding of findings) emit(review, 'finding.detected', { finding });
  emit(review, 'review.completed', {
    status: 'completed',
    findingCount: findings.length,
    completedAt,
  });
}

function deleteReview(id) {
  reviews.delete(id);
  reviewEvents.delete(id);
  for (const listener of listeners.get(id) ?? []) listener(null);
  listeners.delete(id);
}

const isReviewId = (id) => /^[a-f0-9]{24}$/.test(id);

/** Same 404 for "missing" and "not yours", so review ids don't leak. */
function ownedReview(req, res) {
  if (!isReviewId(req.params.reviewId)) {
    validation(req, res, [{ path: 'params.reviewId', message: 'Invalid review id' }]);
    return null;
  }
  const review = reviews.get(req.params.reviewId);
  if (!review || review.ownerId !== req.auth.user.id) {
    fail(req, res, 404, 'REVIEW_NOT_FOUND', 'Review not found.');
    return null;
  }
  return review;
}

api.use('/reviews', requireAuth);

api.post('/reviews', csrfProtect, (req, res) => {
  const { documentTitle, content, categories } = req.body ?? {};
  const details = unknownKeys(req.body, ['documentTitle', 'content', 'categories']);
  if (
    typeof documentTitle !== 'string' ||
    !documentTitle.trim() ||
    documentTitle.trim().length > 200
  )
    details.push({ path: 'body.documentTitle', message: 'Document title is required' });
  if (typeof content !== 'string' || !content.trim())
    details.push({ path: 'body.content', message: 'Content must not be empty' });
  else if (!content.isWellFormed())
    details.push({
      path: 'body.content',
      message: 'Content contains invalid Unicode (lone surrogates)',
    });
  else if (Array.from(content).length > MAX_CONTENT_CODE_POINTS)
    details.push({
      path: 'body.content',
      message: `Content must be at most ${MAX_CONTENT_CODE_POINTS} characters`,
    });
  if (
    !Array.isArray(categories) ||
    categories.length === 0 ||
    !categories.every((c) => CATEGORIES.includes(c)) ||
    new Set(categories).size !== categories.length
  )
    details.push({ path: 'body.categories', message: 'At least one unique category is required' });
  if (details.length) return validation(req, res, details);

  const createdAt = nowIso();
  const review = {
    reviewId: hex24(),
    ownerId: req.auth.user.id,
    documentTitle: documentTitle.trim(),
    status: 'pending',
    categories,
    findingCount: 0,
    errorCode: null,
    errorMessage: null,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    content,
    contentLength: Array.from(content).length,
    contentHash: createHash('sha256').update(content).digest('hex'),
    findings: [],
  };
  reviews.set(review.reviewId, review);
  reviewEvents.set(review.reviewId, []);
  void processReview(review);
  res
    .status(202)
    .location(`/api/v1/reviews/${review.reviewId}`)
    .json({
      reviewId: review.reviewId,
      status: 'pending',
      eventsUrl: eventsUrl(review.reviewId),
      createdAt,
    });
});

api.get('/reviews', (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const { status } = req.query;
  const details = [];
  if (!Number.isInteger(page) || page < 1)
    details.push({ path: 'query.page', message: 'Invalid page' });
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    details.push({ path: 'query.limit', message: 'Invalid limit' });
  if (status !== undefined && !REVIEW_STATUSES.includes(status))
    details.push({ path: 'query.status', message: 'Invalid status' });
  if (details.length) return validation(req, res, details);
  const all = [...reviews.values()]
    .filter((r) => r.ownerId === req.auth.user.id && (!status || r.status === status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.set('Cache-Control', 'no-store').json({
    items: all.slice((page - 1) * limit, page * limit).map(summary),
    page,
    limit,
    total: all.length,
    totalPages: Math.ceil(all.length / limit),
  });
});

api.get('/reviews/:reviewId', (req, res) => {
  const review = ownedReview(req, res);
  if (review) res.set('Cache-Control', 'no-store').json({ review: full(review) });
});

api.get('/reviews/:reviewId/events', (req, res) => {
  const review = ownedReview(req, res);
  if (!review) return;
  const header = req.get('last-event-id');
  let lastSeq =
    header && /^\d{1,15}$/.test(header.trim())
      ? Number(header.trim())
      : Number(req.query.lastEventId ?? 0) || 0;
  const log = reviewEvents.get(review.reviewId) ?? [];
  const pending = log.filter((e) => e.id > lastSeq);
  if (TERMINAL.has(review.status) && pending.length === 0) {
    // Nothing left to deliver: 204 tells EventSource to stop reconnecting.
    return res.status(204).end();
  }

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`retry: ${SSE_RETRY_MS}\n\n`);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    listeners.get(review.reviewId)?.delete(write);
    res.end();
  };
  const write = (event) => {
    if (closed) return;
    if (event === null) return close(); // review deleted
    if (event.id <= lastSeq) return;
    res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    lastSeq = event.id;
    if (event.type === 'review.completed' || event.type === 'review.failed') close();
  };
  const heartbeat = setInterval(() => !closed && res.write(': heartbeat\n\n'), HEARTBEAT_MS);
  if (!listeners.has(review.reviewId)) listeners.set(review.reviewId, new Set());
  listeners.get(review.reviewId).add(write);
  req.on('close', close);
  for (const event of pending) write(event);
});

api.patch('/reviews/:reviewId/findings/:findingId', csrfProtect, (req, res) => {
  const review = ownedReview(req, res);
  if (!review) return;
  const { status } = req.body ?? {};
  const details = unknownKeys(req.body, ['status']);
  if (!/^fnd_[a-f0-9]{24}$/.test(req.params.findingId))
    details.push({ path: 'params.findingId', message: 'Invalid finding id' });
  if (status !== 'accepted' && status !== 'dismissed')
    details.push({
      path: 'body.status',
      message: 'Invalid option: expected "accepted" | "dismissed"',
    });
  if (details.length) return validation(req, res, details);
  if (review.status !== 'completed')
    return fail(req, res, 409, 'REVIEW_NOT_COMPLETED', 'The review has not completed yet.');
  const finding = review.findings.find((f) => f.findingId === req.params.findingId);
  if (!finding) return fail(req, res, 404, 'FINDING_NOT_FOUND', 'Finding not found.');
  if (finding.status !== status) {
    if (!FINDING_TRANSITIONS[finding.status].includes(status)) {
      return fail(
        req,
        res,
        409,
        'INVALID_STATE_TRANSITION',
        `Cannot change a finding from "${finding.status}" to "${status}".`,
      );
    }
    finding.status = status;
    finding.updatedAt = nowIso();
  }
  res.json({ finding });
});

api.delete('/reviews/:reviewId', csrfProtect, (req, res) => {
  const review = ownedReview(req, res);
  if (!review) return;
  deleteReview(review.reviewId);
  res.status(204).end();
});

app.use('/api/v1', api);
app.use((req, res) => fail(req, res, 404, 'NOT_FOUND', 'Unknown endpoint.'));
app.use((err, req, res, _next) => {
  if (err?.type === 'entity.too.large')
    return fail(req, res, 413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
  if (err?.type === 'entity.parse.failed')
    return fail(req, res, 400, 'MALFORMED_JSON', 'The request body is not valid JSON.');
  console.error(err);
  fail(req, res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
});

app.listen(PORT, HOST, () => {
  console.log(`Mock ContentReviewService (Node contract v1) on http://${HOST}:${PORT}/api/v1`);
  console.log('Demo author:      demo@example.com / Demo!Passw0rd2026');
  console.log('Demo read-only:   reader@example.com / Reader!Passw0rd2026 (mock-only role)');
  console.log('Guest:            "Continue as guest" (mock-only endpoint)');
});
