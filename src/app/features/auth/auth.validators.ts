import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export const PASSWORD_MIN_LENGTH = 12;
/** Node caps passwords at 72 UTF-8 bytes (the bcrypt input limit). */
export const PASSWORD_MAX_BYTES = 72;

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

export interface PasswordRule {
  readonly key: 'length' | 'lower' | 'upper' | 'digit' | 'symbol';
  readonly label: string;
  readonly test: (value: string) => boolean;
}

/**
 * Node only enforces the length rule (12 characters to 72 bytes). The character-class rules are
 * this UI's own, stricter policy; the backend remains the authority.
 */
export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    key: 'length',
    label: `${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_BYTES} characters`,
    test: (v) => v.length >= PASSWORD_MIN_LENGTH && utf8Bytes(v) <= PASSWORD_MAX_BYTES,
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
