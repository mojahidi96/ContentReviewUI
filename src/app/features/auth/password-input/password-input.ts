import { Component, input, signal } from '@angular/core';
import { ReactiveFormsModule, type FormControl } from '@angular/forms';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
import { INPUT_CLASSES } from '../../../shared/components/form-field/form-field';

/** Password input with a show/hide toggle. */
@Component({
  selector: 'app-password-input',
  imports: [ReactiveFormsModule, FaIconComponent],
  host: { class: 'relative block' },
  templateUrl: './password-input.html',
  styleUrl: './password-input.scss',
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
