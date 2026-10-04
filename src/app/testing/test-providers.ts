import { provideHttpClient, withInterceptors, withNoXsrfProtection } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Routes } from '@angular/router';
import { APP_CONFIG, type AppConfig } from '../core/config/app-config';
import { apiInterceptor } from '../core/interceptors/api.interceptor';
import { authErrorInterceptor } from '../core/interceptors/auth-error.interceptor';
import { csrfInterceptor } from '../core/interceptors/csrf.interceptor';
import type { User, UserDto } from '../core/auth/auth.models';
import { AuthService } from '../core/auth/auth.service';
import {
  EVENT_SOURCE_FACTORY,
  type EventSourceLike,
} from '../features/content-review/review-events.service';
import type {
  Finding,
  FindingDto,
  Review,
  ReviewDto,
  ReviewEventPayloads,
  ReviewEventType,
} from '../features/content-review/review.models';

export const TEST_CONFIG: AppConfig = {
  production: false,
  apiBaseUrl: '/api/v1',
  requestTimeoutMs: 1_000,
  review: { maxChars: 100, categories: ['grammar', 'spelling', 'profanity'], pageSize: 20 },
  reviewEvents: { maxReconnects: 2, reconnectDelayMs: 0 },
  features: { guestLogin: true },
};

export const TEST_CSRF_TOKEN = 'csrf-test-token';

/**
 * HttpClient wired with the real interceptors against HttpTestingController, plus a controllable
 * fake EventSource ({@link FakeEventSource.instances}).
 */
export function provideTestHttp(
  routes: Routes = [],
  config: AppConfig = TEST_CONFIG,
): (Provider | EnvironmentProviders)[] {
  FakeEventSource.instances = [];
  return [
    { provide: APP_CONFIG, useValue: config },
    provideRouter(routes),
    provideHttpClient(
      withInterceptors([authErrorInterceptor, csrfInterceptor, apiInterceptor]),
      withNoXsrfProtection(),
    ),
    provideHttpClientTesting(),
    {
      provide: EVENT_SOURCE_FACTORY,
      useValue: (url: string, init: EventSourceInit) => new FakeEventSource(url, init),
    },
  ];
}

/** Answers the CSRF bootstrap request that precedes the first state-changing call, if any. */
export function flushCsrf(http: HttpTestingController, token = TEST_CSRF_TOKEN): void {
  for (const req of http.match('/api/v1/auth/csrf')) {
    req.flush({ csrfToken: token });
  }
}

/** A domain user as Node (or the mock, for `role`/`guest`) would send it. */
export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.fullName,
    createdAt: '2026-10-01T10:00:00.000Z',
    ...(user.role === 'reader' ? { role: 'reader' as const } : {}),
    ...(user.guest ? { guest: true } : {}),
  };
}

/** Signs `user` in through the real AuthService, answering the CSRF and login requests. */
export function signIn(user: User = TEST_USER): void {
  const http = TestBed.inject(HttpTestingController);
  TestBed.inject(AuthService).login({ email: user.email, password: 'pw' }).subscribe();
  flushCsrf(http);
  http.expectOne('/api/v1/auth/login').flush({ user: toUserDto(user), csrfToken: TEST_CSRF_TOKEN });
}

export const TEST_USER: User = {
  id: 'usr_1',
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'author',
};

export const TEST_READER: User = {
  id: 'usr_2',
  fullName: 'Riley Reader',
  email: 'reader@example.com',
  role: 'reader',
};

/** `TEST_USER` as Node sends it (no role). */
export const TEST_USER_DTO: UserDto = {
  id: 'usr_1',
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  createdAt: '2026-10-01T10:00:00.000Z',
};

/** A reader as the mock API sends it (`role` is a proposed extension). */
export const TEST_READER_DTO: UserDto = {
  id: 'usr_2',
  email: 'reader@example.com',
  displayName: 'Riley Reader',
  createdAt: '2026-10-01T10:00:00.000Z',
  role: 'reader',
};

export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'fnd_1',
    category: 'spelling',
    severity: 'low',
    excerpt: 'teh',
    suggestion: 'the',
    explanation: '"teh" is misspelled.',
    range: { start: 4, end: 7 },
    status: 'pending',
    ...overrides,
  };
}

export function makeReview(
  content: string,
  findings: Finding[],
  overrides: Partial<Review> = {},
): Review {
  return {
    id: 'rev_1',
    title: 'Doc',
    createdAt: '2026-10-01T10:00:00.000Z',
    status: 'completed',
    categories: ['grammar', 'spelling', 'profanity'],
    content,
    contentLength: content.length,
    findings,
    errorCode: null,
    ...overrides,
  };
}

export const REVIEW_ID = '6720f1c2a4b5c6d7e8f90123';

export function makeFindingDto(overrides: Partial<FindingDto> = {}): FindingDto {
  return {
    findingId: 'fnd_000000000000000000000001',
    category: 'spelling',
    severity: 'low',
    originalText: 'teh',
    suggestedText: 'the',
    explanation: '"teh" is misspelled.',
    startOffset: 4,
    endOffset: 7,
    status: 'pending',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

export function makeReviewDto(
  content: string,
  findings: FindingDto[],
  overrides: Partial<ReviewDto> = {},
): ReviewDto {
  return {
    reviewId: REVIEW_ID,
    documentTitle: 'Doc',
    status: 'completed',
    categories: ['grammar', 'spelling', 'profanity'],
    findingCount: findings.length,
    errorCode: null,
    errorMessage: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    completedAt: '2026-10-01T10:00:05.000Z',
    content,
    contentLength: Array.from(content).length,
    findings,
    eventsUrl: `/api/v1/reviews/${REVIEW_ID}/events`,
    ...overrides,
  };
}

/** In-memory stand-in for `EventSource`. Tests push events and connection state changes. */
export class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];

  readyState = 0;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  constructor(
    readonly url: string,
    readonly init: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }

  static latest(): FakeEventSource {
    const latest = FakeEventSource.instances.at(-1);
    if (!latest) throw new Error('No EventSource was opened');
    return latest;
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  emit<T extends ReviewEventType>(type: T, id: number, data: ReviewEventPayloads[T]): void {
    this.emitRaw(type, id, JSON.stringify(data));
  }

  emitRaw(type: string, id: number, data: string): void {
    const event = new MessageEvent<string>(type, { data, lastEventId: String(id) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  /** A dropped connection the browser will retry (readyState CONNECTING). */
  drop(): void {
    this.readyState = 0;
    this.onerror?.(new Event('error'));
  }

  /** A failure the browser will not retry (non-200 response such as 204/401/404). */
  fail(): void {
    this.readyState = 2;
    this.onerror?.(new Event('error'));
  }
}

/** Converts a domain finding fixture to Node's wire shape (test content is ASCII, so UTF-16 = code points). */
export function findingToDto(finding: Finding): FindingDto {
  return makeFindingDto({
    findingId: finding.id,
    category: finding.category,
    severity: finding.severity,
    originalText: finding.excerpt,
    suggestedText: finding.suggestion ?? '',
    explanation: finding.explanation,
    startOffset: finding.range?.start ?? 0,
    endOffset: finding.range?.end ?? 0,
    status: finding.status,
  });
}

/** `{ review }` body of `GET /reviews/:id` built from domain fixtures. */
export function reviewBody(
  content: string,
  findings: Finding[],
  overrides: Partial<ReviewDto> = {},
): { review: ReviewDto } {
  return { review: makeReviewDto(content, findings.map(findingToDto), overrides) };
}

/**
 * Plays a whole review run after `ReviewStore.submit()`: CSRF → `202` → `review.completed` event →
 * `GET` snapshot with `findings`.
 */
export function completeReviewFlow(
  http: HttpTestingController,
  content: string,
  findings: Finding[],
  reviewId = REVIEW_ID,
): void {
  const at = '2026-10-01T10:00:00.000Z';
  flushCsrf(http);
  http.expectOne({ method: 'POST', url: '/api/v1/reviews' }).flush(
    {
      reviewId,
      status: 'pending',
      eventsUrl: `/api/v1/reviews/${reviewId}/events`,
      createdAt: at,
    },
    { status: 202, statusText: 'Accepted' },
  );
  const source = FakeEventSource.latest();
  source.open();
  source.emit('review.completed', 1, {
    reviewId,
    status: 'completed',
    findingCount: findings.length,
    completedAt: at,
    occurredAt: at,
  });
  http
    .expectOne({ method: 'GET', url: `/api/v1/reviews/${reviewId}` })
    .flush(reviewBody(content, findings, { reviewId }));
}
