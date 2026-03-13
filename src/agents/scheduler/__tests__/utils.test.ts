import { describe, it, expect } from 'vitest';
import { resolveCurrentTime, isWithinOperationalWindow, formatTimeForLog } from '../utils.js';
import type { SchedulerPolicy } from '../../../types/scheduler.js';


const POLICY: SchedulerPolicy = {
  windowStartHour: 9,
  windowStartMinute: 0,
  windowEndHour: 21,
  windowEndMinute: 0,
  timezone: 'Asia/Ho_Chi_Minh',
  pollingIntervalMs: 30_000,
};



describe('resolveCurrentTime', () => {
  it('returns a valid Date for a known timezone', () => {
    const result = resolveCurrentTime('Asia/Ho_Chi_Minh');
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).not.toBeNaN();
  });

  it('returns a valid Date for UTC', () => {
    const result = resolveCurrentTime('UTC');
    expect(result).toBeInstanceOf(Date);
  });

  it('throws for an invalid timezone', () => {
    expect(() => resolveCurrentTime('Not/A_Timezone')).toThrow();
  });
});



describe('isWithinOperationalWindow', () => {
  it('returns true at 14:00 (mid-window)', () => {
    const now = new Date(2026, 1, 27, 14, 0, 0);
    expect(isWithinOperationalWindow(now, POLICY)).toBe(true);
  });

  it('returns true at exactly 09:00 (window start, inclusive)', () => {
    const now = new Date(2026, 1, 27, 9, 0, 0);
    expect(isWithinOperationalWindow(now, POLICY)).toBe(true);
  });

  it('returns false at exactly 21:00 (window end, exclusive)', () => {
    const now = new Date(2026, 1, 27, 21, 0, 0);
    expect(isWithinOperationalWindow(now, POLICY)).toBe(false);
  });

  it('returns false at 08:59 (one minute before window)', () => {
    const now = new Date(2026, 1, 27, 8, 59, 0);
    expect(isWithinOperationalWindow(now, POLICY)).toBe(false);
  });

  it('returns false at 21:01 (one minute after window)', () => {
    const now = new Date(2026, 1, 27, 21, 1, 0);
    expect(isWithinOperationalWindow(now, POLICY)).toBe(false);
  });

  it('returns false at midnight', () => {
    const now = new Date(2026, 1, 27, 0, 0, 0);
    expect(isWithinOperationalWindow(now, POLICY)).toBe(false);
  });

  it('returns true at 09:01', () => {
    const now = new Date(2026, 1, 27, 9, 1, 0);
    expect(isWithinOperationalWindow(now, POLICY)).toBe(true);
  });

  it('returns true at 20:59', () => {
    const now = new Date(2026, 1, 27, 20, 59, 0);
    expect(isWithinOperationalWindow(now, POLICY)).toBe(true);
  });

  it('supports custom minute-level window boundaries', () => {
    const customPolicy: SchedulerPolicy = {
      ...POLICY,
      windowStartHour: 8,
      windowStartMinute: 30,
      windowEndHour: 17,
      windowEndMinute: 45,
    };

    
    expect(isWithinOperationalWindow(new Date(2026, 1, 27, 8, 30, 0), customPolicy)).toBe(true);
    
    expect(isWithinOperationalWindow(new Date(2026, 1, 27, 8, 29, 0), customPolicy)).toBe(false);
    
    expect(isWithinOperationalWindow(new Date(2026, 1, 27, 17, 44, 0), customPolicy)).toBe(true);
    
    expect(isWithinOperationalWindow(new Date(2026, 1, 27, 17, 45, 0), customPolicy)).toBe(false);
  });
});



describe('formatTimeForLog', () => {
  it('returns a non-empty formatted string', () => {
    const now = new Date();
    const result = formatTimeForLog(now, 'Asia/Ho_Chi_Minh');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes date and time components', () => {
    const result = formatTimeForLog(new Date(2026, 0, 15, 14, 30, 45), 'UTC');
    
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});
