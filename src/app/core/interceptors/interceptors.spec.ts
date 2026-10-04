import { HttpClient, HttpContext } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { TEST_USER, flushCsrf, provideTestHttp, signIn } from '../../testing/test-providers';
import { AuthService } from '../auth/auth.service';
import { REQUEST_TIMEOUT_MS, SKIP_SESSION_EXPIRY } from '../http/http-context';

describe('HTTP interceptors', () => {
  let client: HttpClient;
  let http: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideTestHttp() });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('sends credentials to the API only', () => {
    client.get('/api/v1/reviews').subscribe();
    client.get('https://cdn.example.com/file.json').subscribe();
    expect(http.expectOne('/api/v1/reviews').request.withCredentials).toBe(true);
    expect(http.expectOne('https://cdn.example.com/file.json').request.withCredentials).toBe(false);
  });

  it('expires the session on a 401 from a protected endpoint', () => {
    const expired = vi.spyOn(auth, 'handleSessionExpired');
    client.get('/api/v1/reviews').subscribe({ error: () => undefined });
    http.expectOne('/api/v1/reviews').flush(null, { status: 401, statusText: 'Unauthorized' });
    expect(expired).toHaveBeenCalledOnce();
  });

  it('does not expire the session for requests that expect 401', () => {
    const expired = vi.spyOn(auth, 'handleSessionExpired');
    client
      .get('/api/v1/auth/me', { context: new HttpContext().set(SKIP_SESSION_EXPIRY, true) })
      .subscribe({ error: () => undefined });
    http.expectOne('/api/v1/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    expect(expired).not.toHaveBeenCalled();
  });

  it('does not treat other errors as session expiry', () => {
    signIn(TEST_USER);
    client.get('/api/v1/reviews').subscribe({ error: () => undefined });
    http.expectOne('/api/v1/reviews').flush(null, { status: 500, statusText: 'Server Error' });
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('times out slow API requests using the configured default', async () => {
    vi.useFakeTimers();
    const result = firstValueFrom(client.get('/api/v1/reviews'));
    const req = http.expectOne('/api/v1/reviews');
    vi.advanceTimersByTime(1_001);
    await expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(req.cancelled).toBe(true);
  });

  it('honours a per-request timeout override', async () => {
    vi.useFakeTimers();
    const result = firstValueFrom(
      client.get('/api/v1/reviews', { context: new HttpContext().set(REQUEST_TIMEOUT_MS, 5_000) }),
    );
    const req = http.expectOne('/api/v1/reviews');
    vi.advanceTimersByTime(2_000);
    req.flush({ items: [] });
    await expect(result).resolves.toEqual({ items: [] });
  });

  describe('CSRF', () => {
    const csrfInvalid = { error: { code: 'CSRF_INVALID', message: 'x', requestId: 'r' } };

    it('adds X-CSRF-Token to unsafe API requests only', () => {
      client.post('/api/v1/reviews', {}).subscribe();
      client.get('/api/v1/reviews').subscribe();
      client.post('https://other.example.com/hook', {}).subscribe();
      flushCsrf(http, 'tok');
      expect(
        http
          .expectOne((r) => r.method === 'POST' && r.url === '/api/v1/reviews')
          .request.headers.get('X-CSRF-Token'),
      ).toBe('tok');
      expect(
        http
          .expectOne((r) => r.method === 'GET' && r.url === '/api/v1/reviews')
          .request.headers.has('X-CSRF-Token'),
      ).toBe(false);
      expect(
        http.expectOne('https://other.example.com/hook').request.headers.has('X-CSRF-Token'),
      ).toBe(false);
    });

    it('shares one token request between concurrent writes', () => {
      client.post('/api/v1/a', {}).subscribe();
      client.patch('/api/v1/b', {}).subscribe();
      http.expectOne('/api/v1/auth/csrf').flush({ csrfToken: 'tok' });
      expect(http.expectOne('/api/v1/a').request.headers.get('X-CSRF-Token')).toBe('tok');
      expect(http.expectOne('/api/v1/b').request.headers.get('X-CSRF-Token')).toBe('tok');
    });

    it('refreshes the token and retries once after 403 CSRF_INVALID', async () => {
      const result = firstValueFrom(client.post('/api/v1/reviews', {}));
      flushCsrf(http, 'stale');
      http
        .expectOne('/api/v1/reviews')
        .flush(csrfInvalid, { status: 403, statusText: 'Forbidden' });
      http.expectOne('/api/v1/auth/csrf').flush({ csrfToken: 'fresh' });
      const retry = http.expectOne('/api/v1/reviews');
      expect(retry.request.headers.get('X-CSRF-Token')).toBe('fresh');
      retry.flush({ ok: true });
      expect(await result).toEqual({ ok: true });
    });

    it('does not retry a second time or retry other 403s', async () => {
      const twice = firstValueFrom(client.post('/api/v1/reviews', {}));
      flushCsrf(http);
      http
        .expectOne('/api/v1/reviews')
        .flush(csrfInvalid, { status: 403, statusText: 'Forbidden' });
      flushCsrf(http);
      http
        .expectOne('/api/v1/reviews')
        .flush(csrfInvalid, { status: 403, statusText: 'Forbidden' });
      await expect(twice).rejects.toMatchObject({ status: 403 });

      const forbidden = firstValueFrom(client.post('/api/v1/reviews', {}));
      http
        .expectOne('/api/v1/reviews')
        .flush(
          { error: { code: 'ORIGIN_NOT_ALLOWED', message: 'x' } },
          { status: 403, statusText: 'Forbidden' },
        );
      await expect(forbidden).rejects.toMatchObject({ status: 403 });
      http.expectNone('/api/v1/auth/csrf');
    });
  });
});
