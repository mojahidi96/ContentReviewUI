import { HttpClient, HttpContext } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { TEST_USER, provideTestHttp } from '../../testing/test-providers';
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
      .post('/api/v1/auth/login', {}, { context: new HttpContext().set(SKIP_SESSION_EXPIRY, true) })
      .subscribe({ error: () => undefined });
    http.expectOne('/api/v1/auth/login').flush(null, { status: 401, statusText: 'Unauthorized' });
    expect(expired).not.toHaveBeenCalled();
  });

  it('does not treat other errors as session expiry', () => {
    auth.login({ email: 'a@b.co', password: 'x' }).subscribe();
    http.expectOne('/api/v1/auth/login').flush({ user: TEST_USER });
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
});
