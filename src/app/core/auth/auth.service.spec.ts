import { HttpClient } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  TEST_CSRF_TOKEN,
  TEST_READER_DTO,
  TEST_USER,
  TEST_USER_DTO,
  flushCsrf,
  provideTestHttp,
  signIn,
} from '../../testing/test-providers';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideTestHttp() });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => http.verify());

  it('starts in the unknown state', () => {
    expect(auth.status()).toBe('unknown');
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('restores an existing session from /auth/me and maps the Node user', async () => {
    const result = firstValueFrom(auth.restoreSession());
    const req = http.expectOne('/api/v1/auth/me');
    expect(req.request.withCredentials).toBe(true);
    req.flush({ user: TEST_USER_DTO });
    expect(await result).toEqual(TEST_USER);
    expect(auth.user()).toEqual(TEST_USER);
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.canEdit()).toBe(true); // Node sends no role: every account may review
  });

  it('keeps an explicit reader role read-only', async () => {
    const result = firstValueFrom(auth.restoreSession());
    http.expectOne('/api/v1/auth/me').flush({ user: TEST_READER_DTO });
    await result;
    expect(auth.canEdit()).toBe(false);
  });

  it('treats a 401 from /auth/me as anonymous without redirecting', async () => {
    const result = firstValueFrom(auth.restoreSession());
    http
      .expectOne('/api/v1/auth/me')
      .flush(
        { error: { code: 'AUTH_REQUIRED', message: 'x', requestId: 'r' } },
        { status: 401, statusText: 'Unauthorized' },
      );
    expect(await result).toBeNull();
    expect(auth.status()).toBe('anonymous');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('fetches a CSRF token before logging in and never stores a token in Web Storage', async () => {
    const result = firstValueFrom(auth.login({ email: 'ada@example.com', password: 'pw' }));
    http.expectNone('/api/v1/auth/login'); // waits for the token
    const csrf = http.expectOne('/api/v1/auth/csrf');
    expect(csrf.request.method).toBe('GET');
    csrf.flush({ csrfToken: 'anon-token' });

    const req = http.expectOne('/api/v1/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('X-CSRF-Token')).toBe('anon-token');
    expect(req.request.body).toEqual({ email: 'ada@example.com', password: 'pw' });
    req.flush({ user: TEST_USER_DTO, csrfToken: 'session-token' });
    await result;

    expect(auth.user()).toEqual(TEST_USER);
    const storage = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(storage).not.toContain('session-token');
    expect(storage).not.toContain('ada@example.com');
  });

  it('uses the session-bound CSRF token returned by login for later writes', () => {
    signIn();
    TestBed.inject(HttpClient).post('/api/v1/reviews', {}).subscribe();
    expect(http.expectOne('/api/v1/reviews').request.headers.get('X-CSRF-Token')).toBe(
      TEST_CSRF_TOKEN,
    );
  });

  it('starts a guest session without credentials', async () => {
    const result = firstValueFrom(auth.continueAsGuest());
    flushCsrf(http);
    const req = http.expectOne('/api/v1/auth/guest');
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    req.flush({
      user: { ...TEST_USER_DTO, id: 'usr_guest_1', email: '', guest: true },
      csrfToken: 't',
    });
    expect(await result).toMatchObject({ id: 'usr_guest_1', guest: true, role: 'author' });
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.canEdit()).toBe(true);
  });

  it('propagates invalid credentials to the caller', async () => {
    const result = firstValueFrom(auth.login({ email: 'a@b.co', password: 'x' }));
    flushCsrf(http);
    http
      .expectOne('/api/v1/auth/login')
      .flush(
        { error: { code: 'INVALID_CREDENTIALS', message: 'no' } },
        { status: 401, statusText: 'Unauthorized' },
      );
    await expect(result).rejects.toMatchObject({ status: 401 });
    expect(auth.isAuthenticated()).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('registers with displayName and signs the user in', async () => {
    const result = firstValueFrom(
      auth.register({ fullName: 'Ada', email: 'ada@example.com', password: 'pw' }),
    );
    flushCsrf(http);
    const req = http.expectOne('/api/v1/auth/register');
    expect(req.request.body).toEqual({
      email: 'ada@example.com',
      password: 'pw',
      displayName: 'Ada',
    });
    req.flush({ user: TEST_USER_DTO, csrfToken: 't' }, { status: 201, statusText: 'Created' });
    await result;
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('clears local state on logout even when the request fails, then needs a new CSRF token', async () => {
    signIn();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = firstValueFrom(auth.logout(), { defaultValue: undefined });
    const logout = http.expectOne('/api/v1/auth/logout');
    expect(logout.request.headers.get('X-CSRF-Token')).toBe(TEST_CSRF_TOKEN);
    logout.flush(null, { status: 500, statusText: 'Server Error' });
    await done;

    expect(auth.user()).toBeNull();
    expect(auth.status()).toBe('anonymous');
    expect(router.navigate).toHaveBeenCalledWith(['/login']);

    // The old token was bound to the ended session, so the next write fetches a fresh one.
    auth.login({ email: 'a@b.co', password: 'x' }).subscribe({ error: () => undefined });
    http.expectOne('/api/v1/auth/csrf').flush({ csrfToken: 'fresh' });
    expect(http.expectOne('/api/v1/auth/login').request.headers.get('X-CSRF-Token')).toBe('fresh');
  });

  it('redirects to login with a return URL when the session expires', () => {
    signIn();
    auth.handleSessionExpired('/workspace/history');
    expect(auth.isAuthenticated()).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { reason: 'session-expired', returnUrl: '/workspace/history' },
    });
  });

  it('ignores session expiry when nobody is signed in', () => {
    auth.handleSessionExpired('/workspace');
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
