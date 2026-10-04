import type { AppConfig } from '../app/core/config/app-config';
import { environment as development } from './environment.development';

/**
 * Development against the in-memory mock API (`npm run dev`). Identical to development except
 * that mock-only extensions, such as guest sign-in, are switched on.
 */
export const environment: AppConfig = {
  ...development,
  features: { guestLogin: true },
};
