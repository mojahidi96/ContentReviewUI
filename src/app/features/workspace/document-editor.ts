import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faCircleCheck,
  faEye,
  faFileCirclePlus,
  faFileLines,
  faFloppyDisk,
  faHighlighter,
  faPen,
  faRotateLeft,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { Badge } from '../../shared/components/badge';
import { ButtonDirective } from '../../shared/components/button.directive';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import { Spinner } from '../../shared/components/spinner';
import { HighlightedDocument } from '../content-review/highlighted-document';
import { ReviewStore } from '../content-review/review.store';
import { DocumentService } from './document.service';

@Component({
  selector: 'app-document-editor',
  imports: [
    DatePipe,
    FaIconComponent,
    Badge,
    ButtonDirective,
    ConfirmDialog,
    HighlightedDocument,
    Spinner,
  ],
  host: {
    class:
      'flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900',
    '(window:keydown)': 'onKeydown($event)',
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
  template: `
    <header class="border-b border-slate-200 px-4 py-4 sm:px-8 dark:border-slate-800">
      <div class="flex flex-wrap items-center gap-2">
        @switch (document.origin()) {
          @case ('sample') {
            <app-badge tone="info" [icon]="docIcon">Sample document · not saved</app-badge>
          }
          @case ('draft') {
            <app-badge tone="warning" [icon]="editIcon">New document · not saved</app-badge>
          }
          @case ('saved') {
            <app-badge tone="success" [icon]="savedIcon">Saved</app-badge>
          }
          @case ('modified') {
            <app-badge tone="warning" [icon]="editIcon">Unsaved changes</app-badge>
          }
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
        <button
          type="button"
          appButton
          size="sm"
          class="ml-auto"
          aria-keyshortcuts="Control+S Meta+S"
          [disabled]="!document.canSave()"
          [attr.title]="saveHint()"
          (click)="document.save()"
        >
          @if (document.activity() === 'saving') {
            <app-spinner />
            Saving…
          } @else {
            <fa-icon [icon]="saveIcon" />
            Save
          }
        </button>
      </div>
      @if (document.hasConflict()) {
        <div
          class="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
          role="alert"
        >
          <fa-icon [icon]="warnIcon" />
          <p class="flex-1">
            This document was saved somewhere else since you opened it, so your changes were not
            saved.
          </p>
          <button
            type="button"
            appButton
            variant="secondary"
            size="sm"
            (click)="reloadOpen.set(true)"
          >
            Load latest version
          </button>
        </div>
      }
      <label for="document-title" class="sr-only">Document title</label>
      <!-- A one-line textarea so long titles wrap on narrow screens instead of being clipped. -->
      <textarea
        id="document-title"
        rows="1"
        maxlength="200"
        class="mt-2 -mx-1 block w-full resize-none rounded-md border border-transparent px-1 py-0.5 text-xl font-semibold text-slate-900 field-sizing-content hover:border-slate-200 focus:border-brand-600 focus:outline-2 focus:outline-brand-600/30 sm:text-2xl dark:text-slate-100 dark:hover:border-slate-700 dark:focus:outline-brand-400/40"
        [value]="document.title()"
        [readOnly]="document.activity() === 'loading'"
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
          — too long to review or save
        }
      </p>
      @if (document.documentId()) {
        <button type="button" appButton variant="ghost" size="sm" (click)="startNew()">
          <fa-icon [icon]="newIcon" /> New document
        </button>
      } @else if (document.origin() === 'draft') {
        <button type="button" appButton variant="ghost" size="sm" (click)="resetOpen.set(true)">
          <fa-icon [icon]="resetIcon" /> Reset to sample
        </button>
      }
    </div>

    <div class="px-4 py-6 sm:px-8" [attr.aria-busy]="document.activity() === 'loading'">
      @if (document.activity() === 'loading') {
        <p class="mb-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <app-spinner /> Opening your saved document…
        </p>
      }
      @if (store.viewMode() === 'edit' || !store.review()) {
        <label for="document-content" class="sr-only">Document content</label>
        <textarea
          id="document-content"
          class="block min-h-[60vh] w-full resize-y field-sizing-content rounded-lg border border-slate-200 bg-white p-4 font-serif text-[1.0625rem] leading-8 text-slate-800 focus:border-brand-600 focus:outline-2 focus:outline-brand-600/30 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:outline-brand-400/40"
          spellcheck="false"
          aria-describedby="document-length"
          [attr.aria-invalid]="overLimit() || store.validationError() === 'empty'"
          [value]="document.content()"
          [readOnly]="document.activity() === 'loading'"
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

    <app-confirm-dialog
      [open]="newOpen()"
      title="Start a new document?"
      confirmLabel="Discard and start new"
      confirmVariant="danger"
      (confirmed)="confirmNew()"
      (cancelled)="newOpen.set(false)"
    >
      <p>Your unsaved changes will be lost. The last saved version stays saved.</p>
    </app-confirm-dialog>

    <app-confirm-dialog
      [open]="reloadOpen()"
      title="Load the latest saved version?"
      confirmLabel="Load latest version"
      confirmVariant="danger"
      (confirmed)="confirmReload()"
      (cancelled)="reloadOpen.set(false)"
    >
      <p>
        Your unsaved changes in this tab will be replaced. Copy anything you want to keep first.
      </p>
    </app-confirm-dialog>
  `,
})
export class DocumentEditor {
  protected readonly document = inject(DocumentService);
  protected readonly store = inject(ReviewStore);
  protected readonly resetOpen = signal(false);
  protected readonly newOpen = signal(false);
  protected readonly reloadOpen = signal(false);
  protected readonly saveHint = computed(() => {
    if (this.document.origin() === 'saved') return 'All changes are saved';
    if (this.document.tooLong()) return 'The document is too long to save';
    if (this.document.hasConflict()) return 'Load the latest version before saving';
    return 'Save (Ctrl+S / ⌘S)';
  });
  protected readonly overLimit = computed(() => this.document.length() > this.store.maxChars);

  protected readonly docIcon = faFileLines;
  protected readonly editIcon = faPen;
  protected readonly viewIcon = faEye;
  protected readonly highlightIcon = faHighlighter;
  protected readonly resetIcon = faRotateLeft;
  protected readonly saveIcon = faFloppyDisk;
  protected readonly savedIcon = faCircleCheck;
  protected readonly newIcon = faFileCirclePlus;
  protected readonly warnIcon = faTriangleExclamation;

  /** Ctrl+S / ⌘S saves instead of opening the browser's "Save page" dialog. */
  protected onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.document.save();
    }
  }

  /** Asks the browser to confirm before a reload or tab close would lose unsaved text. */
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.document.hasUnsavedChanges()) {
      event.preventDefault();
    }
  }

  protected startNew(): void {
    if (this.document.hasUnsavedChanges()) {
      this.newOpen.set(true);
    } else {
      this.confirmNew();
    }
  }

  protected confirmNew(): void {
    this.newOpen.set(false);
    this.document.resetToSample();
    this.store.viewMode.set('edit');
  }

  protected confirmReload(): void {
    this.reloadOpen.set(false);
    this.document.reloadSaved();
  }

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
