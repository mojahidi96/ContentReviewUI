import { Component, computed, inject } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faCircleCheck,
  faCircleExclamation,
  faCircleInfo,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import {
  NotificationService,
  type NotificationKind,
} from '../../core/notifications/notification.service';

const STYLES: Record<
  NotificationKind,
  { classes: string; icon: typeof faCircleInfo; label: string }
> = {
  success: {
    classes: 'border-emerald-300 text-emerald-900 dark:border-emerald-500/40 dark:text-emerald-200',
    icon: faCircleCheck,
    label: 'Success',
  },
  error: {
    classes: 'border-red-300 text-red-900 dark:border-red-500/40 dark:text-red-200',
    icon: faCircleExclamation,
    label: 'Error',
  },
  info: {
    classes: 'border-sky-300 text-sky-900 dark:border-sky-500/40 dark:text-sky-200',
    icon: faCircleInfo,
    label: 'Info',
  },
};

/**
 * Renders global notifications. The live regions are always in the DOM (only their children
 * change) so screen readers announce reliably: errors assertively, everything else politely.
 */
@Component({
  selector: 'app-toast-outlet',
  imports: [FaIconComponent],
  host: {
    class:
      'pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4',
  },
  template: `
    @for (region of regions(); track region.politeness) {
      <div [attr.aria-live]="region.politeness" class="flex w-full flex-col items-end gap-2">
        @for (n of region.items; track n.id) {
          <div
            class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-white p-3 shadow-lg sm:w-96 dark:bg-slate-900"
            [class]="styles[n.kind].classes"
          >
            <fa-icon [icon]="styles[n.kind].icon" class="mt-0.5" />
            <p class="flex-1 text-sm">
              <span class="sr-only">{{ styles[n.kind].label }}: </span>{{ n.message }}
            </p>
            <button
              type="button"
              class="-m-1 rounded-md p-1 text-slate-500 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-focus dark:text-slate-400 dark:hover:text-slate-200"
              aria-label="Dismiss notification"
              (click)="notifications.dismiss(n.id)"
            >
              <fa-icon [icon]="closeIcon" />
            </button>
          </div>
        }
      </div>
    }
  `,
})
export class ToastOutlet {
  protected readonly notifications = inject(NotificationService);
  protected readonly styles = STYLES;
  protected readonly closeIcon = faXmark;

  protected readonly regions = computed(() => {
    const all = this.notifications.notifications();
    return [
      { politeness: 'polite', items: all.filter((n) => n.kind !== 'error') },
      { politeness: 'assertive', items: all.filter((n) => n.kind === 'error') },
    ];
  });
}
