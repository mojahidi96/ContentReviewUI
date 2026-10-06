import { Component, input } from '@angular/core';

/** Decorative spinner. Pass `label` when the spinner is the only indication of progress. */
@Component({
  selector: 'app-spinner',
  host: { class: 'inline-flex items-center' },
  templateUrl: './spinner.html',
  styleUrl: './spinner.scss',
})
export class Spinner {
  readonly size = input<'sm' | 'md'>('sm');
  readonly label = input<string>();
}
