import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { SKIP_SESSION_EXPIRY } from '../http/http-context';

const isUnauthorized = (error: unknown): error is HttpErrorResponse =>
  error instanceof HttpErrorResponse && error.status === 401;

/**
 * Handles a `401` from a protected endpoint. The session cookie is short-lived, so the first
 * answer is to quietly trade the refresh cookie for a new session and repeat the request; the
 * user only sees "session expired" when the refresh itself is refused (idle too long, signed
 * out elsewhere). Requests that expect a 401 (login, session probe) opt out.
 */
export const authErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(req).pipe(
    catchError((error: unknown) => {
      if (!isUnauthorized(error) || req.context.get(SKIP_SESSION_EXPIRY)) {
        return throwError(() => error);
      }
      return auth.refreshSession().pipe(
        catchError(() => {
          auth.handleSessionExpired(router.url);
          return throwError(() => error);
        }),
        // The repeat goes through the whole chain again, so it picks up the new CSRF token.
        switchMap(() =>
          next(req).pipe(
            catchError((retryError: unknown) => {
              if (isUnauthorized(retryError)) {
                auth.handleSessionExpired(router.url);
              }
              return throwError(() => retryError);
            }),
          ),
        ),
      );
    }),
  );
};
