import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ErrorHandlingService } from './error-handling.service';

describe('ErrorHandlingService', () => {
  const service = () => TestBed.inject(ErrorHandlingService);
  const http = (status: number, code?: string, message = 'internal detail') =>
    new HttpErrorResponse({ status, error: code ? { error: { code, message } } : null });

  it('never exposes backend messages verbatim', () => {
    expect(service().userMessage(http(500, 'INTERNAL', 'stack trace here'))).not.toContain(
      'stack trace',
    );
  });

  it('prefers code overrides, then kind overrides, then defaults', () => {
    const overrides = { EMAIL_TAKEN: 'by code', conflict: 'by kind' };
    expect(service().userMessage(http(409, 'EMAIL_TAKEN'), overrides)).toBe('by code');
    expect(service().userMessage(http(409, 'OTHER'), overrides)).toBe('by kind');
    expect(service().userMessage(http(0))).toMatch(/could not reach the server/i);
  });
});
