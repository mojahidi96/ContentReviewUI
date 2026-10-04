import { Component, ElementRef, effect, input, output, viewChild } from '@angular/core';
import { ButtonDirective, type ButtonVariant } from './button.directive';

/**
 * Modal confirmation built on the native `<dialog>` element, which provides focus trapping,
 * Escape-to-close and an accessible modal role without extra libraries.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [ButtonDirective],
  template: `
    <dialog
      #dialog
      class="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl bg-white p-0 shadow-xl backdrop:bg-slate-900/50 dark:bg-slate-900 dark:ring-1 dark:ring-slate-700 dark:backdrop:bg-slate-950/70"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="messageId"
      (cancel)="onCancel($event)"
    >
      <div class="p-6">
        <h2 [id]="titleId" class="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {{ title() }}
        </h2>
        <div [id]="messageId" class="mt-2 text-sm text-slate-700 dark:text-slate-300">
          <ng-content />
        </div>
      </div>
      <div class="flex justify-end gap-3 rounded-b-xl bg-slate-50 px-6 py-4 dark:bg-slate-800/50">
        <button type="button" appButton variant="secondary" (click)="cancelled.emit()">
          {{ cancelLabel() }}
        </button>
        <button type="button" appButton [variant]="confirmVariant()" (click)="confirmed.emit()">
          {{ confirmLabel() }}
        </button>
      </div>
    </dialog>
  `,
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
