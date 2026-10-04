import { Component, input } from '@angular/core';

/** Decorative spinner. Pass `label` when the spinner is the only indication of progress. */
@Component({
  selector: 'app-spinner',
  host: { class: 'inline-flex items-center' },
  template: `
    <svg
      class="animate-spin motion-reduce:animate-none"
      [class]="size() === 'sm' ? 'size-4' : 'size-6'"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
    @if (label()) {
      <span class="sr-only">{{ label() }}</span>
    }
  `,
})
export class Spinner {
  readonly size = input<'sm' | 'md'>('sm');
  readonly label = input<string>();
}
