import type { SchedulerPolicy } from '../../types/scheduler.js';


export function resolveCurrentTime(timezone: string): Date {
  
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

  
  const [datePart, timePart] = formatted.split(', ');
  const [month, day, year] = datePart.split('/').map(Number);
  const [hours, minutes, seconds] = timePart.split(':').map(Number);

  return new Date(year, month - 1, day, hours, minutes, seconds);
}


export function isWithinOperationalWindow(now: Date, policy: SchedulerPolicy): boolean {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const windowStart = policy.windowStartHour * 60 + policy.windowStartMinute;
  const windowEnd = policy.windowEndHour * 60 + policy.windowEndMinute;

  return currentMinutes >= windowStart && currentMinutes < windowEnd;
}


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
