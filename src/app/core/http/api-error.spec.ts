import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import { toApiError } from './api-error';

describe('toApiError', () => {
  it('reads the backend error envelope', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { error: { code: 'EMAIL_TAKEN', message: 'taken', fieldErrors: { email: 'x' } } },
    });
    expect(toApiError(error)).toEqual({
      kind: 'conflict',
      status: 409,
      code: 'EMAIL_TAKEN',
      message: 'taken',
      fieldErrors: { email: 'x' },
    });
  });

  it.each([
    [0, 'network'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [413, 'validation'],
    [422, 'validation'],
    [429, 'rate_limited'],
    [500, 'server'],
    [503, 'server'],
    [504, 'timeout'],
  ])('maps status %i to %s', (status, kind) => {
    expect(toApiError(new HttpErrorResponse({ status })).kind).toBe(kind);
  });

  it('maps RxJS timeouts', () => {
    expect(toApiError(new TimeoutError()).kind).toBe('timeout');
  });

  it('handles unknown values', () => {
    expect(toApiError('boom')).toMatchObject({ kind: 'unknown', status: 0 });
  });
});
