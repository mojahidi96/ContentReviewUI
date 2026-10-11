import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faCircle, faCircleCheck, faCircleExclamation } from '@fortawesome/free-solid-svg-icons';
import { EMPTY, Subject, catchError, exhaustMap, map, of } from 'rxjs';
import type { OtpPurpose } from '../../../core/auth/auth.models';
import { AuthService } from '../../../core/auth/auth.service';
import { safeReturnUrl } from '../../../core/auth/return-url';
import { ErrorHandlingService } from '../../../core/http/error-handling.service';
import { NotificationService } from '../../../core/notifications/notification.service';
import { ButtonDirective } from '../../../shared/components/button.directive';
import {
  FormField,
  INPUT_CLASSES,
  describedBy,
} from '../../../shared/components/form-field/form-field';
import { Spinner } from '../../../shared/components/spinner/spinner';
import { AuthLayout } from '../auth-layout/auth-layout';
import {
  PASSWORD_RULES,
  emailValidator,
  matchingFieldsValidator,
  passwordPolicyValidator,
} from '../auth.validators';
import { focusFirstInvalid } from '../focus-first-invalid';
import { PasswordInput } from '../password-input/password-input';

export const OTP_LENGTH = 4;
/** Seconds before "Send a new code" becomes available again. */
const RESEND_COOLDOWN_S = 30;

const OTP_ERRORS = {
  OTP_INVALID: 'That code is incorrect or has expired. Check the code or request a new one.',
  rate_limited: 'Too many attempts. Request a new code and try again.',
  validation: 'Please check the details you entered.',
};

type Step = 'email' | 'code';

/**
 * One page for both emailed-code flows, chosen by the route's `mode` data:
 * `login` signs in with a code; `reset` also sets a new password (and then signs in).
 */
@Component({
  selector: 'app-otp-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    FaIconComponent,
    AuthLayout,
    FormField,
    PasswordInput,
    ButtonDirective,
    Spinner,
  ],
  templateUrl: './otp.page.html',
})
export class OtpPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly errors = inject(ErrorHandlingService);
  private readonly notifications = inject(NotificationService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly mode: OtpPurpose =
    this.route.snapshot.data['mode'] === 'reset' ? 'reset' : 'login';
  protected readonly heading =
    this.mode === 'reset' ? 'Reset your password' : 'Sign in with a code';

  protected readonly step = signal<Step>('email');
  protected readonly subheading = computed(() =>
    this.step() === 'email'
      ? this.mode === 'reset'
        ? 'Enter your email and we will send you a 4-digit code.'
        : 'We will email you a 4-digit code. No password needed.'
      : 'Enter the 4-digit code we sent to your email.',
  );

  protected readonly form = new FormGroup(
    {
      email: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, emailValidator],
      }),
      otp: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(/^\d{4}$/)],
      }),
      password: new FormControl('', { nonNullable: true }),
      confirmPassword: new FormControl('', { nonNullable: true }),
    },
    { validators: matchingFieldsValidator('password', 'confirmPassword') },
  );

  protected readonly pending = signal<'send' | 'verify' | null>(null);
  protected readonly submitted = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly cooldown = signal(0);
  protected readonly sentTo = signal('');

  private readonly passwordValue = toSignal(this.form.controls.password.valueChanges, {
    initialValue: '',
  });
  protected readonly rules = () =>
    PASSWORD_RULES.map((rule) => ({
      key: rule.key,
      label: rule.label,
      met: rule.test(this.passwordValue()),
    }));

  protected readonly inputClasses = INPUT_CLASSES;
  protected readonly errorIcon = faCircleExclamation;
  protected readonly metIcon = faCircleCheck;
  protected readonly unmetIcon = faCircle;
  protected readonly describe = describedBy;

  private readonly sends = new Subject<string>();
  private readonly verifications = new Subject<void>();
  private cooldownTimer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    if (this.mode === 'reset') {
      this.form.controls.password.addValidators([Validators.required, passwordPolicyValidator]);
      this.form.controls.confirmPassword.addValidators(Validators.required);
    }

    this.sends
      .pipe(
        exhaustMap((email) =>
          this.auth.requestOtp(this.mode, email).pipe(
            map(() => email),
            catchError((error: unknown) => {
              this.serverError.set(this.errors.userMessage(error, OTP_ERRORS));
              this.pending.set(null);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((email) => {
        this.pending.set(null);
        this.sentTo.set(email);
        this.step.set('code');
        this.form.controls.otp.reset();
        this.startCooldown();
        focusFirstInvalid(this.host, this.injector);
      });

    this.verifications
      .pipe(
        exhaustMap(() => {
          const { otp, password } = this.form.getRawValue();
          const request$ =
            this.mode === 'reset'
              ? this.auth.resetPassword({ email: this.sentTo(), otp, newPassword: password })
              : this.auth.loginWithOtp({ email: this.sentTo(), otp });
          return request$.pipe(
            map(() => null),
            catchError((error: unknown) => of(this.errors.userMessage(error, OTP_ERRORS))),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((error) => {
        this.pending.set(null);
        if (error === null) {
          if (this.mode === 'reset') {
            this.notifications.success('Your password was updated and you are signed in.');
          }
          void this.router.navigateByUrl(
            safeReturnUrl(this.route.snapshot.queryParams['returnUrl'], this.auth.landingUrl()),
          );
        } else {
          this.serverError.set(error);
          this.form.controls.otp.reset();
          focusFirstInvalid(this.host, this.injector);
        }
      });

    inject(DestroyRef).onDestroy(() => clearInterval(this.cooldownTimer));
  }

  protected emailError(): string | null {
    const c = this.form.controls.email;
    if (!this.shouldShow(c)) return null;
    if (c.hasError('required')) return 'Enter your email address.';
    if (c.hasError('email')) return 'Enter a valid email address, like name@company.com.';
    return null;
  }

  protected otpError(): string | null {
    const c = this.form.controls.otp;
    if (!this.shouldShow(c)) return null;
    return c.invalid ? `Enter the ${OTP_LENGTH}-digit code.` : null;
  }

  protected passwordError(): string | null {
    const c = this.form.controls.password;
    if (!this.shouldShow(c)) return null;
    if (c.hasError('required')) return 'Create a new password.';
    if (c.hasError('passwordPolicy')) return 'Your password does not meet all of the requirements.';
    return null;
  }

  protected confirmError(): string | null {
    const c = this.form.controls.confirmPassword;
    if (!(c.touched || this.submitted())) return null;
    if (c.hasError('required')) return 'Confirm your new password.';
    if (this.form.hasError('fieldsMismatch')) return 'Passwords do not match.';
    return null;
  }

  /** Only digits are accepted in the code box. */
  protected onOtpInput(): void {
    const control = this.form.controls.otp;
    const digits = control.value.replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (digits !== control.value) control.setValue(digits);
  }

  protected sendCode(): void {
    this.submitted.set(true);
    const email = this.form.controls.email;
    if (this.pending()) return;
    if (email.invalid) {
      email.markAsTouched();
      focusFirstInvalid(this.host, this.injector);
      return;
    }
    this.serverError.set(null);
    this.pending.set('send');
    this.sends.next(email.value.trim());
  }

  protected resend(): void {
    if (this.pending() || this.cooldown() > 0) return;
    this.serverError.set(null);
    this.pending.set('send');
    this.sends.next(this.sentTo());
  }

  protected verify(): void {
    this.submitted.set(true);
    if (this.pending()) return;
    const controls = this.form.controls;
    const invalid =
      controls.otp.invalid ||
      (this.mode === 'reset' &&
        (controls.password.invalid || controls.confirmPassword.invalid || this.form.invalid));
    if (invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalid(this.host, this.injector);
      return;
    }
    this.serverError.set(null);
    this.pending.set('verify');
    this.verifications.next();
  }

  protected changeEmail(): void {
    this.serverError.set(null);
    this.submitted.set(false);
    this.step.set('email');
  }

  private startCooldown(): void {
    clearInterval(this.cooldownTimer);
    this.cooldown.set(RESEND_COOLDOWN_S);
    this.cooldownTimer = setInterval(() => {
      this.cooldown.update((s) => Math.max(0, s - 1));
      if (this.cooldown() === 0) clearInterval(this.cooldownTimer);
    }, 1000);
  }

  private shouldShow(control: FormControl<string>): boolean {
    return control.invalid && (control.touched || this.submitted());
  }
}
