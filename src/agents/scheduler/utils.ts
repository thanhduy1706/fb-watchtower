import type { SchedulerPolicy } from '../../types/scheduler.js';

/**
 * Resolve the current time in the given IANA timezone.
 *
 * @throws {Error} If the timezone is invalid or time resolution fails.
 */
export function resolveCurrentTime(timezone: string): Date {
  // Validate that the timezone is recognised by the runtime
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());

  // Parse "MM/DD/YYYY, HH:MM:SS" → Date in the target timezone
  const [datePart, timePart] = formatted.split(', ');
  const [month, day, year] = datePart.split('/').map(Number);
  const [hours, minutes, seconds] = timePart.split(':').map(Number);

  return new Date(year, month - 1, day, hours, minutes, seconds);
}

/**
 * Determine whether a given time falls within the configured
 * operational window.
 *
 * The window is treated as [start, end) — start-inclusive, end-exclusive.
 * This means 09:00 is inside the window but 21:00 is not.
 */
export function isWithinOperationalWindow(now: Date, policy: SchedulerPolicy): boolean {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const windowStart = policy.windowStartHour * 60 + policy.windowStartMinute;
  const windowEnd = policy.windowEndHour * 60 + policy.windowEndMinute;

  return currentMinutes >= windowStart && currentMinutes < windowEnd;
}

/**
 * Format a Date for structured log output in the given timezone.
 */
export function formatTimeForLog(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}
