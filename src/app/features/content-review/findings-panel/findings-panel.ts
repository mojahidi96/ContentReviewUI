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
import { ButtonDirective } from '../../../shared/components/button.directive';
import { ConfirmDialog } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { EmptyState } from '../../../shared/components/empty-state';
import { Spinner } from '../../../shared/components/spinner/spinner';
import { FindingCard } from '../finding-card/finding-card';
import { STATUS_META, categoryMeta } from '../finding-meta';
import { FINDING_STATUSES, type FindingStatus } from '../review.models';
import { ReviewStore } from '../review.store';

@Component({
  selector: 'app-findings-panel',
  imports: [FaIconComponent, ButtonDirective, ConfirmDialog, EmptyState, Spinner, FindingCard],
  host: {
    class:
      'flex flex-col rounded-xl border border-slate-200 bg-slate-100/60 dark:border-slate-800 dark:bg-slate-900/60',
  },
  templateUrl: './findings-panel.html',
  styleUrl: './findings-panel.scss',
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
