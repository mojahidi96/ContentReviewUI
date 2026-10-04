import type { TextRange } from './review.models';

export interface RangeInput {
  readonly id: string;
  readonly range?: TextRange;
}

/** A contiguous slice of the document and the findings covering it (empty for plain text). */
export interface TextSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly findingIds: readonly string[];
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Validates a backend range against the text. Returns `null` for anything unusable
 * (non-integers, inverted, empty or out of bounds) and widens ranges that would split a
 * surrogate pair so an emoji is never cut in half.
 */
export function normalizeRange(text: string, range: TextRange | undefined): TextRange | null {
  if (!range) {
    return null;
  }
  let { start, end } = range;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > text.length ||
    start >= end
  ) {
    return null;
  }
  if (
    start > 0 &&
    isLowSurrogate(text.charCodeAt(start)) &&
    isHighSurrogate(text.charCodeAt(start - 1))
  ) {
    start -= 1;
  }
  if (
    end < text.length &&
    isLowSurrogate(text.charCodeAt(end)) &&
    isHighSurrogate(text.charCodeAt(end - 1))
  ) {
    end += 1;
  }
  return { start, end };
}

/**
 * Splits `text` into non-overlapping segments so overlapping or nested findings can be
 * highlighted without producing invalid markup or duplicating text. Concatenating every
 * segment's `text` always reproduces the input exactly.
 */
export function buildSegments(text: string, items: readonly RangeInput[]): TextSegment[] {
  if (text.length === 0) {
    return [];
  }
  const ranges: { id: string; start: number; end: number }[] = [];
  for (const item of items) {
    const range = normalizeRange(text, item.range);
    if (range) {
      ranges.push({ id: item.id, ...range });
    }
  }

  const boundaries = new Set<number>([0, text.length]);
  for (const r of ranges) {
    boundaries.add(r.start);
    boundaries.add(r.end);
  }
  const points = [...boundaries].sort((a, b) => a - b);

  const segments: TextSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const findingIds = ranges.filter((r) => r.start <= start && r.end >= end).map((r) => r.id);
    const previous = segments.at(-1);
    // Merge neighbours covered by exactly the same findings to keep the DOM small.
    if (previous && sameIds(previous.findingIds, findingIds)) {
      segments[segments.length - 1] = {
        start: previous.start,
        end,
        text: text.slice(previous.start, end),
        findingIds,
      };
    } else {
      segments.push({ start, end, text: text.slice(start, end), findingIds });
    }
  }
  return segments;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** A replacement of `range` (in some source text) with `text`. */
export interface TextReplacement {
  readonly range: TextRange;
  readonly text: string;
}

/**
 * Applies non-overlapping replacements whose ranges all refer to the original `text`. Because
 * every range is relative to the same source, replacements can be added or removed in any order
 * and the result is always reproducible.
 */
export function applyReplacements(text: string, replacements: readonly TextReplacement[]): string {
  const sorted = [...replacements].sort((a, b) => a.range.start - b.range.start);
  let result = '';
  let cursor = 0;
  for (const { range, text: replacement } of sorted) {
    result += text.slice(cursor, range.start) + replacement;
    cursor = range.end;
  }
  return result + text.slice(cursor);
}

/**
 * Maps a range in the original text to where that text sits after `replacements` are applied.
 * Returns `null` when the range intersects a replacement (its text no longer exists as-is).
 */
export function mapRange(
  range: TextRange,
  replacements: readonly TextReplacement[],
): TextRange | null {
  let delta = 0;
  for (const r of replacements) {
    if (r.range.start < range.end && range.start < r.range.end) {
      return null;
    }
    if (r.range.end <= range.start) {
      delta += r.text.length - (r.range.end - r.range.start);
    }
  }
  return { start: range.start + delta, end: range.end + delta };
}
