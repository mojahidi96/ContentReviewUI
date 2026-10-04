import { HttpContextToken } from '@angular/common/http';

/** Per-request timeout override in milliseconds. `null` means "use the configured default". */
export const REQUEST_TIMEOUT_MS = new HttpContextToken<number | null>(() => null);

/**
 * Marks requests whose 401 responses are an expected outcome (login, session probe) and must
 * not trigger the global "session expired" redirect.
 */
export const SKIP_SESSION_EXPIRY = new HttpContextToken<boolean>(() => false);
