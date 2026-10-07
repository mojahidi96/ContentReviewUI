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
  templateUrl: './auth-layout.html',
  styleUrl: './auth-layout.scss',
})
export class AuthLayout {
  readonly heading = input.required<string>();
  readonly subheading = input.required<string>();

  protected readonly logoIcon = faSpellCheck;
  protected readonly aiIcon = faWandMagicSparkles;
  protected readonly shieldIcon = faShieldHalved;
}
