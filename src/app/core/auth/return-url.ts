/**
 * Accepts only same-app absolute paths (`/workspace/...`) as post-login redirect targets,
 * preventing open redirects through a crafted `returnUrl` query parameter.
 */
export function safeReturnUrl(
  candidate: string | null | undefined,
  fallback = '/workspace',
): string {
  if (
    !candidate ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.includes('\\')
  ) {
    return fallback;
  }
  if (candidate.startsWith('/login') || candidate.startsWith('/register')) {
    return fallback;
  }
  return candidate;
}
