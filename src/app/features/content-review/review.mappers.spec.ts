import { InvalidResponseError } from '../../core/http/api-error';
import { makeFindingDto } from '../../testing/test-providers';
import {
  codePointLength,
  codePointRangeToUtf16,
  parseEventData,
  toFinding,
  toReviewPage,
} from './review.mappers';

describe('review mappers', () => {
  describe('codePointRangeToUtf16', () => {
    // The examples from the Node contract's "Text offsets" table.
    it.each([
      ['Hi wrld', 3, 7, { start: 3, end: 7 }],
      ['Hi 😀 wrld', 5, 9, { start: 6, end: 10 }],
      ['Hi 👋🏽 wrld', 6, 10, { start: 8, end: 12 }],
      ['Hé wrld', 4, 8, { start: 4, end: 8 }],
    ])('maps %j [%i, %i) to %j', (content, start, end, expected) => {
      expect(codePointRangeToUtf16(content, start, end, 'wrld')).toEqual(expected);
      expect(content.slice(expected.start, expected.end)).toBe('wrld');
    });

    it('handles a range at the very start and very end of the text', () => {
      expect(codePointRangeToUtf16('😀ab', 0, 1, '😀')).toEqual({ start: 0, end: 2 });
      expect(codePointRangeToUtf16('ab😀', 2, 3, '😀')).toEqual({ start: 2, end: 4 });
    });

    it.each([
      ['out of range', 5, 9],
      ['empty', 3, 3],
      ['inverted', 4, 3],
      ['negative', -1, 2],
      ['fractional', 1.5, 3],
    ])('rejects %s offsets', (_label, start, end) => {
      expect(codePointRangeToUtf16('Hi wrld', start, end, 'wrld')).toBeUndefined();
    });

    it('rejects offsets that do not select the original text', () => {
      expect(codePointRangeToUtf16('Hi wrld', 0, 4, 'wrld')).toBeUndefined();
    });
  });

  it('counts code points', () => {
    expect(codePointLength('a😀b')).toBe(3);
    expect('a😀b'.length).toBe(4);
  });

  it('maps a finding DTO to the UI finding', () => {
    expect(toFinding(makeFindingDto({ suggestedText: '' }), 'The teh end')).toEqual({
      id: 'fnd_000000000000000000000001',
      category: 'spelling',
      severity: 'low',
      excerpt: 'teh',
      suggestion: '',
      explanation: '"teh" is misspelled.',
      range: { start: 4, end: 7 },
      status: 'pending',
    });
  });

  it.each([
    ['missing items', { page: 1, total: 0, totalPages: 0 }],
    [
      'wrong item status',
      { items: [{ reviewId: 'x', status: 'weird' }], page: 1, total: 1, totalPages: 1 },
    ],
    ['not an object', 'oops'],
  ])('rejects a malformed review page (%s)', (_label, body) => {
    expect(() => toReviewPage(body)).toThrow(InvalidResponseError);
  });

  it('validates SSE payloads but ignores unknown extra fields', () => {
    expect(
      parseEventData('review.completed', '{"reviewId":"r","findingCount":2,"extra":true}'),
    ).toMatchObject({ findingCount: 2 });
    expect(() => parseEventData('review.completed', '{"reviewId":"r"}')).toThrow(
      InvalidResponseError,
    );
    expect(() => parseEventData('finding.detected', '{"reviewId":"r","finding":{}}')).toThrow(
      InvalidResponseError,
    );
  });
});
