import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faCheck,
  faCircleCheck,
  faCircleExclamation,
  faCircleInfo,
  faClock,
  faCommentSlash,
  faPenNib,
  faSpellCheck,
  faTag,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import type { BadgeTone } from '../../shared/components/badge';
import type { FindingCategory, FindingSeverity, FindingStatus } from './review.models';

export interface DisplayMeta {
  readonly label: string;
  readonly icon: IconDefinition;
  readonly tone: BadgeTone;
}

const CATEGORY_META: Record<string, DisplayMeta> = {
  spelling: { label: 'Spelling', icon: faSpellCheck, tone: 'warning' },
  grammar: { label: 'Grammar', icon: faPenNib, tone: 'info' },
  vulgar_language: { label: 'Inappropriate language', icon: faCommentSlash, tone: 'danger' },
};

/** Highlight styles per category. Each also uses a distinct underline so colour is not the only cue. */
const CATEGORY_HIGHLIGHT: Record<string, string> = {
  spelling:
    'bg-amber-100 decoration-amber-600 decoration-wavy dark:bg-amber-400/25 dark:decoration-amber-400',
  grammar:
    'bg-sky-100 decoration-sky-700 decoration-dashed dark:bg-sky-400/25 dark:decoration-sky-400',
  vulgar_language:
    'bg-red-100 decoration-red-700 decoration-double dark:bg-red-400/25 dark:decoration-red-400',
};

export function categoryMeta(category: FindingCategory): DisplayMeta {
  return (
    CATEGORY_META[category] ?? {
      label: humanize(category),
      icon: faTag,
      tone: 'violet',
    }
  );
}

export function categoryHighlight(category: FindingCategory): string {
  return (
    CATEGORY_HIGHLIGHT[category] ??
    'bg-violet-100 decoration-violet-700 decoration-dotted dark:bg-violet-400/25 dark:decoration-violet-400'
  );
}

export const SEVERITY_META: Record<FindingSeverity, DisplayMeta> = {
  high: { label: 'High', icon: faCircleExclamation, tone: 'danger' },
  medium: { label: 'Medium', icon: faTriangleExclamation, tone: 'warning' },
  low: { label: 'Low', icon: faCircleInfo, tone: 'neutral' },
};

export const STATUS_META: Record<FindingStatus, DisplayMeta> = {
  pending: { label: 'Needs review', icon: faClock, tone: 'neutral' },
  accepted: { label: 'Accepted', icon: faCheck, tone: 'brand' },
  dismissed: { label: 'Dismissed', icon: faXmark, tone: 'neutral' },
  resolved: { label: 'Resolved', icon: faCircleCheck, tone: 'success' },
};

export const SEVERITY_RANK: Record<FindingSeverity, number> = { high: 3, medium: 2, low: 1 };

function humanize(value: string): string {
  const text = value.replace(/[_-]+/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : 'Other';
}
