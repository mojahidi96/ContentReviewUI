import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import { InvalidResponseError, toApiError } from './api-error';

describe('toApiError', () => {
  it('reads the Node error envelope, including details and requestId', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: {
        error: { code: 'EMAIL_ALREADY_REGISTERED', message: 'taken', requestId: 'req-1' },
      },
    });
    expect(toApiError(error)).toEqual({
      kind: 'conflict',
      status: 409,
      code: 'EMAIL_ALREADY_REGISTERED',
      message: 'taken',
      requestId: 'req-1',
    });
  });

  it('turns body validation details into field errors keyed by field name', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'invalid',
          details: [
            { path: 'body.email', message: 'Must be a valid email address' },
            { path: 'body.email', message: 'second message is ignored' },
            { path: 'body.displayName', message: 'Display name is required' },
            { path: 'query.page', message: 'not a body field' },
          ],
        },
      },
    });
    expect(toApiError(error).fieldErrors).toEqual({
      email: 'Must be a valid email address',
      displayName: 'Display name is required',
    });
  });

  it('reads Retry-After and X-Request-Id headers', () => {
    const error = new HttpErrorResponse({
      status: 429,
      headers: new HttpHeaders({ 'Retry-After': '30', 'X-Request-Id': 'hdr-1' }),
      error: '<html>proxy page</html>',
    });
    expect(toApiError(error)).toMatchObject({
      kind: 'rate_limited',
      retryAfterSeconds: 30,
      requestId: 'hdr-1',
    });
  });

  it('maps a malformed success body to invalid_response', () => {
    expect(toApiError(new InvalidResponseError('review')).kind).toBe('invalid_response');
  });

  it.each([
    [0, 'network'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [400, 'validation'],
    [409, 'conflict'],
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
