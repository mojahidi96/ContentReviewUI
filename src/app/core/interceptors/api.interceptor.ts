import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { timeout } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { REQUEST_TIMEOUT_MS } from '../http/http-context';

/**
 * For requests to our own API: sends the session cookie and applies a timeout so the UI never
 * waits forever. Third-party URLs are left untouched so credentials never leak to them.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const config = inject(APP_CONFIG);
  if (!req.url.startsWith(config.apiBaseUrl)) {
    return next(req);
  }
  const timeoutMs = req.context.get(REQUEST_TIMEOUT_MS) ?? config.requestTimeoutMs;
  return next(req.clone({ withCredentials: true })).pipe(timeout(timeoutMs));
};
