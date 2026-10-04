import { ElementRef, Injector, afterNextRender } from '@angular/core';

/** After the next render, moves focus to the first control marked `aria-invalid="true"`. */
export function focusFirstInvalid(host: ElementRef<HTMLElement>, injector: Injector): void {
  afterNextRender(
    () => host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
    { injector },
  );
}
