import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { provideRouter, type Routes } from '@angular/router';
import { APP_CONFIG, type AppConfig } from '../core/config/app-config';
import { apiInterceptor } from '../core/interceptors/api.interceptor';
import { authErrorInterceptor } from '../core/interceptors/auth-error.interceptor';
import type { User } from '../core/auth/auth.models';
import type { Finding, Review } from '../features/content-review/review.models';

export const TEST_CONFIG: AppConfig = {
  production: false,
  apiBaseUrl: '/api/v1',
  requestTimeoutMs: 1_000,
  reviewTimeoutMs: 5_000,
  review: { maxChars: 100 },
};

/** HttpClient wired with the real interceptors against HttpTestingController. */
export function provideTestHttp(routes: Routes = []): (Provider | EnvironmentProviders)[] {
  return [
    { provide: APP_CONFIG, useValue: TEST_CONFIG },
    provideRouter(routes),
    provideHttpClient(withInterceptors([authErrorInterceptor, apiInterceptor])),
    provideHttpClientTesting(),
  ];
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
    content,
    contentLength: content.length,
    contentHash: 'hash',
    findings,
    ...overrides,
  };
}
