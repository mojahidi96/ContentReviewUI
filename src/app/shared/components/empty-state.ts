import { Component, input } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

@Component({
  selector: 'app-empty-state',
  imports: [FaIconComponent],
  host: { class: 'flex flex-col items-center px-6 py-10 text-center' },
  template: `
    <span
      class="mb-3 flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
    >
      <fa-icon [icon]="icon()" size="lg" />
    </span>
    <h3 class="text-sm font-semibold text-slate-900 dark:text-slate-100">{{ heading() }}</h3>
    <div class="mt-1 max-w-xs text-sm text-slate-600 dark:text-slate-400"><ng-content /></div>
    <div class="mt-4"><ng-content select="[emptyStateAction]" /></div>
  `,
})
export class EmptyState {
  readonly icon = input.required<IconDefinition>();
  readonly heading = input.required<string>();
}
