import { HttpClient, HttpContext } from '@angular/common/http';
import { Service, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, map, of, tap } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { toApiError } from '../http/api-error';
import { SKIP_SESSION_EXPIRY } from '../http/http-context';
import type { AuthResponse, AuthStatus, LoginRequest, RegisterRequest, User } from './auth.models';

/**
 * Single source of truth for the signed-in user.
 *
 * The session itself lives in an HttpOnly cookie managed by the backend, so this service never
 * sees or stores a token: it only mirrors "who am I" for the UI. Route guards built on it are a
 * UX convenience — the backend enforces authorization on every request.
 */
@Service()
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly baseUrl = `${inject(APP_CONFIG).apiBaseUrl}/auth`;

  private readonly _user = signal<User | null>(null);
  private readonly _status = signal<AuthStatus>('unknown');

  readonly user = this._user.asReadonly();
  readonly status = this._status.asReadonly();
  readonly isAuthenticated = computed(() => this._status() === 'authenticated');
  /**
   * Whether the user may edit and review content. Anything other than an explicit `author`
   * role is read-only. A UX gate only — the backend enforces this on every write.
   */
  readonly canEdit = computed(() => this._user()?.role === 'author');

  /** Restores the session from the cookie on startup. Never errors: failure means anonymous. */
  restoreSession(): Observable<User | null> {
    return this.http
      .get<AuthResponse>(`${this.baseUrl}/me`, { context: this.expectedAuthFailure() })
      .pipe(
        map(({ user }) => user),
        catchError(() => of(null)),
        tap((user) => this.setUser(user)),
      );
  }

  login(request: LoginRequest): Observable<User> {
    return this.http
      .post<AuthResponse>(`${this.baseUrl}/login`, request, { context: this.expectedAuthFailure() })
      .pipe(
        map(({ user }) => user),
        tap((user) => this.setUser(user)),
      );
  }

  /** Starts a temporary guest session; no credentials needed. */
  continueAsGuest(): Observable<User> {
    return this.http
      .post<AuthResponse>(`${this.baseUrl}/guest`, null, { context: this.expectedAuthFailure() })
      .pipe(
        map(({ user }) => user),
        tap((user) => this.setUser(user)),
      );
  }

  register(request: RegisterRequest): Observable<User> {
    return this.http
      .post<AuthResponse>(`${this.baseUrl}/register`, request, {
        context: this.expectedAuthFailure(),
      })
      .pipe(
        map(({ user }) => user),
        tap((user) => this.setUser(user)),
      );
  }

  /**
   * Ends the session on the server and locally. Local state is cleared even if the request
   * fails so the user is never left looking at protected data.
   */
  logout(): Observable<void> {
    return this.http
      .post<void>(`${this.baseUrl}/logout`, null, { context: this.expectedAuthFailure() })
      .pipe(
        catchError((error: unknown) => {
          // A 401 here just means the session was already gone.
          if (toApiError(error).kind !== 'unauthorized') {
            console.warn('Logout request failed; local session cleared anyway.', error);
          }
          return of(undefined);
        }),
        finalize(() => {
          this.setUser(null);
          void this.router.navigate(['/login']);
        }),
      );
  }

  /** Called when any protected API call returns 401. */
  handleSessionExpired(returnUrl: string): void {
    if (this._status() !== 'authenticated') {
      return;
    }
    this.setUser(null);
    void this.router.navigate(['/login'], {
      queryParams: { reason: 'session-expired', returnUrl },
    });
  }

  private setUser(user: User | null): void {
    this._user.set(user);
    this._status.set(user ? 'authenticated' : 'anonymous');
  }

  private expectedAuthFailure(): HttpContext {
    return new HttpContext().set(SKIP_SESSION_EXPIRY, true);
  }
}
