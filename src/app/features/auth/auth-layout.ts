import { Component, input } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faShieldHalved,
  faSpellCheck,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons';

/** Two-column frame shared by the login and registration pages. */
@Component({
  selector: 'app-auth-layout',
  imports: [FaIconComponent],
  host: { class: 'flex min-h-dvh bg-white dark:bg-slate-950' },
  template: `
    <aside
      class="relative hidden w-[42%] flex-col justify-between bg-slate-900 p-12 text-slate-100 lg:flex"
    >
      <p class="flex items-center gap-2 text-lg font-semibold text-white">
        <span class="flex size-8 items-center justify-center rounded-lg bg-brand-500">
          <fa-icon [icon]="logoIcon" />
        </span>
        ContentReview
      </p>
      <div>
        <h2 class="text-3xl leading-tight font-semibold text-white">
          Ship clear, professional writing — with a reviewer that never sleeps.
        </h2>
        <ul class="mt-8 space-y-4 text-slate-300">
          <li class="flex gap-3">
            <fa-icon [icon]="aiIcon" class="mt-1 text-brand-300" />AI-assisted spelling, grammar and
            tone checks
          </li>
          <li class="flex gap-3">
            <fa-icon [icon]="shieldIcon" class="mt-1 text-brand-300" />You stay in control: nothing
            changes without your approval
          </li>
        </ul>
      </div>
      <p class="text-sm text-slate-400 dark:text-slate-500">Portfolio demo · sample data only</p>
    </aside>
    <main class="flex flex-1 items-center justify-center px-4 py-12 sm:px-8">
      <div class="w-full max-w-md">
        <p
          class="mb-8 flex items-center gap-2 text-lg font-semibold text-slate-900 lg:hidden dark:text-slate-100"
        >
          <span class="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <fa-icon [icon]="logoIcon" />
          </span>
          ContentReview
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {{ heading() }}
        </h1>
        <p class="mt-2 text-sm text-slate-600 dark:text-slate-400">{{ subheading() }}</p>
        <div class="mt-8"><ng-content /></div>
      </div>
    </main>
  `,
})
export class AuthLayout {
  readonly heading = input.required<string>();
  readonly subheading = input.required<string>();

  protected readonly logoIcon = faSpellCheck;
  protected readonly aiIcon = faWandMagicSparkles;
  protected readonly shieldIcon = faShieldHalved;
}
