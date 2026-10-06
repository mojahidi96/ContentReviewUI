import { Component, ElementRef, Injector, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faCircleExclamation, faClock, faUserSecret } from '@fortawesome/free-solid-svg-icons';
import { Observable, Subject, catchError, exhaustMap, map, of } from 'rxjs';
import type { User } from '../../../core/auth/auth.models';
import { AuthService } from '../../../core/auth/auth.service';
import { safeReturnUrl } from '../../../core/auth/return-url';
import { APP_CONFIG } from '../../../core/config/app-config';
import { ErrorHandlingService } from '../../../core/http/error-handling.service';
import { ButtonDirective } from '../../../shared/components/button.directive';
import {
  FormField,
  INPUT_CLASSES,
  describedBy,
} from '../../../shared/components/form-field/form-field';
import { Spinner } from '../../../shared/components/spinner/spinner';
import { AuthLayout } from '../auth-layout/auth-layout';
import { emailValidator } from '../auth.validators';
import { focusFirstInvalid } from '../focus-first-invalid';
import { PasswordInput } from '../password-input/password-input';

const LOGIN_ERRORS = {
  INVALID_CREDENTIALS: 'The email or password is incorrect.',
  validation: 'Please check your email and password.',
};

@Component({
  selector: 'app-login-page',
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
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly errors = inject(ErrorHandlingService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** Guest sign-in only exists in the mock API, so it is behind a feature flag. */
  protected readonly guestLogin = inject(APP_CONFIG).features.guestLogin;

  /** Query parameters, bound via `withComponentInputBinding()`. */
  readonly reason = input<string>();
  readonly returnUrl = input<string>();

  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, emailValidator],
    }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  /** Which sign-in is in flight; both buttons are disabled while either runs. */
  protected readonly pendingAction = signal<'login' | 'guest' | null>(null);
  protected readonly pending = computed(() => this.pendingAction() !== null);
  protected readonly submitted = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly sessionExpired = computed(
    () => this.reason() === 'session-expired' && this.serverError() === null,
  );

  protected readonly inputClasses = INPUT_CLASSES;
  protected readonly errorIcon = faCircleExclamation;
  protected readonly clockIcon = faClock;
  protected readonly guestIcon = faUserSecret;
  protected readonly describe = describedBy;

  private readonly submissions = new Subject<() => Observable<User>>();

  constructor() {
    // exhaustMap ignores further submissions while one is in flight.
    this.submissions
      .pipe(
        exhaustMap((signIn) =>
          signIn().pipe(
            map(() => null),
            catchError((error: unknown) => of(this.errors.userMessage(error, LOGIN_ERRORS))),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((error) => {
        this.pendingAction.set(null);
        if (error === null) {
          void this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
        } else {
          this.serverError.set(error);
          this.form.controls.password.reset();
        }
      });
  }

  protected emailError(): string | null {
    const control = this.form.controls.email;
    if (!this.shouldShow(control)) return null;
    if (control.hasError('required')) return 'Enter your email address.';
    if (control.hasError('email')) return 'Enter a valid email address, like name@company.com.';
    return null;
  }

  protected passwordError(): string | null {
    const control = this.form.controls.password;
    return this.shouldShow(control) && control.hasError('required') ? 'Enter your password.' : null;
  }

  protected submit(): void {
    this.submitted.set(true);
    if (this.pending()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalid(this.host, this.injector);
      return;
    }
    this.serverError.set(null);
    this.pendingAction.set('login');
    const { email, password } = this.form.getRawValue();
    this.submissions.next(() => this.auth.login({ email: email.trim(), password }));
  }

  protected continueAsGuest(): void {
    if (this.pending()) {
      return;
    }
    this.serverError.set(null);
    this.pendingAction.set('guest');
    this.submissions.next(() => this.auth.continueAsGuest());
  }

  private shouldShow(control: FormControl<string>): boolean {
    return control.invalid && (control.touched || this.submitted());
  }
}
