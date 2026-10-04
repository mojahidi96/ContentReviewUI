/** `author`: edits content and runs/acts on reviews. `reader`: read-only access. */
export type UserRole = 'author' | 'reader';

/** The signed-in user as the UI sees it (mapped from {@link UserDto}). */
export interface User {
  readonly id: string;
  /** Node's `displayName`. */
  readonly fullName: string;
  readonly email: string;
  /**
   * Node does not send a role (every account may create reviews), so a missing role maps to
   * `author`. An explicit `reader` from the backend still makes the UI read-only.
   */
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

// ---------------------------------------------------------------- wire format (Node v1)

/** `User` as returned by Node. `role` and `guest` are proposed extensions Node does not send. */
export interface UserDto {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly role?: UserRole;
  readonly guest?: boolean;
}

/** Body of `POST /auth/register`. */
export interface RegisterRequestDto {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

/** Body of `GET /auth/me`. */
export interface MeResponseDto {
  readonly user: UserDto;
}

/** Body of `POST /auth/login`, `POST /auth/register` (and the proposed `POST /auth/guest`). */
export interface SessionResponseDto {
  readonly user: UserDto;
  /** CSRF token bound to the new session; replaces the pre-login token. */
  readonly csrfToken: string;
}

/** Body of `GET /auth/csrf`. */
export interface CsrfResponseDto {
  readonly csrfToken: string;
}

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

export function toUser(dto: UserDto): User {
  return {
    id: dto.id,
    fullName: dto.displayName,
    email: dto.email,
    role: dto.role === 'reader' ? 'reader' : 'author',
    ...(dto.guest ? { guest: true as const } : {}),
  };
}
