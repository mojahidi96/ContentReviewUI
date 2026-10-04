import { Service, signal } from '@angular/core';

export type NotificationKind = 'success' | 'error' | 'info';

export interface AppNotification {
  readonly id: number;
  readonly kind: NotificationKind;
  readonly message: string;
}

const AUTO_DISMISS_MS: Readonly<Record<NotificationKind, number>> = {
  success: 4_000,
  info: 5_000,
  error: 8_000,
};

const MAX_VISIBLE = 4;

/** Signal-backed toast queue rendered by `ToastOutlet`. */
@Service()
export class NotificationService {
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly _notifications = signal<readonly AppNotification[]>([]);
  readonly notifications = this._notifications.asReadonly();

  success(message: string): void {
    this.show('success', message);
  }

  error(message: string): void {
    this.show('error', message);
  }

  info(message: string): void {
    this.show('info', message);
  }

  dismiss(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this._notifications.update((list) => list.filter((n) => n.id !== id));
  }

  private show(kind: NotificationKind, message: string): void {
    // Collapse identical consecutive messages instead of stacking duplicates.
    const last = this._notifications().at(-1);
    if (last?.kind === kind && last.message === message) {
      return;
    }
    const notification: AppNotification = { id: this.nextId++, kind, message };
    this._notifications.update((list) => [...list, notification].slice(-MAX_VISIBLE));
    this.timers.set(
      notification.id,
      setTimeout(() => this.dismiss(notification.id), AUTO_DISMISS_MS[kind]),
    );
  }
}
