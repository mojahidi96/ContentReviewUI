import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faEye,
  faFileLines,
  faHighlighter,
  faPen,
  faRotateLeft,
} from '@fortawesome/free-solid-svg-icons';
import { Badge } from '../../shared/components/badge';
import { ButtonDirective } from '../../shared/components/button.directive';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import { HighlightedDocument } from '../content-review/highlighted-document';
import { ReviewStore } from '../content-review/review.store';
import { DocumentService } from './document.service';

@Component({
  selector: 'app-document-editor',
  imports: [DatePipe, FaIconComponent, Badge, ButtonDirective, ConfirmDialog, HighlightedDocument],
  host: {
    class:
      'flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900',
  },
  template: `
    <header class="border-b border-slate-200 px-4 py-4 sm:px-8 dark:border-slate-800">
      <div class="flex flex-wrap items-center gap-2">
        @if (document.origin() === 'sample') {
          <app-badge tone="info" [icon]="docIcon">Sample document</app-badge>
        } @else {
          <app-badge tone="warning" [icon]="editIcon">Edited draft · not saved</app-badge>
        }
        @if (store.review(); as review) {
          @if (store.isStale()) {
            <app-badge tone="warning">Changed since last review</app-badge>
          } @else {
            <app-badge tone="success"
              >Reviewed {{ review.createdAt | date: 'shortTime' }}</app-badge
            >
          }
        }
      </div>
      <label for="document-title" class="sr-only">Document title</label>
      <!-- A one-line textarea so long titles wrap on narrow screens instead of being clipped. -->
      <textarea
        id="document-title"
        rows="1"
        maxlength="200"
        class="mt-2 -mx-1 block w-full resize-none rounded-md border border-transparent px-1 py-0.5 text-xl font-semibold text-slate-900 field-sizing-content hover:border-slate-200 focus:border-brand-600 focus:outline-2 focus:outline-brand-600/30 sm:text-2xl dark:text-slate-100 dark:hover:border-slate-700 dark:focus:outline-brand-400/40"
        [value]="document.title()"
        (input)="onTitleInput($event)"
        (keydown.enter)="$event.preventDefault()"
      ></textarea>
    </header>

    <div
      class="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 sm:px-8 dark:border-slate-800 dark:bg-slate-800/50"
    >
      <div
        class="inline-flex rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900"
        role="group"
        aria-label="Document view"
      >
        <button
          type="button"
          class="flex h-8 items-center gap-2 rounded-sm px-3 text-sm focus-visible:outline-2 focus-visible:outline-focus"
          [class]="
            store.viewMode() === 'edit'
              ? 'bg-action text-white'
              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          "
          [attr.aria-pressed]="store.viewMode() === 'edit'"
          (click)="store.viewMode.set('edit')"
        >
          <fa-icon [icon]="editIcon" /> Edit
        </button>
        <button
          type="button"
          class="flex h-8 items-center gap-2 rounded-sm px-3 text-sm focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50"
          [class]="
            store.viewMode() === 'review'
              ? 'bg-action text-white'
              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          "
          [attr.aria-pressed]="store.viewMode() === 'review'"
          [disabled]="!store.review()"
          (click)="store.viewMode.set('review')"
        >
          <fa-icon [icon]="viewIcon" /> Review highlights
        </button>
      </div>

      <button
        type="button"
        class="flex h-8 items-center gap-2 rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50"
        [class]="
          store.showAllIssues()
            ? 'border-brand-600 bg-brand-50 font-medium text-brand-800 dark:border-brand-400 dark:bg-brand-500/15 dark:text-brand-200'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
        "
        [attr.aria-pressed]="store.showAllIssues()"
        [disabled]="!store.review() || store.isStale()"
        (click)="store.setShowAllIssues(!store.showAllIssues())"
      >
        <fa-icon [icon]="highlightIcon" /> Show all issues
      </button>

      <p
        id="document-length"
        class="ml-auto text-xs"
        [class]="
          overLimit()
            ? 'font-medium text-red-700 dark:text-red-400'
            : 'text-slate-600 dark:text-slate-400'
        "
      >
        {{ document.length().toLocaleString() }} / {{ store.maxChars.toLocaleString() }} characters
        @if (overLimit()) {
          — too long to review
        }
      </p>
      @if (document.origin() === 'draft') {
        <button type="button" appButton variant="ghost" size="sm" (click)="resetOpen.set(true)">
          <fa-icon [icon]="resetIcon" /> Reset to sample
        </button>
      }
    </div>

    <div class="px-4 py-6 sm:px-8">
      @if (store.viewMode() === 'edit' || !store.review()) {
        <label for="document-content" class="sr-only">Document content</label>
        <textarea
          id="document-content"
          class="block min-h-[60vh] w-full resize-y field-sizing-content rounded-lg border border-slate-200 bg-white p-4 font-serif text-[1.0625rem] leading-8 text-slate-800 focus:border-brand-600 focus:outline-2 focus:outline-brand-600/30 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:outline-brand-400/40"
          spellcheck="false"
          aria-describedby="document-length"
          [attr.aria-invalid]="overLimit() || store.validationError() === 'empty'"
          [value]="document.content()"
          (input)="onContentInput($event)"
        ></textarea>
      } @else if (store.isStale()) {
        <div
          class="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
          role="status"
        >
          The text has changed since it was reviewed, so highlights are hidden. Switch to
          <strong>Edit</strong>, or run the review again.
        </div>
      } @else {
        <p class="sr-only">
          Read-only view. Highlighted passages have review findings, each followed by its AI
          suggestion; select a finding to jump to it.
        </p>
        @if (
          !store.showAllIssues() &&
          store.activeFindingId() === null &&
          store.highlightedFindings().length > 0
        ) {
          <p class="mb-4 text-sm text-slate-600 dark:text-slate-400">
            Select an issue in Findings to highlight it here, or choose
            <strong class="font-medium">Show all issues</strong>.
          </p>
        }
        <app-highlighted-document
          [text]="document.content()"
          [findings]="store.documentHighlights()"
          [appliedIds]="store.acceptedIds()"
          [activeFindingId]="store.activeFindingId()"
          [focusTick]="store.focusTick()"
        />
      }
    </div>

    <app-confirm-dialog
      [open]="resetOpen()"
      title="Discard your edits?"
      confirmLabel="Reset to sample"
      confirmVariant="danger"
      (confirmed)="confirmReset()"
      (cancelled)="resetOpen.set(false)"
    >
      <p>
        The document will be replaced with the original sample text. Your changes are not saved
        anywhere.
      </p>
    </app-confirm-dialog>
  `,
})
export class DocumentEditor {
  protected readonly document = inject(DocumentService);
  protected readonly store = inject(ReviewStore);
  protected readonly resetOpen = signal(false);
  protected readonly overLimit = computed(() => this.document.length() > this.store.maxChars);

  protected readonly docIcon = faFileLines;
  protected readonly editIcon = faPen;
  protected readonly viewIcon = faEye;
  protected readonly highlightIcon = faHighlighter;
  protected readonly resetIcon = faRotateLeft;

  protected onContentInput(event: Event): void {
    this.document.setContent((event.target as HTMLTextAreaElement).value);
  }

  protected onTitleInput(event: Event): void {
    // Titles are single-line; strip newlines that could arrive via paste.
    this.document.setTitle((event.target as HTMLTextAreaElement).value.replace(/[\r\n]+/g, ' '));
  }

  protected confirmReset(): void {
    this.resetOpen.set(false);
    this.document.resetToSample();
    this.store.viewMode.set('edit');
  }
}
