import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { SKIP_SESSION_EXPIRY } from '../http/http-context';

/** Handles 401 responses from protected endpoints uniformly: clear state, go to login. */
export const authErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(req).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !req.context.get(SKIP_SESSION_EXPIRY)
      ) {
        auth.handleSessionExpired(router.url);
      }
      return throwError(() => error);
    }),
  );
};
