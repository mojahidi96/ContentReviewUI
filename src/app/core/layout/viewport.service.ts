import { DOCUMENT, DestroyRef, Service, inject, signal } from '@angular/core';

/** Tailwind `lg` breakpoint; must stay in sync with the layout classes in the workspace shell. */
const DESKTOP_QUERY = '(min-width: 1024px)';

/** Exposes viewport breakpoints as signals. */
@Service()
export class ViewportService {
  private readonly _isDesktop = signal(true);
  readonly isDesktop = this._isDesktop.asReadonly();

  constructor() {
    const media = inject(DOCUMENT).defaultView?.matchMedia?.(DESKTOP_QUERY);
    if (!media) {
      return;
    }
    this._isDesktop.set(media.matches);
    const onChange = (event: MediaQueryListEvent) => this._isDesktop.set(event.matches);
    media.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => media.removeEventListener('change', onChange));
  }
}
