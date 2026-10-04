import { Component, ElementRef, Injector, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faCircle, faCircleCheck, faCircleExclamation } from '@fortawesome/free-solid-svg-icons';
import { Subject, catchError, exhaustMap, map, of } from 'rxjs';
import type { RegisterRequest } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { type ApiError } from '../../core/http/api-error';
import { ErrorHandlingService } from '../../core/http/error-handling.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { ButtonDirective } from '../../shared/components/button.directive';
import { FormField, INPUT_CLASSES, describedBy } from '../../shared/components/form-field';
import { Spinner } from '../../shared/components/spinner';
import { AuthLayout } from './auth-layout';
import {
  PASSWORD_RULES,
  emailValidator,
  matchingFieldsValidator,
  passwordPolicyValidator,
} from './auth.validators';
import { focusFirstInvalid } from './focus-first-invalid';
import { PasswordInput } from './password-input';

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
  template: `
    <app-auth-layout
      heading="Create your account"
      subheading="Start reviewing content in under a minute."
    >
      @if (serverError(); as message) {
        <div
          class="mb-6 flex gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"
          role="alert"
        >
          <fa-icon [icon]="errorIcon" class="mt-0.5" />
          <p>{{ message }}</p>
        </div>
      }

      <form
        [formGroup]="form"
        (ngSubmit)="submit()"
        novalidate
        class="space-y-5"
        [attr.aria-busy]="pending()"
      >
        <app-form-field label="Full name" controlId="register-name" [error]="fullNameError()">
          <input
            id="register-name"
            type="text"
            formControlName="fullName"
            autocomplete="name"
            [class]="inputClasses"
            [attr.aria-invalid]="!!fullNameError()"
            [attr.aria-describedby]="describe('register-name', false, !!fullNameError())"
          />
        </app-form-field>

        <app-form-field label="Work email" controlId="register-email" [error]="emailError()">
          <input
            id="register-email"
            type="email"
            formControlName="email"
            autocomplete="email"
            inputmode="email"
            [class]="inputClasses"
            [attr.aria-invalid]="!!emailError()"
            [attr.aria-describedby]="describe('register-email', false, !!emailError())"
          />
        </app-form-field>
        @if (emailTaken()) {
          <p class="-mt-3 text-sm text-slate-700 dark:text-slate-300">
            Already registered?
            <a
              routerLink="/login"
              class="font-medium text-brand-700 hover:underline dark:text-brand-300"
              >Sign in instead</a
            >.
          </p>
        }

        <app-form-field label="Password" controlId="register-password" [error]="passwordError()">
          <app-password-input
            inputId="register-password"
            [control]="form.controls.password"
            autocomplete="new-password"
            [invalid]="!!passwordError()"
            [describedBy]="
              'register-password-rules ' + (passwordError() ? 'register-password-error' : '')
            "
          />
          <ul
            id="register-password-rules"
            class="mt-2 grid gap-1 text-xs sm:grid-cols-2"
            aria-label="Password requirements"
          >
            @for (rule of rules(); track rule.key) {
              <li
                class="flex items-center gap-1.5"
                [class]="
                  rule.met
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-slate-600 dark:text-slate-400'
                "
              >
                <fa-icon
                  [icon]="rule.met ? metIcon : unmetIcon"
                  [class]="rule.met ? '' : 'text-[0.45rem]'"
                />
                {{ rule.label }}
                <span class="sr-only">{{ rule.met ? '(met)' : '(not met)' }}</span>
              </li>
            }
          </ul>
        </app-form-field>

        <app-form-field
          label="Confirm password"
          controlId="register-confirm"
          [error]="confirmError()"
        >
          <app-password-input
            inputId="register-confirm"
            [control]="form.controls.confirmPassword"
            autocomplete="new-password"
            [invalid]="!!confirmError()"
            [describedBy]="describe('register-confirm', false, !!confirmError())"
          />
        </app-form-field>

        <button type="submit" appButton size="lg" class="w-full" [disabled]="pending()">
          @if (pending()) {
            <app-spinner />
            Creating account…
          } @else {
            Create account
          }
        </button>
      </form>

      <p class="mt-8 text-center text-sm text-slate-600 dark:text-slate-400">
        Already have an account?
        <a
          routerLink="/login"
          class="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
          >Sign in</a
        >
      </p>
    </app-auth-layout>
  `,
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
    if (error.code === 'EMAIL_TAKEN') {
      this.emailTaken.set(true);
      focusFirstInvalid(this.host, this.injector);
      return;
    }
    if (error.fieldErrors) {
      for (const [field, message] of Object.entries(error.fieldErrors)) {
        const control = this.form.get(field);
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
