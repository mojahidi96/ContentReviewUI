import { HttpClient, HttpContext } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, finalize, map, of, shareReplay, tap } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { SKIP_SESSION_EXPIRY } from '../http/http-context';
import type { CsrfResponseDto } from './auth.models';

/**
 * Holds the CSRF token for Node's signed double-submit protection.
 *
 * The CSRF cookie is HttpOnly, so the token can only come from a JSON response
 * (`GET /auth/csrf`, or login/register). It lives in memory only — never in Web Storage — and
 * is bound to the session, so it must be replaced on login/register and re-fetched after logout.
 */
@Service()
export class CsrfService {
  private readonly http = inject(HttpClient);
  readonly url = `${inject(APP_CONFIG).apiBaseUrl}/auth/csrf`;

  private token: string | null = null;
  private inFlight: Observable<string> | null = null;

  /** The current token, fetching one first if there is none. Concurrent callers share one request. */
  ensureToken(): Observable<string> {
    return this.token !== null ? of(this.token) : this.refresh();
  }

  /** Always fetches a new token (e.g. after logout or a `403 CSRF_INVALID`). */
  refresh(): Observable<string> {
    if (this.inFlight) {
      return this.inFlight;
    }
    this.token = null;
    this.inFlight = this.http
      .get<CsrfResponseDto>(this.url, {
        context: new HttpContext().set(SKIP_SESSION_EXPIRY, true),
      })
      .pipe(
        map(({ csrfToken }) => csrfToken),
        tap((token) => (this.token = token)),
        finalize(() => (this.inFlight = null)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    return this.inFlight;
  }

  /** Stores a token returned by login/register. */
  set(token: string): void {
    this.token = token;
  }

  clear(): void {
    this.token = null;
  }
}
