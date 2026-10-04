import { Component, input, signal } from '@angular/core';
import { ReactiveFormsModule, type FormControl } from '@angular/forms';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
import { INPUT_CLASSES } from '../../shared/components/form-field';

/** Password input with a show/hide toggle. */
@Component({
  selector: 'app-password-input',
  imports: [ReactiveFormsModule, FaIconComponent],
  host: { class: 'relative block' },
  template: `
    <input
      [id]="inputId()"
      [type]="visible() ? 'text' : 'password'"
      [formControl]="control()"
      [autocomplete]="autocomplete()"
      [attr.aria-invalid]="invalid()"
      [attr.aria-describedby]="describedBy()"
      [class]="inputClasses"
      class="pr-11"
    />
    <button
      type="button"
      class="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-500 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-focus dark:text-slate-400 dark:hover:text-slate-200"
      [attr.aria-label]="visible() ? 'Hide password' : 'Show password'"
      [attr.aria-pressed]="visible()"
      [attr.aria-controls]="inputId()"
      (click)="visible.set(!visible())"
    >
      <fa-icon [icon]="visible() ? hideIcon : showIcon" />
    </button>
  `,
})
export class PasswordInput {
  readonly inputId = input.required<string>();
  readonly control = input.required<FormControl<string>>();
  readonly autocomplete = input<'current-password' | 'new-password'>('current-password');
  readonly invalid = input(false);
  readonly describedBy = input<string | null>(null);

  protected readonly visible = signal(false);
  protected readonly inputClasses = INPUT_CLASSES;
  protected readonly showIcon = faEye;
  protected readonly hideIcon = faEyeSlash;
}
