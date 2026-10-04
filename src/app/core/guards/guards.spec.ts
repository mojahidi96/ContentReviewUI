import { TestBed } from '@angular/core/testing';
import {
  Router,
  UrlTree,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';
import { TEST_READER, provideTestHttp, signIn } from '../../testing/test-providers';
import { authGuard } from './auth.guard';
import { authorGuard } from './author.guard';
import { guestGuard } from './guest.guard';

describe('route guards', () => {
  const route = {} as ActivatedRouteSnapshot;
  const state = { url: '/workspace/history' } as RouterStateSnapshot;

  const run = (guard: typeof authGuard) => TestBed.runInInjectionContext(() => guard(route, state));
  const serialize = (result: unknown) => TestBed.inject(Router).serializeUrl(result as UrlTree);

  beforeEach(() => TestBed.configureTestingModule({ providers: provideTestHttp() }));

  describe('authorGuard', () => {
    it('allows authors', () => {
      signIn();
      expect(run(authorGuard)).toBe(true);
    });

    it('sends read-only users back to the document', () => {
      signIn(TEST_READER);
      expect(serialize(run(authorGuard))).toBe('/workspace');
    });
  });

  describe('authGuard', () => {
    it('redirects anonymous users to login and keeps the target URL', () => {
      const result = run(authGuard);
      expect(result).toBeInstanceOf(UrlTree);
      expect(serialize(result)).toBe('/login?returnUrl=%2Fworkspace%2Fhistory');
    });

    it('allows authenticated users', () => {
      signIn();
      expect(run(authGuard)).toBe(true);
    });
  });

  describe('guestGuard', () => {
    it('allows anonymous users', () => {
      expect(run(guestGuard)).toBe(true);
    });

    it('sends authenticated users to the workspace', () => {
      signIn();
      expect(serialize(run(guestGuard))).toBe('/workspace');
    });
  });
});
