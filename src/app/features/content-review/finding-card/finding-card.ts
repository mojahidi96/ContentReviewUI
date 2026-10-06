import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faCheck,
  faChevronDown,
  faRotateLeft,
  faWandMagicSparkles,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { Badge } from '../../../shared/components/badge';
import { ButtonDirective } from '../../../shared/components/button.directive';
import { SEVERITY_META, STATUS_META, categoryMeta } from '../finding-meta';
import type { Finding } from '../review.models';
import type { FindingActions } from '../review.store';

const NO_ACTIONS: FindingActions = {
  applied: false,
  canAccept: false,
  canUndo: false,
  canDismiss: false,
  note: null,
};

/**
 * One finding as an accordion item. The header only expands/collapses; clicking the body
 * highlights the finding in the document.
 */
@Component({
  selector: 'app-finding-card',
  imports: [NgTemplateOutlet, FaIconComponent, Badge, ButtonDirective],
  host: {
    class: 'block rounded-xl border bg-white shadow-sm transition-colors dark:bg-slate-900',
    '[class.border-brand-500]': 'active()',
    '[class.ring-1]': 'active()',
    '[class.ring-brand-500]': 'active()',
    '[class.border-slate-200]': '!active()',
    '[class.dark:border-slate-800]': '!active()',
    '[attr.aria-busy]': 'busy()',
    '(click)': 'onCardClick($event)',
  },
  templateUrl: './finding-card.html',
  styleUrl: './finding-card.scss',
})
export class FindingCard {
  readonly finding = input.required<Finding>();
  readonly actions = input<FindingActions>(NO_ACTIONS);
  readonly active = input(false);
  readonly busy = input(false);
  readonly expanded = input(true);

  readonly selected = output();
  readonly acceptRequested = output();
  readonly undoRequested = output();
  readonly dismissRequested = output();
  readonly expandedToggle = output();

  protected readonly category = computed(() => categoryMeta(this.finding().category));
  protected readonly severity = computed(() => SEVERITY_META[this.finding().severity]);
  protected readonly status = computed(() => STATUS_META[this.finding().status]);
  protected readonly bodyId = computed(() => `finding-body-${this.finding().id}`);
  /** Only findings the document can highlight (located, not saved or dismissed) are selectable. */
  protected readonly selectable = computed(() => {
    const { range, status } = this.finding();
    return !!range && (status === 'pending' || status === 'accepted');
  });

  protected readonly aiIcon = faWandMagicSparkles;
  protected readonly chevronIcon = faChevronDown;
  protected readonly acceptIcon = faCheck;
  protected readonly undoIcon = faRotateLeft;
  protected readonly dismissIcon = faXmark;

  /**
   * Pointer shortcut: clicking the card body highlights the finding. The header (expand/collapse)
   * and the body's own controls are excluded; keyboard users use the "Original" button.
   */
  protected onCardClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (
      !this.selectable() ||
      !target?.closest('[data-card-body]') ||
      target.closest('button, a, select, input, textarea')
    ) {
      return;
    }
    this.selected.emit();
  }
}
