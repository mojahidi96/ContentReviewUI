import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { ContentReviewApiService } from './content-review-api.service';
import type { ReviewFailure, ReviewModels } from './review.models';

export type ModelListStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface ModelOption {
  readonly id: string;
  readonly isDefault: boolean;
  /** The model's quota ran out; it cannot be chosen until it resets. */
  readonly quotaReached: boolean;
}

/** The model a failed review ran on: the one named by the quota error, else its own, else the default. */
export function failedModelOf(failure: ReviewFailure, defaultModel: string | null): string | null {
  return failure.quota?.model ?? failure.model ?? defaultModel;
}

/** Longest delay `setTimeout` accepts. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Which AI model the next review uses. The list comes from `GET /reviews/models`; when that
 * fails the picker is hidden and reviews are sent without a `model` (the service default), so
 * a broken list never blocks reviewing. Scoped to the workspace like the review store.
 */
@Injectable()
export class ModelSelection {
  private readonly api = inject(ContentReviewApiService);
  private readonly auth = inject(AuthService);

  private readonly _status = signal<ModelListStatus>('idle');
  private readonly _list = signal<ReviewModels | null>(null);
  private readonly _selected = signal<string | null>(null);
  /** model → reset time in epoch ms, or `null` when unknown (cleared by the next success). */
  private readonly _quotaReached = signal<ReadonlyMap<string, number | null>>(new Map());
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  readonly status = this._status.asReadonly();
  readonly defaultModel = computed(() => this._list()?.defaultModel ?? null);

  readonly options = computed<readonly ModelOption[]>(() => {
    const list = this._list();
    const reached = this._quotaReached();
    return (list?.models ?? []).map((id) => ({
      id,
      isDefault: id === list?.defaultModel,
      quotaReached: reached.has(id),
    }));
  });

  /** The model shown as selected (the default until the user chooses another). */
  readonly selected = computed(() => this._selected() ?? this.defaultModel());

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timers.forEach((timer) => clearTimeout(timer)));
  }

  /** Loads the list and restores the remembered choice if it is still offered. */
  load(): void {
    if (this._status() === 'loading') return;
    this._status.set('loading');
    this.api.getModels().subscribe({
      next: (list) => {
        const remembered = this.readRemembered();
        this._list.set(list);
        this._selected.set(
          remembered && list.models.includes(remembered) ? remembered : list.defaultModel,
        );
        this._status.set('ready');
      },
      error: () => {
        this._list.set(null);
        this._selected.set(null);
        this._status.set('unavailable');
      },
    });
  }

  select(model: string): void {
    const option = this.options().find((o) => o.id === model);
    if (!option || option.quotaReached) return;
    this._selected.set(model);
    this.remember(model);
  }

  /** The `model` to send, or `undefined` for the default (or when the list is unavailable). */
  modelForRequest(): string | undefined {
    const selected = this._selected();
    return this._status() === 'ready' && selected && selected !== this.defaultModel()
      ? selected
      : undefined;
  }

  /** Records that a model's quota is used up, and moves off it if it was selected. */
  markQuotaReached(model: string, resetAtMs: number | null): void {
    this._quotaReached.update((map) => new Map(map).set(model, resetAtMs));
    clearTimeout(this.timers.get(model));
    if (resetAtMs !== null) {
      const wait = Math.min(Math.max(resetAtMs - Date.now(), 0), MAX_TIMER_MS);
      this.timers.set(
        model,
        setTimeout(() => this.clearQuota(model), wait),
      );
    }
    if (this._selected() === model) {
      this._selected.set(this.nextAvailable(model) ?? model);
    }
  }

  clearQuota(model: string): void {
    clearTimeout(this.timers.get(model));
    this.timers.delete(model);
    if (!this._quotaReached().has(model)) return;
    this._quotaReached.update((map) => {
      const next = new Map(map);
      next.delete(model);
      return next;
    });
  }

  /** Whether another model than `failedModel` could be used right now. */
  hasAlternative(failedModel: string | null): boolean {
    return this.nextAvailable(failedModel) !== null;
  }

  /**
   * Selects the next model after `failedModel` that still has quota (wrapping around the list).
   * Returns false when there is none, leaving the selection alone.
   */
  selectNextAvailable(failedModel: string | null): boolean {
    const next = this.nextAvailable(failedModel);
    if (next === null) return false;
    this.select(next);
    return true;
  }

  /** The server no longer offers the chosen model: back to the default, with a fresh list. */
  handleRejected(): void {
    this._selected.set(this.defaultModel());
    this._status.set('idle');
    this.load();
  }

  private nextAvailable(after: string | null): string | null {
    const options = this.options();
    const start = options.findIndex((o) => o.id === after);
    for (let step = 1; step <= options.length; step++) {
      const option = options[(start + step + options.length) % options.length];
      if (option.id !== after && !option.quotaReached) return option.id;
    }
    return null;
  }

  private storageKey(): string {
    return `contentReview.reviewModel.user.${this.auth.user()?.id ?? 'anonymous'}`;
  }

  private readRemembered(): string | null {
    try {
      return localStorage.getItem(this.storageKey());
    } catch {
      return null;
    }
  }

  private remember(model: string): void {
    try {
      localStorage.setItem(this.storageKey(), model);
    } catch {
      // Storage unavailable: the choice just won't survive a reload.
    }
  }
}
