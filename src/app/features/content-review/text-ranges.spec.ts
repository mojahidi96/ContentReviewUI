import {
  applyReplacements,
  buildSegments,
  mapRange,
  normalizeRange,
  type RangeInput,
} from './text-ranges';

const joined = (text: string, items: RangeInput[]) =>
  buildSegments(text, items)
    .map((s) => s.text)
    .join('');

describe('normalizeRange', () => {
  const text = 'hello world';

  it('accepts a valid range', () => {
    expect(normalizeRange(text, { start: 0, end: 5 })).toEqual({ start: 0, end: 5 });
  });

  it.each([
    ['missing', undefined],
    ['negative start', { start: -1, end: 3 }],
    ['end past text', { start: 2, end: 99 }],
    ['zero length', { start: 3, end: 3 }],
    ['inverted', { start: 5, end: 2 }],
    ['non-integer', { start: 1.5, end: 3 }],
    ['NaN', { start: Number.NaN, end: 3 }],
  ])('rejects %s ranges', (_label, range) => {
    expect(normalizeRange(text, range)).toBeNull();
  });

  it('widens ranges that would split a surrogate pair', () => {
    const emoji = 'a😀b'; // 😀 occupies indices 1..2
    expect(normalizeRange(emoji, { start: 2, end: 3 })).toEqual({ start: 1, end: 3 });
    expect(normalizeRange(emoji, { start: 0, end: 2 })).toEqual({ start: 0, end: 3 });
  });
});

describe('buildSegments', () => {
  it('returns no segments for an empty document', () => {
    expect(buildSegments('', [{ id: 'a', range: { start: 0, end: 1 } }])).toEqual([]);
  });

  it('returns a single plain segment when there are no findings', () => {
    expect(buildSegments('plain text', [])).toEqual([
      { start: 0, end: 10, text: 'plain text', findingIds: [] },
    ]);
  });

  it('splits text around a single finding', () => {
    const segments = buildSegments('the teh cat', [{ id: 'f1', range: { start: 4, end: 7 } }]);
    expect(segments.map((s) => [s.text, s.findingIds])).toEqual([
      ['the ', []],
      ['teh', ['f1']],
      [' cat', []],
    ]);
  });

  it('splits overlapping findings into non-overlapping segments', () => {
    // "The the data shows" — f1 covers "The the", f2 covers "the data shows"
    const text = 'The the data shows';
    const segments = buildSegments(text, [
      { id: 'f1', range: { start: 0, end: 7 } },
      { id: 'f2', range: { start: 4, end: 18 } },
    ]);
    expect(segments.map((s) => [s.text, s.findingIds])).toEqual([
      ['The ', ['f1']],
      ['the', ['f1', 'f2']],
      [' data shows', ['f2']],
    ]);
    expect(segments.map((s) => s.text).join('')).toBe(text);
  });

  it('handles nested ranges and unsorted input', () => {
    const text = 'abcdefghij';
    const segments = buildSegments(text, [
      { id: 'inner', range: { start: 3, end: 5 } },
      { id: 'outer', range: { start: 1, end: 8 } },
    ]);
    expect(segments.map((s) => [s.text, s.findingIds])).toEqual([
      ['a', []],
      ['bc', ['outer']],
      ['de', ['inner', 'outer']],
      ['fgh', ['outer']],
      ['ij', []],
    ]);
  });

  it('merges identical duplicate ranges into one segment', () => {
    const segments = buildSegments('xx bad xx', [
      { id: 'a', range: { start: 3, end: 6 } },
      { id: 'b', range: { start: 3, end: 6 } },
    ]);
    expect(segments.filter((s) => s.findingIds.length)).toEqual([
      { start: 3, end: 6, text: 'bad', findingIds: ['a', 'b'] },
    ]);
  });

  it('ignores invalid and missing ranges without corrupting the text', () => {
    const text = 'stable text';
    const items: RangeInput[] = [
      { id: 'none' },
      { id: 'oob', range: { start: 5, end: 500 } },
      { id: 'inv', range: { start: 6, end: 2 } },
      { id: 'ok', range: { start: 0, end: 6 } },
    ];
    expect(joined(text, items)).toBe(text);
    expect(buildSegments(text, items).flatMap((s) => s.findingIds)).toEqual(['ok']);
  });

  it('preserves whitespace, newlines and emoji exactly', () => {
    const text = 'Line 1\n\n  😀 indented\tTab';
    expect(joined(text, [{ id: 'e', range: { start: 11, end: 12 } }])).toBe(text);
  });
});

describe('applyReplacements', () => {
  const text = 'the teh cat sat';

  it('applies replacements in any order against the original text', () => {
    const a = { range: { start: 4, end: 7 }, text: 'the' };
    const b = { range: { start: 12, end: 15 }, text: 'sits' };
    expect(applyReplacements(text, [a, b])).toBe('the the cat sits');
    expect(applyReplacements(text, [b, a])).toBe('the the cat sits');
    expect(applyReplacements(text, [b])).toBe('the teh cat sits');
    expect(applyReplacements(text, [])).toBe(text);
  });

  it('supports deletions', () => {
    expect(applyReplacements(text, [{ range: { start: 3, end: 7 }, text: '' }])).toBe(
      'the cat sat',
    );
  });
});

describe('mapRange', () => {
  const longer = { range: { start: 4, end: 7 }, text: 'these' }; // +2 chars

  it('shifts ranges after a replacement and keeps ranges before it', () => {
    expect(mapRange({ start: 12, end: 15 }, [longer])).toEqual({ start: 14, end: 17 });
    expect(mapRange({ start: 0, end: 3 }, [longer])).toEqual({ start: 0, end: 3 });
  });

  it('returns null for ranges that intersect a replacement', () => {
    expect(mapRange({ start: 6, end: 10 }, [longer])).toBeNull();
    expect(mapRange({ start: 4, end: 7 }, [longer])).toBeNull();
  });
});
