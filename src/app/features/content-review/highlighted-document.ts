import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  input,
  viewChildren,
} from '@angular/core';
import { categoryHighlight, SEVERITY_RANK } from './finding-meta';
import type { Finding } from './review.models';
import { buildSegments, normalizeRange } from './text-ranges';

const APPLIED_HIGHLIGHT =
  'bg-emerald-100 decoration-emerald-600 decoration-solid dark:bg-emerald-400/25 dark:decoration-emerald-400';

function highlightFor(finding: Finding, applied: ReadonlySet<string>): string {
  return applied.has(finding.id) ? APPLIED_HIGHLIGHT : categoryHighlight(finding.category);
}

/**
 * Read-only rendering of the document with findings highlighted and each AI suggestion shown
 * right after the text it would replace. Accepted changes show the original text struck through
 * in front of the improved text. Text is rendered through interpolation only (never
 * innerHTML), so document content cannot inject markup.
 */
@Component({
  selector: 'app-highlighted-document',
  host: { class: 'block' },
  // Kept on one line on purpose: any template whitespace here would be rendered inside the
  // pre-wrapped text and shift the document. Do not reformat.
  // prettier-ignore
  template: `<div class="font-serif text-[1.0625rem] leading-8 break-words whitespace-pre-wrap text-slate-800 dark:text-slate-200">@for (segment of segments(); track segment.start) {@for (original of segment.originals; track original.id) {<del data-original class="mr-1 text-red-700 decoration-red-600 decoration-2 dark:text-red-400 dark:decoration-red-400"><span class="sr-only">Original text: </span>{{ original.text }}</del>}@if (segment.findingIds.length === 0) {<ng-container>{{ segment.text }}</ng-container>} @else {<mark #mark tabindex="-1" class="rounded-sm text-inherit underline decoration-2 underline-offset-4 scroll-mt-24 focus:outline-none" [class]="segment.classes" [attr.data-finding-ids]="segment.findingIds.join(' ')" [attr.aria-describedby]="segment.describedBy">{{ segment.text }}</mark>}@for (suggestion of segment.suggestions; track suggestion.id) {<ins data-suggestion class="ml-1 inline-block max-w-full rounded-sm leading-6 bg-emerald-100 px-1 py-0.5 font-sans text-sm font-medium text-emerald-900 no-underline ring-1 ring-emerald-300 ring-inset dark:bg-emerald-500/20 dark:text-emerald-200 dark:ring-emerald-500/40"><span class="sr-only">AI suggestion: </span><span aria-hidden="true">→ </span>{{ suggestion.text }}</ins>}}@for (original of trailingOriginals(); track original.id) {<del data-original class="ml-1 text-red-700 decoration-red-600 decoration-2 dark:text-red-400 dark:decoration-red-400"><span class="sr-only">Original text: </span>{{ original.text }}</del>}</div>`,
})
export class HighlightedDocument {
  readonly text = input.required<string>();
  readonly findings = input.required<readonly Finding[]>();
  readonly activeFindingId = input<string | null>(null);
  /** Findings whose suggestion is already applied: shown as corrected text, without a chip. */
  readonly appliedIds = input<ReadonlySet<string>>(new Set());
  /** Changes whenever the user asks to see the active finding again. */
  readonly focusTick = input(0);

  private readonly marks = viewChildren<ElementRef<HTMLElement>>('mark');

  /** Struck-through originals of accepted changes, keyed by where the improved text starts. */
  private readonly originalsByStart = computed(() => {
    const text = this.text();
    const applied = this.appliedIds();
    const byStart = new Map<number, { id: string; text: string }[]>();
    for (const finding of this.findings()) {
      const range = finding.range;
      if (!applied.has(finding.id) || !range || range.start < 0 || range.end > text.length) {
        continue;
      }
      const list = byStart.get(range.start) ?? [];
      list.push({ id: finding.id, text: finding.excerpt });
      byStart.set(range.start, list);
    }
    return byStart;
  });

  /** Originals of deletions at the very end of the text, where no segment starts. */
  protected readonly trailingOriginals = computed(
    () => this.originalsByStart().get(this.text().length) ?? [],
  );

  protected readonly segments = computed(() => {
    const text = this.text();
    const originals = this.originalsByStart();
    const byId = new Map(this.findings().map((f) => [f.id, f]));
    const active = this.activeFindingId();
    const applied = this.appliedIds();
    // Suggestions are rendered after the segment where their finding's text ends.
    const suggestionsByEnd = new Map<number, { id: string; text: string }[]>();
    for (const finding of this.findings()) {
      const range = normalizeRange(text, finding.range);
      if (range && finding.suggestion !== undefined && !applied.has(finding.id)) {
        const list = suggestionsByEnd.get(range.end) ?? [];
        list.push({ id: finding.id, text: finding.suggestion || 'remove this text' });
        suggestionsByEnd.set(range.end, list);
      }
    }
    return buildSegments(text, this.findings()).map((segment) => {
      // When findings overlap, style the segment after the most severe one.
      const primary = segment.findingIds
        .map((id) => byId.get(id))
        .filter((f): f is Finding => f !== undefined)
        .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])[0];
      const isActive = active !== null && segment.findingIds.includes(active);
      return {
        ...segment,
        classes: `${primary ? highlightFor(primary, applied) : ''} ${
          isActive ? 'ring-2 ring-focus ring-offset-1 dark:ring-offset-slate-900' : ''
        }`,
        describedBy: segment.findingIds.map((id) => `finding-${id}`).join(' ') || null,
        suggestions: segment.findingIds.length ? (suggestionsByEnd.get(segment.end) ?? []) : [],
        originals: originals.get(segment.start) ?? [],
      };
    });
  });

  constructor() {
    // Bring the selected finding's text into view after it has been rendered.
    afterRenderEffect(() => {
      const active = this.activeFindingId();
      this.focusTick();
      if (!active) {
        return;
      }
      const target = this.marks()
        .map((ref) => ref.nativeElement)
        .find((el) => el.dataset['findingIds']?.split(' ').includes(active));
      if (!target) {
        return;
      }
      const reduceMotion =
        globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      target.scrollIntoView?.({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      target.focus({ preventScroll: true });
    });
  }
}
