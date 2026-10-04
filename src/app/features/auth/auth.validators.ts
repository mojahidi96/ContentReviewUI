import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordRule {
  readonly key: 'length' | 'lower' | 'upper' | 'digit' | 'symbol';
  readonly label: string;
  readonly test: (value: string) => boolean;
}

/** Mirrors the backend password policy. The backend remains the authority. */
export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    key: 'length',
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (v) => v.length >= PASSWORD_MIN_LENGTH && v.length <= PASSWORD_MAX_LENGTH,
  },
  { key: 'lower', label: 'One lowercase letter', test: (v) => /[a-z]/.test(v) },
  { key: 'upper', label: 'One uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { key: 'digit', label: 'One number', test: (v) => /\d/.test(v) },
  { key: 'symbol', label: 'One symbol (e.g. ! ? # %)', test: (v) => /[^A-Za-z\d]/.test(v) },
];

/** Practical email check: Angular's built-in validator accepts addresses like `a@b`. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export const emailValidator: ValidatorFn = (control: AbstractControl<string>) => {
  const value = control.value;
  return !value || EMAIL_PATTERN.test(value.trim()) ? null : { email: true };
};

export const passwordPolicyValidator: ValidatorFn = (control: AbstractControl<string>) => {
  const value = control.value ?? '';
  if (!value) {
    return null;
  }
  const failed = PASSWORD_RULES.filter((rule) => !rule.test(value)).map((rule) => rule.key);
  return failed.length ? { passwordPolicy: failed } : null;
};

/** Group-level validator that flags the confirmation control when the two values differ. */
export function matchingFieldsValidator(field: string, confirmField: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const value = group.get(field)?.value as unknown;
    const confirm = group.get(confirmField)?.value as unknown;
    return value && confirm && value !== confirm ? { fieldsMismatch: true } : null;
  };
}
