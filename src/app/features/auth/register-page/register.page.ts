import { Component, ElementRef, Injector, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faCircle, faCircleCheck, faCircleExclamation } from '@fortawesome/free-solid-svg-icons';
import { Subject, catchError, exhaustMap, map, of } from 'rxjs';
import type { RegisterRequest } from '../../../core/auth/auth.models';
import { AuthService } from '../../../core/auth/auth.service';
import { type ApiError } from '../../../core/http/api-error';
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

/** Node's body field names that differ from this form's control names. */
const SERVER_FIELD_NAMES: Readonly<Record<string, string>> = { displayName: 'fullName' };

const REGISTER_ERRORS = {
  validation: 'Some details are invalid. Please review the highlighted fields.',
};

@Component({
  selector: 'app-register-page',
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
  templateUrl: './register.page.html',
  styleUrl: './register.page.scss',
})
export class RegisterPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly errors = inject(ErrorHandlingService);
  private readonly notifications = inject(NotificationService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly form = new FormGroup(
    {
      fullName: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(2), Validators.maxLength(100)],
      }),
      email: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, emailValidator],
      }),
      password: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, passwordPolicyValidator],
      }),
      confirmPassword: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
    },
    { validators: matchingFieldsValidator('password', 'confirmPassword') },
  );

  protected readonly pending = signal(false);
  protected readonly submitted = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly emailTaken = signal(false);

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

  private readonly submissions = new Subject<RegisterRequest>();

  constructor() {
    this.submissions
      .pipe(
        exhaustMap((request) =>
          this.auth.register(request).pipe(
            map(() => null),
            catchError((error: unknown) => of(this.errors.toApiError(error))),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((error) => {
        this.pending.set(false);
        if (error === null) {
          this.notifications.success('Your account is ready. Welcome to ContentReview!');
          void this.router.navigateByUrl('/workspace');
        } else {
          this.handleError(error);
        }
      });

    this.form.controls.email.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.emailTaken.set(false));
  }

  protected fullNameError(): string | null {
    const c = this.form.controls.fullName;
    if (!this.shouldShow(c)) return null;
    if (c.hasError('required')) return 'Enter your full name.';
    if (c.hasError('minlength')) return 'Full name must be at least 2 characters.';
    if (c.hasError('maxlength')) return 'Full name must be 100 characters or fewer.';
    return this.serverFieldError(c);
  }

  protected emailError(): string | null {
    const c = this.form.controls.email;
    if (this.emailTaken()) return 'An account with this email already exists.';
    if (!this.shouldShow(c)) return null;
    if (c.hasError('required')) return 'Enter your email address.';
    if (c.hasError('email')) return 'Enter a valid email address, like name@company.com.';
    return this.serverFieldError(c);
  }

  protected passwordError(): string | null {
    const c = this.form.controls.password;
    if (!this.shouldShow(c)) return null;
    if (c.hasError('required')) return 'Create a password.';
    if (c.hasError('passwordPolicy')) return 'Your password does not meet all of the requirements.';
    return this.serverFieldError(c);
  }

  protected confirmError(): string | null {
    const c = this.form.controls.confirmPassword;
    const show = c.touched || this.submitted();
    if (!show) return null;
    if (c.hasError('required')) return 'Confirm your password.';
    if (this.form.hasError('fieldsMismatch')) return 'Passwords do not match.';
    return null;
  }

  protected submit(): void {
    this.submitted.set(true);
    if (this.pending()) {
      return;
    }
    if (this.form.invalid || this.emailTaken()) {
      this.form.markAllAsTouched();
      focusFirstInvalid(this.host, this.injector);
      return;
    }
    this.serverError.set(null);
    this.pending.set(true);
    const { fullName, email, password } = this.form.getRawValue();
    this.submissions.next({ fullName: fullName.trim(), email: email.trim(), password });
  }

  private handleError(error: ApiError): void {
    if (error.code === 'EMAIL_ALREADY_REGISTERED') {
      this.emailTaken.set(true);
      focusFirstInvalid(this.host, this.injector);
      return;
    }
    if (error.fieldErrors) {
      for (const [field, message] of Object.entries(error.fieldErrors)) {
        const control = this.form.get(SERVER_FIELD_NAMES[field] ?? field);
        control?.setErrors({ ...control.errors, server: message });
        control?.markAsTouched();
      }
    }
    this.serverError.set(this.errors.userMessage(error, REGISTER_ERRORS));
    focusFirstInvalid(this.host, this.injector);
  }

  private serverFieldError(control: FormControl<string>): string | null {
    const message: unknown = control.getError('server');
    return typeof message === 'string' ? message : null;
  }

  private shouldShow(control: FormControl<string>): boolean {
    return control.invalid && (control.touched || this.submitted());
  }
}
