/** "7:30 AM" in the user's own time zone, with the date when it is not today. */
export function formatResetTime(resetAtMs: number, nowMs: number): string {
  const at = new Date(resetAtMs);
  const sameDay = at.toDateString() === new Date(nowMs).toDateString();
  return new Intl.DateTimeFormat(undefined, {
    timeStyle: 'short',
    ...(sameDay ? {} : { dateStyle: 'medium' }),
  }).format(at);
}

/** Coarse, human wording for how long is left: "in about 2 hours". */
export function formatTimeLeft(resetAtMs: number, nowMs: number): string {
  const seconds = Math.ceil((resetAtMs - nowMs) / 1000);
  if (seconds <= 0) return 'now';
  if (seconds < 60) return 'in less than a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in about ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return `in about ${Math.round(hours / 24)} days`;
}
