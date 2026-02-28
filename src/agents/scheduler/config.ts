import type { SchedulerPolicy } from '../../types/scheduler.js';

/**
 * Default policy: operate between 09:00–21:00 in Asia/Ho_Chi_Minh,
 * checking every 30 seconds.
 */
export const DEFAULT_SCHEDULER_POLICY: SchedulerPolicy = {
  windowStartHour: 9,
  windowStartMinute: 0,
  windowEndHour: 21,
  windowEndMinute: 0,
  timezone: 'Asia/Ho_Chi_Minh',
  pollingIntervalMs: 30_000,
};

/**
 * Load scheduler policy from environment variables, falling back
 * to defaults for any unspecified value.
 */
export function loadSchedulerPolicy(): SchedulerPolicy {
  const env = process.env;

  const startParts = parseTimeParts(env.SCHEDULE_START);
  const endParts = parseTimeParts(env.SCHEDULE_END);

  return {
    windowStartHour: startParts?.hour ?? DEFAULT_SCHEDULER_POLICY.windowStartHour,
    windowStartMinute: startParts?.minute ?? DEFAULT_SCHEDULER_POLICY.windowStartMinute,
    windowEndHour: endParts?.hour ?? DEFAULT_SCHEDULER_POLICY.windowEndHour,
    windowEndMinute: endParts?.minute ?? DEFAULT_SCHEDULER_POLICY.windowEndMinute,
    timezone: env.TIMEZONE ?? env.TZ ?? DEFAULT_SCHEDULER_POLICY.timezone,
    pollingIntervalMs: env.CHECK_INTERVAL_MS
      ? Number(env.CHECK_INTERVAL_MS)
      : DEFAULT_SCHEDULER_POLICY.pollingIntervalMs,
  };
}

/**
 * Parse "HH:MM" or bare hour number into { hour, minute }.
 * Returns null if the value is falsy or unparseable.
 */
function parseTimeParts(value: string | undefined): { hour: number; minute: number } | null {
  if (!value) return null;

  // "HH:MM" format
  if (value.includes(':')) {
    const [h, m] = value.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return { hour: h, minute: m };
  }

  // Bare number (hour only)
  const hour = Number(value);
  if (!Number.isFinite(hour)) return null;
  return { hour, minute: 0 };
}
