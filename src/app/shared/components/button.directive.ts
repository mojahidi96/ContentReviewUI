import { Directive, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ' +
  'disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-action text-white shadow-sm hover:bg-action-hover disabled:hover:bg-action',
  secondary:
    'border border-slate-200 bg-white text-slate-700 shadow-xs hover:bg-slate-50 disabled:hover:bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:disabled:hover:bg-slate-900',
  ghost:
    'text-slate-700 hover:bg-slate-100 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800',
  danger: 'bg-negative text-white shadow-sm hover:bg-negative-hover disabled:hover:bg-negative',
  success: 'bg-positive text-white shadow-sm hover:bg-positive-hover disabled:hover:bg-positive',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-base',
};

/** Applies the design-system button styles to a native `<button>` or `<a>`. */
@Directive({
  selector: 'button[appButton], a[appButton]',
  host: { '[class]': 'classes()' },
})
export class ButtonDirective {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');

  protected readonly classes = computed(
    () => `${BASE} ${VARIANTS[this.variant()]} ${SIZES[this.size()]}`,
  );
}
