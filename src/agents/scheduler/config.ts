import type { SchedulerPolicy } from '../../types/scheduler.js';


export const DEFAULT_SCHEDULER_POLICY: SchedulerPolicy = {
  windowStartHour: 9,
  windowStartMinute: 0,
  windowEndHour: 21,
  windowEndMinute: 0,
  timezone: 'Asia/Ho_Chi_Minh',
  pollingIntervalMs: 30_000,
};


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


function parseTimeParts(value: string | undefined): { hour: number; minute: number } | null {
  if (!value) return null;

  
  if (value.includes(':')) {
    const [h, m] = value.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return { hour: h, minute: m };
  }

  
  const hour = Number(value);
  if (!Number.isFinite(hour)) return null;
  return { hour, minute: 0 };
}
