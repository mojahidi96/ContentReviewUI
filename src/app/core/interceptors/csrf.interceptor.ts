import { HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { CsrfService } from '../auth/csrf.service';
import { APP_CONFIG } from '../config/app-config';

export const CSRF_HEADER = 'X-CSRF-Token';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Marks the single automatic retry after a `403 CSRF_INVALID`, so it can never loop. */
const CSRF_RETRIED = new HttpContextToken<boolean>(() => false);

function isCsrfRejection(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse) || error.status !== 403) {
    return false;
  }
  const body: unknown = error.error;
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { error?: { code?: unknown } }).error?.code === 'CSRF_INVALID'
  );
}

/**
 * Adds `X-CSRF-Token` to state-changing requests to our own API. Third-party URLs never get it.
 * On `403 CSRF_INVALID` (e.g. the token was bound to an expired session) it fetches a fresh
 * token and retries the request exactly once, as the Node contract recommends.
 */
export const csrfInterceptor: HttpInterceptorFn = (req, next) => {
  const config = inject(APP_CONFIG);
  if (!UNSAFE_METHODS.has(req.method) || !req.url.startsWith(config.apiBaseUrl)) {
    return next(req);
  }
  const csrf = inject(CsrfService);
  const send = (token: string) => next(req.clone({ setHeaders: { [CSRF_HEADER]: token } }));

  return csrf.ensureToken().pipe(
    switchMap(send),
    catchError((error: unknown) => {
      if (!isCsrfRejection(error) || req.context.get(CSRF_RETRIED)) {
        return throwError(() => error);
      }
      req.context.set(CSRF_RETRIED, true);
      return csrf.refresh().pipe(switchMap(send));
    }),
  );
};
