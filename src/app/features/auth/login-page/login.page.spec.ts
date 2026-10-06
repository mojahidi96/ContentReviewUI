import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  TEST_CONFIG,
  TEST_USER,
  flushCsrf,
  provideTestHttp,
  toUserDto,
} from '../../../testing/test-providers';
import { LoginPage } from './login.page';

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  let el: HTMLElement;
  let http: HttpTestingController;
  let router: Router;

  const input = (id: string) => el.querySelector<HTMLInputElement>(`#${id}`)!;
  const type = (id: string, value: string) => {
    input(id).value = value;
    input(id).dispatchEvent(new Event('input'));
  };
  const submit = async () => {
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };
  const submitButton = () => el.querySelector<HTMLButtonElement>('button[type=submit]')!;

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [LoginPage], providers: provideTestHttp() });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(LoginPage);
    el = fixture.nativeElement;
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('shows accessible inline errors and does not call the API when invalid', async () => {
    await submit();
    expect(el.textContent).toContain('Enter your email address.');
    expect(el.textContent).toContain('Enter your password.');
    expect(input('login-email').getAttribute('aria-invalid')).toBe('true');
    expect(input('login-email').getAttribute('aria-describedby')).toBe('login-email-error');
    expect(el.querySelector('#login-email-error')).not.toBeNull();
    http.expectNone('/api/v1/auth/login');
  });

  it('validates the email format', async () => {
    type('login-email', 'not-an-email');
    type('login-password', 'secret');
    await submit();
    expect(el.textContent).toContain('Enter a valid email address');
  });

  it('shows a loading state, prevents duplicate submissions and navigates on success', async () => {
    fixture.componentRef.setInput('returnUrl', '/workspace/history');
    type('login-email', 'ada@example.com');
    type('login-password', 'secret');
    await submit();

    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toContain('Signing in');
    await submit(); // second click while pending

    flushCsrf(http);
    const req = http.expectOne('/api/v1/auth/login'); // only one request
    expect(req.request.body).toEqual({ email: 'ada@example.com', password: 'secret' });
    req.flush({ user: toUserDto(TEST_USER), csrfToken: 't' });
    await fixture.whenStable();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/workspace/history');
    expect(submitButton().disabled).toBe(false);
  });

  it('never redirects to an external returnUrl', async () => {
    fixture.componentRef.setInput('returnUrl', '//evil.example');
    type('login-email', 'ada@example.com');
    type('login-password', 'secret');
    await submit();
    flushCsrf(http);
    http.expectOne('/api/v1/auth/login').flush({ user: toUserDto(TEST_USER), csrfToken: 't' });
    await fixture.whenStable();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/workspace');
  });

  it.each([
    [
      401,
      { error: { code: 'INVALID_CREDENTIALS', message: 'x' } },
      'The email or password is incorrect.',
    ],
    [500, null, 'Something went wrong on our side'],
  ])('maps a %i response to a helpful alert', async (status, body, message) => {
    type('login-email', 'ada@example.com');
    type('login-password', 'secret');
    await submit();
    flushCsrf(http);
    http.expectOne('/api/v1/auth/login').flush(body, { status, statusText: 'Error' });
    await fixture.whenStable();
    expect(el.querySelector('[role=alert]')?.textContent).toContain(message);
    expect(input('login-password').value).toBe('');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('reports network failures', async () => {
    type('login-email', 'ada@example.com');
    type('login-password', 'secret');
    await submit();
    flushCsrf(http);
    http.expectOne('/api/v1/auth/login').error(new ProgressEvent('error'));
    await fixture.whenStable();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('could not reach the server');
  });

  describe('guest access', () => {
    const guestButton = () => el.querySelector<HTMLButtonElement>('[data-testid=guest-login]')!;
    const guest = {
      ...TEST_USER,
      id: 'usr_guest_1',
      fullName: 'Guest User',
      email: '',
      guest: true as const,
    };

    it('signs in as a guest without credentials and navigates to the return URL', async () => {
      fixture.componentRef.setInput('returnUrl', '/workspace/history');
      guestButton().click();
      await fixture.whenStable();

      expect(guestButton().disabled).toBe(true);
      expect(submitButton().disabled).toBe(true);
      expect(guestButton().textContent).toContain('Starting guest session');
      guestButton().click(); // ignored while pending

      flushCsrf(http);
      const req = http.expectOne('/api/v1/auth/guest');
      expect(req.request.method).toBe('POST');
      req.flush({ user: toUserDto(guest), csrfToken: 't' });
      await fixture.whenStable();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/workspace/history');
      expect(guestButton().disabled).toBe(false);
      expect(el.textContent).not.toContain('Enter your email address.');
    });

    it('reports a failed guest sign-in', async () => {
      guestButton().click();
      await fixture.whenStable();
      flushCsrf(http);
      http.expectOne('/api/v1/auth/guest').flush(null, { status: 500, statusText: 'Error' });
      await fixture.whenStable();
      expect(el.querySelector('[role=alert]')?.textContent).toContain('Something went wrong');
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('is hidden when the backend has no guest endpoint (Node)', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [LoginPage],
        providers: provideTestHttp([], { ...TEST_CONFIG, features: { guestLogin: false } }),
      });
      http = TestBed.inject(HttpTestingController);
      const node = TestBed.createComponent(LoginPage);
      await node.whenStable();
      expect(node.nativeElement.querySelector('[data-testid=guest-login]')).toBeNull();
      expect(node.nativeElement.textContent).not.toContain('Continue as guest');
    });
  });

  it('explains when the session has expired', async () => {
    fixture.componentRef.setInput('reason', 'session-expired');
    await fixture.whenStable();
    expect(el.textContent).toContain('Your session has expired');
  });
});
