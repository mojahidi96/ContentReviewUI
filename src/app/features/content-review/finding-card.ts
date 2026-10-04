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
import { Badge } from '../../shared/components/badge';
import { ButtonDirective } from '../../shared/components/button.directive';
import { SEVERITY_META, STATUS_META, categoryMeta } from './finding-meta';
import type { Finding } from './review.models';
import type { FindingActions } from './review.store';

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
  template: `
    <h3>
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        [attr.aria-expanded]="expanded()"
        [attr.aria-controls]="bodyId()"
        (click)="expandedToggle.emit()"
      >
        <fa-icon
          [icon]="chevronIcon"
          class="shrink-0 text-xs text-slate-500 transition-transform motion-reduce:transition-none dark:text-slate-400"
          [class.-rotate-90]="!expanded()"
        />
        <app-badge class="shrink-0" [tone]="category().tone" [icon]="category().icon">{{
          category().label
        }}</app-badge>
        <span class="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-slate-100"
          >“{{ finding().excerpt }}”</span
        >
        <app-badge class="shrink-0" [tone]="status().tone" [icon]="status().icon">
          <span class="sr-only">Status: </span>{{ status().label }}
        </app-badge>
      </button>
    </h3>

    <ng-template #excerpt>
      <q class="font-medium not-italic">{{ finding().excerpt }}</q>
    </ng-template>

    <div
      [id]="bodyId()"
      class="border-t border-slate-200 px-4 pt-3 pb-4 dark:border-slate-800"
      [class.cursor-pointer]="selectable()"
      data-card-body
      [hidden]="!expanded()"
    >
      <app-badge [tone]="severity().tone" [icon]="severity().icon"
        >{{ severity().label }} severity</app-badge
      >

      <dl class="mt-3 grid grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-2 text-sm">
        <div class="contents">
          <dt
            class="shrink-0 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
          >
            Original:
          </dt>
          <dd class="min-w-0 text-slate-900 dark:text-slate-100">
            @if (selectable()) {
              <!-- The card body is clickable for pointer users; this is the keyboard/AT control. -->
              <button
                type="button"
                class="-m-0.5 rounded-md p-0.5 text-left focus-visible:outline-2 focus-visible:outline-focus"
                [attr.aria-pressed]="active()"
                (click)="selected.emit()"
              >
                <span class="sr-only">Highlight in document: </span>
                <ng-container [ngTemplateOutlet]="excerpt" />
              </button>
            } @else {
              <ng-container [ngTemplateOutlet]="excerpt" />
            }
          </dd>
        </div>

        @if (finding().suggestion !== undefined) {
          <div class="contents">
            <dt
              class="flex shrink-0 items-center gap-1.5 text-xs font-semibold tracking-wide text-emerald-800 uppercase dark:text-emerald-300"
            >
              <fa-icon [icon]="aiIcon" /><span
                >Improved<span class="sr-only"> (AI suggestion)</span>:</span
              >
            </dt>
            <dd class="min-w-0 font-medium text-slate-900 dark:text-slate-100">
              @if (finding().suggestion) {
                {{ finding().suggestion }}
              } @else {
                <span class="italic">Remove this text</span>
              }
            </dd>
          </div>
        }

        <div class="contents">
          <dt
            class="shrink-0 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
          >
            Explanation:
          </dt>
          <dd [id]="'finding-' + finding().id" class="min-w-0 text-slate-700 dark:text-slate-300">
            {{ finding().explanation }}
          </dd>
        </div>
      </dl>

      @if (actions().note; as note) {
        <p class="mt-3 text-xs text-slate-600 dark:text-slate-400">{{ note }}</p>
      }

      @if (finding().status !== 'resolved') {
        <div class="mt-3 flex justify-end gap-2">
          @if (finding().status === 'pending' && !actions().applied) {
            <button
              type="button"
              appButton
              variant="ghost"
              size="sm"
              class="mr-auto"
              [disabled]="!actions().canDismiss"
              (click)="dismissRequested.emit()"
            >
              <fa-icon [icon]="dismissIcon" /> Dismiss
            </button>
          }
          <button
            type="button"
            appButton
            variant="secondary"
            size="sm"
            [disabled]="!actions().canUndo"
            (click)="undoRequested.emit()"
          >
            <fa-icon [icon]="undoIcon" /> Undo
          </button>
          <button
            type="button"
            appButton
            variant="success"
            size="sm"
            [disabled]="!actions().canAccept"
            (click)="acceptRequested.emit()"
          >
            <fa-icon [icon]="acceptIcon" /> Accept
          </button>
        </div>
      }
    </div>
  `,
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
