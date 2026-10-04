import { provideHttpClient, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
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

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(
      withInterceptors([authErrorInterceptor, apiInterceptor]),
      // Double-submit CSRF protection: the backend sets a readable XSRF-TOKEN cookie and Angular
      // echoes it in this header on same-origin mutating requests.
      withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' }),
    ),
    // Resolve "who am I" from the session cookie before the first navigation so guards
    // can decide synchronously.
    provideAppInitializer(() => inject(AuthService).restoreSession()),
  ],
};
