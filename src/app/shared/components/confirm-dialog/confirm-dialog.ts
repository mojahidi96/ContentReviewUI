import { Component, ElementRef, effect, input, output, viewChild } from '@angular/core';
import { ButtonDirective, type ButtonVariant } from '../button.directive';

/**
 * Modal confirmation built on the native `<dialog>` element, which provides focus trapping,
 * Escape-to-close and an accessible modal role without extra libraries.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [ButtonDirective],
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.scss',
})
export class ConfirmDialog {
  private static nextId = 0;

  readonly open = input(false);
  readonly title = input.required<string>();
  readonly confirmLabel = input('Confirm');
  readonly cancelLabel = input('Cancel');
  readonly confirmVariant = input<ButtonVariant>('primary');

  readonly confirmed = output();
  readonly cancelled = output();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly uid = ConfirmDialog.nextId++;
  protected readonly titleId = `confirm-dialog-title-${this.uid}`;
  protected readonly messageId = `confirm-dialog-message-${this.uid}`;

  constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;
      if (this.open() && !dialog.open) {
        // `showModal` is missing in some test DOMs; fall back to the `open` attribute.
        if (typeof dialog.showModal === 'function') {
          dialog.showModal();
        } else {
          dialog.setAttribute('open', '');
        }
      } else if (!this.open() && dialog.open) {
        if (typeof dialog.close === 'function') {
          dialog.close();
        } else {
          dialog.removeAttribute('open');
        }
      }
    });
  }

  protected onCancel(event: Event): void {
    // Let the parent own the open state instead of the browser closing the dialog itself.
    event.preventDefault();
    this.cancelled.emit();
  }
}
