/** Presentation helpers shared by the document list, article and write pages. */

const CHARS_PER_WORD = 6;
const WORDS_PER_MINUTE = 200;

/** Estimated reading time in whole minutes (never below 1), from the length in code points. */
export function readingMinutes(contentLength: number): number {
  return Math.max(1, Math.round(contentLength / CHARS_PER_WORD / WORDS_PER_MINUTE));
}

export function approxWords(contentLength: number): number {
  return Math.round(contentLength / CHARS_PER_WORD);
}

/** A stable two-colour gradient per document, used as its thumbnail. */
export function thumbnailGradient(id: string): string {
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  const hue = hash % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 52%), hsl(${(hue + 48) % 360} 72% 38%))`;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}
