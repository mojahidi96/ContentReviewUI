import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TEST_USER, flushCsrf, provideTestHttp, toUserDto } from '../../../testing/test-providers';
import { RegisterPage } from './register.page';

describe('RegisterPage', () => {
  let fixture: ComponentFixture<RegisterPage>;
  let el: HTMLElement;
  let http: HttpTestingController;
  let router: Router;

  const type = (id: string, value: string) => {
    const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const fillValid = () => {
    type('register-name', 'Ada Lovelace');
    type('register-email', 'ada@example.com');
    type('register-password', 'Str0ng!Passw0rd');
    type('register-confirm', 'Str0ng!Passw0rd');
  };
  const submit = async () => {
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [RegisterPage], providers: provideTestHttp() });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(RegisterPage);
    el = fixture.nativeElement;
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('requires every field', async () => {
    await submit();
    for (const message of [
      'Enter your full name.',
      'Enter your email address.',
      'Create a password.',
      'Confirm your password.',
    ]) {
      expect(el.textContent).toContain(message);
    }
    http.expectNone('/api/v1/auth/register');
  });

  it('shows live password requirements', async () => {
    type('register-password', 'abc');
    await fixture.whenStable();
    const rules = [...el.querySelectorAll('#register-password-rules li')].map((li) =>
      li.textContent?.trim(),
    );
    expect(rules).toContain('One lowercase letter (met)');
    expect(rules).toContain('One number (not met)');
  });

  it('rejects weak passwords and mismatched confirmation', async () => {
    fillValid();
    type('register-password', 'weakpassword');
    type('register-confirm', 'different');
    await submit();
    expect(el.textContent).toContain('does not meet all of the requirements');
    expect(el.textContent).toContain('Passwords do not match.');
    http.expectNone('/api/v1/auth/register');
  });

  it('registers and navigates to the workspace', async () => {
    fillValid();
    await submit();
    flushCsrf(http);
    const req = http.expectOne('/api/v1/auth/register');
    expect(req.request.body).toEqual({
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'Str0ng!Passw0rd',
    });
    expect(req.request.body).not.toHaveProperty('confirmPassword');
    req.flush(
      { user: toUserDto(TEST_USER), csrfToken: 't' },
      { status: 201, statusText: 'Created' },
    );
    await fixture.whenStable();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/workspace');
  });

  it('flags a duplicate email on the email field', async () => {
    fillValid();
    await submit();
    flushCsrf(http);
    http
      .expectOne('/api/v1/auth/register')
      .flush(
        { error: { code: 'EMAIL_ALREADY_REGISTERED', message: 'x' } },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    expect(el.querySelector('#register-email-error')?.textContent).toContain('already exists');
    expect(el.querySelector('#register-email')?.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('a[href="/login"]')).not.toBeNull();

    type('register-email', 'other@example.com');
    await fixture.whenStable();
    expect(el.querySelector('#register-email-error')).toBeNull();
  });

  it('maps Node validation details onto controls (displayName → full name)', async () => {
    fillValid();
    await submit();
    flushCsrf(http);
    http.expectOne('/api/v1/auth/register').flush(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'x',
          details: [{ path: 'body.displayName', message: 'Name is not allowed.' }],
        },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();
    expect(el.textContent).toContain('Name is not allowed.');
    expect(el.querySelector('[role=alert]')?.textContent).toContain(
      'review the highlighted fields',
    );
  });
});
