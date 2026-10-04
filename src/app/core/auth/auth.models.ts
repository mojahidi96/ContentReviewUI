/** `author`: edits content and runs/acts on reviews. `reader`: read-only access. */
export type UserRole = 'author' | 'reader';

export interface User {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly role: UserRole;
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

/** Body of `POST /auth/login`, `POST /auth/register` and `GET /auth/me`. */
export interface AuthResponse {
  readonly user: User;
}

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';
