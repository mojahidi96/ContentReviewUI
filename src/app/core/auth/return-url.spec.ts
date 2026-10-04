import { safeReturnUrl } from './return-url';

describe('safeReturnUrl', () => {
  it('allows in-app paths', () => {
    expect(safeReturnUrl('/workspace/history')).toBe('/workspace/history');
  });

  it.each([
    undefined,
    '',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    '/login',
    '/register?x=1',
  ])('falls back for %s', (candidate) => {
    expect(safeReturnUrl(candidate)).toBe('/workspace');
  });
});
