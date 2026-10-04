/**
 * Development-only mock of the Node.js ContentReviewService.
 *
 * Implements docs/api-contract.md with in-memory storage so the Angular app can be run and
 * demoed from a clean clone. NOT for production use.
 *
 * Environment variables:
 *   PORT                       (default 3000)
 *   HOST                       interface to bind (default localhost, so the mock and its public
 *                              demo accounts are not reachable from the network)
 *   MOCK_LATENCY_MS            base latency for every response (default 300)
 *   MOCK_REVIEW_LATENCY_MS     extra latency for review creation (default 1200)
 *   MOCK_REVIEW_FAILURE_RATE   0..1 probability that POST /reviews returns 503 (default 0)
 *   MOCK_SESSION_TTL_MS        session lifetime (default 30 minutes)
 *   COOKIE_SECURE              set to "false" only if your browser rejects Secure cookies on http://localhost
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
const SESSION_TTL_MS = Number(process.env.MOCK_SESSION_TTL_MS ?? 30 * 60 * 1000);
const COOKIE_SECURE = process.env.COOKIE_SECURE !== 'false';
const MAX_CONTENT_CHARS = 20_000;
const SESSION_COOKIE = 'sid';
const XSRF_COOKIE = 'XSRF-TOKEN';
const XSRF_HEADER = 'x-xsrf-token';
const FINDING_STATUSES = new Set(['pending', 'accepted', 'dismissed', 'resolved']);
const PASSWORD_RULES = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{12,128}$/;
const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------- storage
/** @type {Map<string, {id:string, fullName:string, email:string, role:'author'|'reader', salt:string, hash:string}>} */
const usersByEmail = new Map();
/**
 * Temporary guest accounts, keyed by id. They have no credentials and are deleted together with
 * their reviews when the guest signs out or the session expires.
 * @type {Map<string, {id:string, fullName:string, email:string, role:'author', guest:true}>}
 */
const guestUsers = new Map();
/** @type {Map<string, {userId:string, expiresAt:number}>} */
const sessions = new Map();
/** @type {Map<string, any>} */
const reviews = new Map();

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

function verifyPassword(password, user) {
  const candidate = scryptSync(password, user.salt, 64);
  return timingSafeEqual(candidate, Buffer.from(user.hash, 'hex'));
}

/** Compared against when the email is unknown, so response time doesn't reveal which emails exist. */
const DUMMY_CREDENTIALS = hashPassword(randomBytes(16).toString('hex'));

/**
 * Roles: an `author` can edit content and run/act on reviews; a `reader` only gets read-only
 * access. Self-registered accounts are authors so the demo stays usable.
 */
function addUser(fullName, email, password, role = 'author') {
  const user = {
    id: `usr_${randomUUID()}`,
    fullName,
    email: email.toLowerCase(),
    role,
    ...hashPassword(password),
  };
  usersByEmail.set(user.email, user);
  return user;
}

addUser('Demo Reviewer', 'demo@example.com', 'Demo!Passw0rd2026', 'author');
addUser('Riley Reader', 'reader@example.com', 'Reader!Passw0rd2026', 'reader');

const publicUser = ({ id, fullName, email, role, guest }) => ({
  id,
  fullName,
  email,
  role,
  ...(guest ? { guest: true } : {}),
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (res, status, code, message, fieldErrors) =>
  res.status(status).json({ error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } });

// ---------------------------------------------------------------- app
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(async (_req, _res, next) => {
  await sleep(LATENCY_MS);
  next();
});

// CSRF: double-submit cookie. Every response guarantees an XSRF-TOKEN cookie exists; every
// state-changing request must echo it in the X-XSRF-TOKEN header (Angular does this automatically).
app.use((req, res, next) => {
  let token = req.cookies[XSRF_COOKIE];
  if (!token) {
    token = randomBytes(32).toString('hex');
    res.cookie(XSRF_COOKIE, token, { sameSite: 'strict', secure: COOKIE_SECURE, path: '/' });
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const header = req.get(XSRF_HEADER);
    if (!header || !req.cookies[XSRF_COOKIE] || header !== req.cookies[XSRF_COOKIE]) {
      return fail(res, 403, 'CSRF_TOKEN_INVALID', 'Missing or invalid CSRF token.');
    }
  }
  next();
});

function startSession(res, user) {
  const sid = randomBytes(32).toString('hex');
  sessions.set(sid, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'strict',
    path: '/api',
    maxAge: SESSION_TTL_MS,
  });
}

/** Ends a session; a guest's account and reviews go with it. */
function endSession(sid) {
  const session = sessions.get(sid);
  sessions.delete(sid);
  if (session && guestUsers.delete(session.userId)) {
    for (const [id, review] of reviews) {
      if (review.ownerId === session.userId) reviews.delete(id);
    }
  }
}

function currentUser(req) {
  const sid = req.cookies[SESSION_COOKIE];
  const session = sid && sessions.get(sid);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    endSession(sid);
    return null;
  }
  return (
    guestUsers.get(session.userId) ??
    [...usersByEmail.values()].find((u) => u.id === session.userId) ??
    null
  );
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'UNAUTHENTICATED', 'Authentication required.');
  req.user = user;
  next();
}

/** Only authors may create reviews or change findings. Must run after `requireAuth`. */
function requireAuthor(req, res, next) {
  if (req.user.role !== 'author') {
    return fail(res, 403, 'FORBIDDEN', 'Only authors can review or change content.');
  }
  next();
}

const api = express.Router();

// ---------------------------------------------------------------- auth
api.post('/auth/register', (req, res) => {
  const { fullName, email, password } = req.body ?? {};
  const fieldErrors = {};
  if (typeof fullName !== 'string' || fullName.trim().length < 2)
    fieldErrors.fullName = 'Full name is required.';
  if (typeof email !== 'string' || !EMAIL_RULE.test(email))
    fieldErrors.email = 'A valid email is required.';
  if (typeof password !== 'string' || !PASSWORD_RULES.test(password))
    fieldErrors.password = 'Password does not meet the requirements.';
  if (Object.keys(fieldErrors).length)
    return fail(res, 422, 'VALIDATION_FAILED', 'Invalid registration.', fieldErrors);
  if (usersByEmail.has(email.toLowerCase()))
    return fail(res, 409, 'EMAIL_TAKEN', 'An account with this email already exists.');
  const user = addUser(fullName.trim(), email, password);
  startSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});

api.post('/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  const user = typeof email === 'string' ? usersByEmail.get(email.toLowerCase()) : undefined;
  const passwordOk =
    typeof password === 'string' && verifyPassword(password, user ?? DUMMY_CREDENTIALS);
  if (!user || !passwordOk) {
    return fail(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
  startSession(res, user);
  res.json({ user: publicUser(user) });
});

/** Starts a session for a new temporary guest author. No credentials are needed. */
api.post('/auth/guest', (_req, res) => {
  const user = {
    id: `usr_guest_${randomUUID()}`,
    fullName: 'Guest User',
    email: '',
    role: 'author',
    guest: true,
  };
  guestUsers.set(user.id, user);
  startSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});

api.post('/auth/logout', (req, res) => {
  endSession(req.cookies[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE, { path: '/api' });
  res.status(204).end();
});

api.get('/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

// ---------------------------------------------------------------- reviews
const summarize = (review) => ({
  id: review.id,
  title: review.title,
  createdAt: review.createdAt,
  status: review.status,
  contentLength: review.contentLength,
  findingCounts: review.findings.reduce(
    (acc, f) => ({ ...acc, total: acc.total + 1, [f.status]: (acc[f.status] ?? 0) + 1 }),
    { total: 0, pending: 0, accepted: 0, dismissed: 0, resolved: 0 },
  ),
});

api.post('/reviews', requireAuth, requireAuthor, async (req, res) => {
  const { title, content } = req.body ?? {};
  if (typeof content !== 'string' || content.trim().length === 0) {
    return fail(res, 422, 'CONTENT_EMPTY', 'Content must not be empty.', {
      content: 'Content is required.',
    });
  }
  if (content.length > MAX_CONTENT_CHARS) {
    return fail(res, 413, 'CONTENT_TOO_LARGE', `Content exceeds ${MAX_CONTENT_CHARS} characters.`);
  }
  await sleep(REVIEW_LATENCY_MS);
  if (Math.random() < FAILURE_RATE) {
    return fail(res, 503, 'REVIEW_UNAVAILABLE', 'The review engine is temporarily unavailable.');
  }
  const review = {
    id: `rev_${randomUUID()}`,
    ownerId: req.user.id,
    title:
      typeof title === 'string' && title.trim() ? title.trim().slice(0, 200) : 'Untitled document',
    createdAt: new Date().toISOString(),
    status: 'completed',
    content,
    contentLength: content.length,
    contentHash: createHash('sha256').update(content).digest('hex'),
    findings: analyze(content, () => `fnd_${randomUUID()}`),
  };
  reviews.set(review.id, review);
  const { ownerId: _ownerId, ...body } = review;
  res.status(201).json(body);
});

api.get('/reviews', requireAuth, (req, res) => {
  const items = [...reviews.values()]
    .filter((r) => r.ownerId === req.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(summarize);
  res.json({ items });
});

function ownedReview(req, res) {
  const review = reviews.get(req.params.reviewId);
  // Same 404 for "missing" and "not yours" to avoid leaking review IDs.
  if (!review || review.ownerId !== req.user.id) {
    fail(res, 404, 'REVIEW_NOT_FOUND', 'Review not found.');
    return null;
  }
  return review;
}

api.get('/reviews/:reviewId', requireAuth, (req, res) => {
  const review = ownedReview(req, res);
  if (!review) return;
  const { ownerId: _ownerId, ...body } = review;
  res.json(body);
});

api.patch('/reviews/:reviewId/findings/:findingId', requireAuth, requireAuthor, (req, res) => {
  const review = ownedReview(req, res);
  if (!review) return;
  const finding = review.findings.find((f) => f.id === req.params.findingId);
  if (!finding) return fail(res, 404, 'FINDING_NOT_FOUND', 'Finding not found.');
  const { status } = req.body ?? {};
  if (!FINDING_STATUSES.has(status)) {
    return fail(res, 422, 'VALIDATION_FAILED', 'Invalid status.', {
      status: 'Unsupported status.',
    });
  }
  finding.status = status;
  res.json(finding);
});

app.use('/api/v1', api);
app.use('/api', (_req, res) => fail(res, 404, 'NOT_FOUND', 'Unknown endpoint.'));
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large')
    return fail(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body too large.');
  if (err?.type === 'entity.parse.failed') return fail(res, 400, 'BAD_REQUEST', 'Malformed JSON.');
  console.error(err);
  fail(res, 500, 'INTERNAL', 'Unexpected server error.');
});

app.listen(PORT, HOST, () => {
  console.log(`Mock ContentReviewService listening on http://${HOST}:${PORT}/api/v1`);
  console.log('Demo author:      demo@example.com / Demo!Passw0rd2026');
  console.log('Demo read-only:   reader@example.com / Reader!Passw0rd2026');
  console.log('Guest:            "Continue as guest" on the sign-in page (no credentials)');
});
