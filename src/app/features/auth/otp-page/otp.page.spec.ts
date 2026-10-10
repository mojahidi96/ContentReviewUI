import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TEST_USER, flushCsrf, provideTestHttp, toUserDto } from '../../../testing/test-providers';
import { OtpPage } from './otp.page';

describe.each(['login', 'reset'] as const)('OtpPage (%s)', (mode) => {
  let fixture: ComponentFixture<OtpPage>;
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
  const sendPath = mode === 'login' ? '/api/v1/auth/otp/request' : '/api/v1/auth/password/forgot';
  const verifyPath = mode === 'login' ? '/api/v1/auth/otp/login' : '/api/v1/auth/password/reset';

  const requestCode = async () => {
    type('otp-email', ' ada@example.com ');
    await submit();
    flushCsrf(http);
    http.expectOne(sendPath).flush({ expiresInSeconds: 300 }, { status: 202, statusText: 'OK' });
    await fixture.whenStable();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [OtpPage],
      providers: [
        provideTestHttp(),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { mode }, queryParams: {} } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(OtpPage);
    el = fixture.nativeElement;
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('validates the email before requesting a code', async () => {
    await submit();
    expect(el.textContent).toContain('Enter your email address.');
    http.expectNone(sendPath);
  });

  it('requests a code and moves to the code step', async () => {
    await requestCode();
    expect(input('otp-code')).not.toBeNull();
    expect(el.textContent).toContain('ada@example.com');
  });

  it('only accepts digits and requires all 4', async () => {
    await requestCode();
    type('otp-code', '12ab3456');
    expect(input('otp-code').value).toBe('1234');
    type('otp-code', '12');
    await submit();
    expect(el.textContent).toContain('Enter the 4-digit code.');
    http.expectNone(verifyPath);
  });

  it('shows a clear error and clears the code when it is wrong', async () => {
    await requestCode();
    type('otp-code', '1234');
    if (mode === 'reset') {
      type('otp-password', 'Str0ng!Passw0rd');
      type('otp-confirm', 'Str0ng!Passw0rd');
    }
    await submit();
    http
      .expectOne(verifyPath)
      .flush({ error: { code: 'OTP_INVALID', message: 'x' } }, { status: 401, statusText: 'No' });
    await fixture.whenStable();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('incorrect or has expired');
    expect(input('otp-code').value).toBe('');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('signs in once the code is accepted', async () => {
    await requestCode();
    type('otp-code', '0420');
    if (mode === 'reset') {
      type('otp-password', 'Str0ng!Passw0rd');
      type('otp-confirm', 'Str0ng!Passw0rd');
    }
    await submit();
    const req = http.expectOne(verifyPath);
    expect(req.request.body).toEqual(
      mode === 'login'
        ? { email: 'ada@example.com', otp: '0420' }
        : { email: 'ada@example.com', otp: '0420', newPassword: 'Str0ng!Passw0rd' },
    );
    req.flush({ user: toUserDto(TEST_USER), csrfToken: 't' });
    await fixture.whenStable();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/workspace');
  });

  if (mode === 'reset') {
    it('rejects a weak or mismatched new password without calling the API', async () => {
      await requestCode();
      type('otp-code', '0420');
      type('otp-password', 'weak');
      type('otp-confirm', 'other');
      await submit();
      expect(el.textContent).toContain('does not meet all of the requirements');
      http.expectNone(verifyPath);
    });
  }
});
