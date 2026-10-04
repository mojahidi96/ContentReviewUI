import { HttpClient, HttpContext } from '@angular/common/http';
import { Service, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, map, of, tap } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { toApiError } from '../http/api-error';
import { SKIP_SESSION_EXPIRY } from '../http/http-context';
import {
  toUser,
  type AuthStatus,
  type LoginRequest,
  type MeResponseDto,
  type RegisterRequest,
  type RegisterRequestDto,
  type SessionResponseDto,
  type User,
} from './auth.models';
import { CsrfService } from './csrf.service';

/**
 * Single source of truth for the signed-in user.
 *
 * The session itself is an HttpOnly cookie holding a JWT that only Node can read, so this service
 * never sees or stores a token: it only mirrors "who am I" for the UI. Route guards built on it are
 * a UX convenience — the backend enforces authorization on every request.
 */
@Service()
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly csrf = inject(CsrfService);
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
      .get<MeResponseDto>(`${this.baseUrl}/me`, { context: this.expectedAuthFailure() })
      .pipe(
        map(({ user }) => toUser(user)),
        catchError(() => of(null)),
        tap((user) => this.setUser(user)),
      );
  }

  login(request: LoginRequest): Observable<User> {
    return this.startSession(
      this.http.post<SessionResponseDto>(`${this.baseUrl}/login`, request, {
        context: this.expectedAuthFailure(),
      }),
    );
  }

  register(request: RegisterRequest): Observable<User> {
    const body: RegisterRequestDto = {
      email: request.email,
      password: request.password,
      displayName: request.fullName,
    };
    return this.startSession(
      this.http.post<SessionResponseDto>(`${this.baseUrl}/register`, body, {
        context: this.expectedAuthFailure(),
      }),
    );
  }

  /**
   * Starts a temporary guest session. **Not part of the Node contract** — only the mock API
   * implements `POST /auth/guest`; the UI hides the option unless `features.guestLogin` is on.
   */
  continueAsGuest(): Observable<User> {
    return this.startSession(
      this.http.post<SessionResponseDto>(`${this.baseUrl}/guest`, null, {
        context: this.expectedAuthFailure(),
      }),
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
            console.warn('Logout request failed; local session cleared anyway.');
          }
          return of(undefined);
        }),
        finalize(() => {
          // The token was bound to the old session; the next unsafe request fetches a new one.
          this.csrf.clear();
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
    this.csrf.clear();
    this.setUser(null);
    void this.router.navigate(['/login'], {
      queryParams: { reason: 'session-expired', returnUrl },
    });
  }

  private startSession(request: Observable<SessionResponseDto>): Observable<User> {
    return request.pipe(
      tap(({ csrfToken }) => this.csrf.set(csrfToken)),
      map(({ user }) => toUser(user)),
      tap((user) => this.setUser(user)),
    );
  }

  private setUser(user: User | null): void {
    this._user.set(user);
    this._status.set(user ? 'authenticated' : 'anonymous');
  }

  private expectedAuthFailure(): HttpContext {
    return new HttpContext().set(SKIP_SESSION_EXPIRY, true);
  }
}
