import { provideHttpClient, withInterceptors, withNoXsrfProtection } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { AuthService } from './core/auth/auth.service';
import { apiInterceptor } from './core/interceptors/api.interceptor';
import { authErrorInterceptor } from './core/interceptors/auth-error.interceptor';
import { csrfInterceptor } from './core/interceptors/csrf.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(
      withInterceptors([authErrorInterceptor, csrfInterceptor, apiInterceptor]),
      // Node's CSRF cookie is HttpOnly, so Angular's cookie-reading XSRF support cannot work.
      // csrfInterceptor sends the token from GET /auth/csrf (or login/register) instead.
      withNoXsrfProtection(),
    ),
    // Resolve "who am I" from the session cookie before the first navigation so guards
    // can decide synchronously.
    provideAppInitializer(() => inject(AuthService).restoreSession()),
  ],
};
