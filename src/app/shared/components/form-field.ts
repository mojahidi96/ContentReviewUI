import { Component, input } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faCircleExclamation } from '@fortawesome/free-solid-svg-icons';

/**
 * Label + hint + error wrapper for a projected form control. The projected control must set
 * `id`, `aria-invalid` and `aria-describedby` using {@link describedBy}.
 */
@Component({
  selector: 'app-form-field',
  imports: [FaIconComponent],
  host: { class: 'block' },
  template: `
    <label
      [for]="controlId()"
      class="mb-1.5 block text-sm font-medium text-slate-800 dark:text-slate-200"
      >{{ label() }}</label
    >
    <ng-content />
    @if (hint()) {
      <p [id]="controlId() + '-hint'" class="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
        {{ hint() }}
      </p>
    }
    @if (error()) {
      <p
        [id]="controlId() + '-error'"
        class="mt-1.5 flex items-start gap-1.5 text-sm text-red-700 dark:text-red-400"
      >
        <fa-icon [icon]="errorIcon" class="mt-0.5" />
        <span>{{ error() }}</span>
      </p>
    }
  `,
})
export class FormField {
  readonly label = input.required<string>();
  readonly controlId = input.required<string>();
  readonly hint = input<string>();
  readonly error = input<string | null>(null);

  protected readonly errorIcon = faCircleExclamation;
}

/** Builds the `aria-describedby` value matching the ids rendered by {@link FormField}. */
export function describedBy(controlId: string, hasHint: boolean, hasError: boolean): string | null {
  const ids = [hasHint ? `${controlId}-hint` : null, hasError ? `${controlId}-error` : null].filter(
    Boolean,
  );
  return ids.length ? ids.join(' ') : null;
}

export const INPUT_CLASSES =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ' +
  'placeholder:text-slate-400 focus:border-brand-600 focus:outline-2 focus:outline-offset-0 focus:outline-brand-600/30 dark:placeholder:text-slate-500 dark:focus:outline-brand-400/40 ' +
  'aria-invalid:border-red-600 aria-invalid:focus:outline-red-600/30';
