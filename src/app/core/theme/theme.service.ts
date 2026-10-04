import { DOCUMENT, Service, effect, inject, linkedSignal } from '@angular/core';
import type { User } from '../auth/auth.models';
import { AuthService } from '../auth/auth.service';

export type Theme = 'light' | 'dark';

/**
 * Last theme shown on this device. Read by the inline script in `index.html` so the first paint
 * (including the login page) already uses the right theme — keep the key in sync with it.
 */
const DEVICE_THEME_KEY = 'contentReview.theme';
const userThemeKey = (userId: string) => `contentReview.theme.user.${userId}`;

function readTheme(key: string): Theme | null {
  try {
    const value = localStorage.getItem(key);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function writeTheme(key: string, theme: Theme): void {
  try {
    localStorage.setItem(key, theme);
  } catch {
    // Storage unavailable (private mode etc.) — the preference just won't persist.
  }
}

/**
 * Light/dark appearance. Each signed-in user's choice is remembered separately in this browser;
 * with no saved choice the last theme used on the device (or the OS preference) applies.
 */
@Service()
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly auth = inject(AuthService);

  private readonly _theme = linkedSignal<User | null, Theme>({
    source: this.auth.user,
    // Switching user loads their saved theme; otherwise keep what is currently shown.
    computation: (user, previous) =>
      (user && readTheme(userThemeKey(user.id))) ?? previous?.value ?? this.deviceTheme(),
  });
  readonly theme = this._theme.asReadonly();

  constructor() {
    effect(() => {
      const theme = this._theme();
      const root = this.document.documentElement;
      root.classList.toggle('dark', theme === 'dark');
      root.style.colorScheme = theme;
      writeTheme(DEVICE_THEME_KEY, theme);
    });
  }

  toggle(): void {
    const next: Theme = this._theme() === 'dark' ? 'light' : 'dark';
    this._theme.set(next);
    const user = this.auth.user();
    if (user) {
      writeTheme(userThemeKey(user.id), next);
    }
  }

  private deviceTheme(): Theme {
    const prefersDark =
      this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    return readTheme(DEVICE_THEME_KEY) ?? (prefersDark ? 'dark' : 'light');
  }
}
