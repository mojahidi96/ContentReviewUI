/** `author`: edits content and runs/acts on reviews. `reader`: read-only access. */
export type UserRole = 'author' | 'reader';

export interface User {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly role: UserRole;
  /** Present on temporary guest accounts, which have no email and are deleted on sign-out. */
  readonly guest?: true;
}

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
}

export interface RegisterRequest {
  readonly fullName: string;
  readonly email: string;
  readonly password: string;
}

/** Body of `POST /auth/login`, `POST /auth/register`, `POST /auth/guest` and `GET /auth/me`. */
export interface AuthResponse {
  readonly user: User;
}

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';
