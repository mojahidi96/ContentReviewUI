import { Component, input } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'violet' | 'brand';

const TONES: Record<BadgeTone, string> = {
  neutral:
    'bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600',
  info: 'bg-sky-50 text-sky-800 ring-sky-300 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-500/40',
  success:
    'bg-emerald-50 text-emerald-800 ring-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/40',
  warning:
    'bg-amber-50 text-amber-900 ring-amber-300 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/40',
  danger:
    'bg-red-50 text-red-800 ring-red-300 dark:bg-red-500/10 dark:text-red-200 dark:ring-red-500/40',
  violet:
    'bg-violet-50 text-violet-800 ring-violet-300 dark:bg-violet-500/10 dark:text-violet-200 dark:ring-violet-500/40',
  brand:
    'bg-brand-50 text-brand-800 ring-brand-300 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-400/40',
};

/** Small status label. Always carries text so meaning never depends on colour alone. */
@Component({
  selector: 'app-badge',
  imports: [FaIconComponent],
  host: {
    class:
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
    '[class]': 'toneClass()',
  },
  template: `
    @if (icon(); as icon) {
      <fa-icon [icon]="icon" class="text-[0.7rem]" />
    }
    <ng-content />
  `,
})
export class Badge {
  readonly tone = input<BadgeTone>('neutral');
  readonly icon = input<IconDefinition>();

  protected toneClass(): string {
    return TONES[this.tone()];
  }
}
