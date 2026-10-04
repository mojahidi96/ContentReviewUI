import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TEST_USER, provideTestHttp } from '../../testing/test-providers';
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

  it('restores an existing session from /auth/me', async () => {
    const result = firstValueFrom(auth.restoreSession());
    const req = http.expectOne('/api/v1/auth/me');
    expect(req.request.withCredentials).toBe(true);
    req.flush({ user: TEST_USER });
    expect(await result).toEqual(TEST_USER);
    expect(auth.user()).toEqual(TEST_USER);
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('treats a 401 from /auth/me as anonymous without redirecting', async () => {
    const result = firstValueFrom(auth.restoreSession());
    http.expectOne('/api/v1/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    expect(await result).toBeNull();
    expect(auth.status()).toBe('anonymous');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('logs in and stores the returned user, never a token', async () => {
    const result = firstValueFrom(auth.login({ email: 'ada@example.com', password: 'pw' }));
    const req = http.expectOne('/api/v1/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'ada@example.com', password: 'pw' });
    req.flush({ user: TEST_USER });
    await result;
    expect(auth.user()).toEqual(TEST_USER);
    expect(JSON.stringify(localStorage)).not.toContain('ada@example.com');
  });

  it('propagates invalid credentials to the caller', async () => {
    const result = firstValueFrom(auth.login({ email: 'a@b.co', password: 'x' }));
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

  it('registers and signs the user in', async () => {
    const result = firstValueFrom(
      auth.register({ fullName: 'Ada', email: 'ada@example.com', password: 'pw' }),
    );
    http
      .expectOne('/api/v1/auth/register')
      .flush({ user: TEST_USER }, { status: 201, statusText: 'Created' });
    await result;
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('clears local state on logout even when the request fails', async () => {
    auth.login({ email: 'a@b.co', password: 'x' }).subscribe();
    http.expectOne('/api/v1/auth/login').flush({ user: TEST_USER });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = firstValueFrom(auth.logout(), { defaultValue: undefined });
    http.expectOne('/api/v1/auth/logout').flush(null, { status: 500, statusText: 'Server Error' });
    await done;

    expect(auth.user()).toBeNull();
    expect(auth.status()).toBe('anonymous');
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('redirects to login with a return URL when the session expires', () => {
    auth.login({ email: 'a@b.co', password: 'x' }).subscribe();
    http.expectOne('/api/v1/auth/login').flush({ user: TEST_USER });

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
