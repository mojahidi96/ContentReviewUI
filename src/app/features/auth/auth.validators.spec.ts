import { FormControl, FormGroup } from '@angular/forms';
import {
  emailValidator,
  matchingFieldsValidator,
  passwordPolicyValidator,
} from './auth.validators';

describe('emailValidator', () => {
  it.each(['name@company.com', 'first.last+tag@sub.example.co.uk'])('accepts %s', (email) => {
    expect(emailValidator(new FormControl(email))).toBeNull();
  });

  it.each(['plain', 'a@b', 'a@b.', 'with space@x.com', '@x.com'])('rejects %s', (email) => {
    expect(emailValidator(new FormControl(email))).toEqual({ email: true });
  });

  it('leaves empty values to the required validator', () => {
    expect(emailValidator(new FormControl(''))).toBeNull();
  });
});

describe('passwordPolicyValidator', () => {
  it('accepts a password meeting every rule', () => {
    expect(passwordPolicyValidator(new FormControl('Str0ng!Passw0rd'))).toBeNull();
  });

  it('reports each failed rule', () => {
    expect(passwordPolicyValidator(new FormControl('short'))).toEqual({
      passwordPolicy: ['length', 'upper', 'digit', 'symbol'],
    });
  });

  it('enforces the maximum length', () => {
    expect(passwordPolicyValidator(new FormControl(`Aa1!${'x'.repeat(130)}`))).toEqual({
      passwordPolicy: ['length'],
    });
  });
});

describe('matchingFieldsValidator', () => {
  const group = (a: string, b: string) =>
    new FormGroup(
      { password: new FormControl(a), confirm: new FormControl(b) },
      { validators: matchingFieldsValidator('password', 'confirm') },
    );

  it('flags mismatched values', () => {
    expect(group('one', 'two').hasError('fieldsMismatch')).toBe(true);
  });

  it('passes matching values', () => {
    expect(group('same', 'same').hasError('fieldsMismatch')).toBe(false);
  });

  it('does not flag while confirmation is empty', () => {
    expect(group('one', '').hasError('fieldsMismatch')).toBe(false);
  });
});
