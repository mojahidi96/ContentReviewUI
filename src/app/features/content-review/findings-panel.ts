import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faCircleCheck,
  faCircleExclamation,
  faFilter,
  faFloppyDisk,
  faMaximize,
  faMinimize,
  faRotateRight,
  faTriangleExclamation,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons';
import { ButtonDirective } from '../../shared/components/button.directive';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import { EmptyState } from '../../shared/components/empty-state';
import { Spinner } from '../../shared/components/spinner';
import { FindingCard } from './finding-card';
import { STATUS_META, categoryMeta } from './finding-meta';
import { FINDING_STATUSES, type FindingStatus } from './review.models';
import { ReviewStore } from './review.store';

@Component({
  selector: 'app-findings-panel',
  imports: [FaIconComponent, ButtonDirective, ConfirmDialog, EmptyState, Spinner, FindingCard],
  host: {
    class:
      'flex flex-col rounded-xl border border-slate-200 bg-slate-100/60 dark:border-slate-800 dark:bg-slate-900/60',
  },
  template: `
    <header class="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2
            id="findings-heading"
            class="text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            Findings
          </h2>
          @if (store.review()) {
            <p class="text-xs text-slate-600 dark:text-slate-400">
              {{ counts().total }} total · {{ counts().pending }} need review ·
              {{ counts().accepted }} accepted
            </p>
          }
        </div>
        @if (store.review()) {
          <button
            type="button"
            appButton
            size="sm"
            [disabled]="!store.hasUnsavedChanges() || store.isSaving()"
            (click)="saveOpen.set(true)"
          >
            @if (store.isSaving()) {
              <app-spinner />
            } @else {
              <fa-icon [icon]="saveIcon" />
            }
            Save Changes
            @if (store.acceptedChanges().length; as unsaved) {
              <span class="rounded-full bg-white/20 px-1.5 text-xs" aria-hidden="true">{{
                unsaved
              }}</span>
              <span class="sr-only">({{ unsaved }} unsaved)</span>
            }
          </button>
        }
      </div>
      @if (store.review() && !store.isLoading()) {
        <div class="mt-3 flex flex-wrap items-center gap-2">
          @if (store.visibleFindings().length) {
            <button type="button" appButton variant="secondary" size="sm" (click)="toggleAll()">
              <fa-icon [icon]="allExpanded() ? collapseAllIcon : expandAllIcon" />
              {{ allExpanded() ? 'Collapse all' : 'Expand all' }}
            </button>
          }
          <button
            type="button"
            appButton
            variant="secondary"
            size="sm"
            class="ml-auto"
            (click)="store.submit()"
          >
            <fa-icon [icon]="retryIcon" /> Re-run
          </button>
        </div>
      }
    </header>

    <p class="sr-only" aria-live="polite">{{ liveMessage() }}</p>

    <div
      class="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
      [attr.aria-busy]="store.isLoading()"
    >
      @if (store.validationError(); as validation) {
        <div
          class="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
          role="alert"
        >
          <fa-icon [icon]="warnIcon" class="mt-0.5" />
          <p>
            @if (validation === 'empty') {
              The document is empty. Add some content before running a review.
            } @else {
              The document is longer than {{ store.maxChars.toLocaleString() }} characters. Shorten
              it before running a review.
            }
          </p>
        </div>
      }

      @if (store.isLoading()) {
        <div
          class="flex items-center gap-3 rounded-lg border border-brand-200 bg-white p-4 text-sm text-slate-700 dark:border-brand-500/40 dark:bg-slate-900 dark:text-slate-300"
        >
          <app-spinner size="md" class="text-brand-600 dark:text-brand-400" />
          <div>
            <p class="font-medium text-slate-900 dark:text-slate-100">Reviewing your document…</p>
            <p class="text-xs text-slate-600 dark:text-slate-400">
              Checking spelling, grammar and language. This can take a few seconds.
            </p>
          </div>
        </div>
      }

      @if (store.phase() === 'error') {
        <div
          class="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"
          role="alert"
        >
          <p class="flex items-start gap-2 font-medium">
            <fa-icon [icon]="errorIcon" class="mt-0.5" /> Review failed
          </p>
          <p class="mt-1">{{ store.error() }}</p>
          <button
            type="button"
            appButton
            variant="secondary"
            size="sm"
            class="mt-3"
            (click)="store.retry()"
          >
            <fa-icon [icon]="retryIcon" /> Retry review
          </button>
        </div>
      }

      @if (store.review(); as review) {
        @if (store.isStale()) {
          <div
            class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
            role="status"
          >
            <p class="font-medium">The document has changed since this review.</p>
            <p class="mt-1">
              Highlights, Accept and Undo are turned off so nothing is changed in the wrong place.
            </p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                appButton
                size="sm"
                [disabled]="store.isLoading()"
                (click)="store.submit()"
              >
                Review current text
              </button>
              <button
                type="button"
                appButton
                variant="secondary"
                size="sm"
                (click)="restoreOpen.set(true)"
              >
                Restore reviewed text
              </button>
            </div>
          </div>
        }

        @if (counts().total === 0) {
          <app-empty-state [icon]="cleanIcon" heading="No issues found">
            The review did not find any spelling, grammar or language problems.
          </app-empty-state>
        } @else {
          <fieldset class="flex flex-wrap items-end gap-2">
            <legend class="sr-only">Filter findings</legend>
            <fa-icon
              [icon]="filterIcon"
              class="mb-2.5 text-xs text-slate-500 dark:text-slate-400"
            />
            <label class="flex flex-col text-xs font-medium text-slate-700 dark:text-slate-300">
              Category
              <select
                class="mt-1 h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-focus dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                [value]="store.filters().category"
                (change)="setCategory($event)"
              >
                <option value="all">All categories</option>
                @for (category of store.categories(); track category) {
                  <option [value]="category">{{ categoryLabel(category) }}</option>
                }
              </select>
            </label>
            <label class="flex flex-col text-xs font-medium text-slate-700 dark:text-slate-300">
              Status
              <select
                class="mt-1 h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-focus dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                [value]="store.filters().status"
                (change)="setStatus($event)"
              >
                <option value="all">All statuses</option>
                @for (status of statuses; track status) {
                  <option [value]="status">{{ statusLabel(status) }}</option>
                }
              </select>
            </label>
          </fieldset>

          @if (store.visibleFindings().length === 0) {
            <p
              class="rounded-lg bg-white p-4 text-center text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-400"
            >
              No findings match these filters.
            </p>
          } @else {
            <ul class="flex flex-col gap-3" aria-labelledby="findings-heading">
              @for (finding of store.visibleFindings(); track finding.id) {
                <li>
                  <app-finding-card
                    [finding]="finding"
                    [actions]="store.actionsFor(finding)"
                    [active]="finding.id === store.activeFindingId()"
                    [busy]="store.isSaving()"
                    [expanded]="!collapsedIds().has(finding.id)"
                    (expandedToggle)="toggleCard(finding.id)"
                    (selected)="store.selectFinding(finding.id)"
                    (acceptRequested)="store.accept(finding.id)"
                    (undoRequested)="store.undo(finding.id)"
                  />
                </li>
              }
            </ul>
          }
        }
        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Reviewed {{ review.contentLength.toLocaleString() }} characters. AI suggestions may be
          wrong — review each one before applying it.
        </p>
      } @else if (store.phase() === 'idle') {
        <app-empty-state [icon]="reviewIcon" heading="No review yet">
          Run Content Review to check the current document for spelling, grammar and inappropriate
          language.
          <button emptyStateAction type="button" appButton (click)="store.submit()">
            <fa-icon [icon]="reviewIcon" /> Run Content Review
          </button>
        </app-empty-state>
      }
    </div>

    <app-confirm-dialog
      [open]="saveOpen()"
      title="Save changes?"
      confirmLabel="Save Changes"
      (confirmed)="confirmSave()"
      (cancelled)="saveOpen.set(false)"
    >
      <p>
        @if (store.acceptedChanges().length === 1) {
          Your accepted change will be saved.
        } @else {
          All {{ store.acceptedChanges().length }} accepted changes will be saved.
        }
        Saved changes can’t be undone.
      </p>
    </app-confirm-dialog>

    <app-confirm-dialog
      [open]="restoreOpen()"
      title="Restore reviewed text?"
      confirmLabel="Restore text"
      confirmVariant="danger"
      (confirmed)="confirmRestore()"
      (cancelled)="restoreOpen.set(false)"
    >
      <p>
        Your current edits will be replaced with the text that was reviewed. This cannot be undone.
      </p>
    </app-confirm-dialog>
  `,
})
export class FindingsPanel {
  protected readonly store = inject(ReviewStore);
  protected readonly counts = this.store.counts;
  protected readonly statuses = FINDING_STATUSES;
  protected readonly saveOpen = signal(false);
  protected readonly restoreOpen = signal(false);

  /** Collapsed cards. Empty means all expanded, which is how every new review starts. */
  protected readonly collapsedIds = linkedSignal<unknown, ReadonlySet<string>>({
    source: this.store.review,
    computation: () => new Set(),
  });
  protected readonly allExpanded = computed(() =>
    this.store.visibleFindings().every((f) => !this.collapsedIds().has(f.id)),
  );

  protected readonly liveMessage = computed(() => {
    switch (this.store.phase()) {
      case 'loading':
        return 'Reviewing document.';
      case 'error':
        return 'Review failed.';
      case 'success':
        return `Review complete. ${this.counts().total} findings.`;
      default:
        return '';
    }
  });

  protected readonly reviewIcon = faWandMagicSparkles;
  protected readonly retryIcon = faRotateRight;
  protected readonly errorIcon = faCircleExclamation;
  protected readonly warnIcon = faTriangleExclamation;
  protected readonly cleanIcon = faCircleCheck;
  protected readonly filterIcon = faFilter;
  protected readonly saveIcon = faFloppyDisk;
  protected readonly expandAllIcon = faMaximize;
  protected readonly collapseAllIcon = faMinimize;

  protected categoryLabel(category: string): string {
    return categoryMeta(category).label;
  }

  protected statusLabel(status: FindingStatus): string {
    return STATUS_META[status].label;
  }

  protected setCategory(event: Event): void {
    this.store.setFilters({ category: (event.target as HTMLSelectElement).value });
  }

  protected setStatus(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const status = (FINDING_STATUSES as readonly string[]).includes(value)
      ? (value as FindingStatus)
      : 'all';
    this.store.setFilters({ status });
  }

  protected toggleCard(findingId: string): void {
    this.collapsedIds.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(findingId)) {
        next.add(findingId);
      }
      return next;
    });
  }

  protected toggleAll(): void {
    const collapse = this.allExpanded();
    const visible = this.store.visibleFindings().map((f) => f.id);
    this.collapsedIds.update((ids) => {
      const next = new Set(ids);
      for (const id of visible) {
        if (collapse) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  }

  protected confirmSave(): void {
    this.saveOpen.set(false);
    this.store.saveChanges();
  }

  protected confirmRestore(): void {
    this.restoreOpen.set(false);
    this.store.restoreReviewedContent();
  }
}
