import { Component, inject } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faChevronDown, faMicrochip } from '@fortawesome/free-solid-svg-icons';
import { Spinner } from '../../../shared/components/spinner/spinner';
import { ModelSelection } from '../model-selection';

/**
 * "gemini-3.6-flash" → "Gemini 3.6 Flash". Anything that does not look like a plain
 * lowercase id is shown exactly as the server sent it.
 */
export function modelLabel(id: string): string {
  if (!/^[a-z][a-z0-9]*(-[a-z0-9.]+)+$/.test(id)) return id;
  return id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** "Model" dropdown next to the review button. Never blocks reviewing when the list fails. */
@Component({
  selector: 'app-model-picker',
  imports: [FaIconComponent, Spinner],
  host: { class: 'block' },
  templateUrl: './model-picker.html',
  styleUrl: './model-picker.scss',
})
export class ModelPicker {
  protected readonly models = inject(ModelSelection);
  protected readonly chipIcon = faMicrochip;
  protected readonly chevronIcon = faChevronDown;
  protected readonly label = modelLabel;

  protected choose(event: Event): void {
    this.models.select((event.target as HTMLSelectElement).value);
  }
}
