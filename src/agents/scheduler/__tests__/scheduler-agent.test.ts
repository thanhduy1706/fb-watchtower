import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus, Events } from '../../../core/eventBus.js';
import { SchedulerAgent } from '../scheduler-agent.js';

// ── Helpers ──────────────────────────────────────────────────────
function createSilentLogger() {
  const noop = () => {};
  return { info: noop, warn: noop, error: noop, debug: noop };
}

// ── SchedulerAgent ───────────────────────────────────────────────

describe('SchedulerAgent', () => {
  let eventBus: EventBus;
  let agent: SchedulerAgent;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventBus();
  });

  afterEach(() => {
    agent?.stop();
    vi.useRealTimers();
  });

  // ── Signal emission ──────────────────────────────────────────

  it('emits SCHEDULER_RUN during operational window', () => {
    // Set fake time to 14:00 Asia/Ho_Chi_Minh (UTC+7 → 07:00 UTC)
    vi.setSystemTime(new Date('2026-02-27T07:00:00.000Z'));

    const runSpy = vi.fn();
    eventBus.on(Events.SCHEDULER_RUN, runSpy);

    agent = new SchedulerAgent(
      eventBus,
      {
        windowStartHour: 9,
        windowEndHour: 21,
        timezone: 'Asia/Ho_Chi_Minh',
        pollingIntervalMs: 30_000,
      },
      createSilentLogger(),
    );

    agent.start();

    expect(runSpy).toHaveBeenCalled();
    expect(agent.getState().currentSignal).toBe('RUN');
  });

  it('emits SCHEDULER_PAUSE outside operational window', () => {
    // Set fake time to 05:00 Asia/Ho_Chi_Minh (UTC+7 → 22:00 UTC prev day)
    vi.setSystemTime(new Date('2026-02-26T22:00:00.000Z'));

    const pauseSpy = vi.fn();
    eventBus.on(Events.SCHEDULER_PAUSE, pauseSpy);

    agent = new SchedulerAgent(
      eventBus,
      {
        windowStartHour: 9,
        windowEndHour: 21,
        timezone: 'Asia/Ho_Chi_Minh',
        pollingIntervalMs: 30_000,
      },
      createSilentLogger(),
    );

    agent.start();

    expect(pauseSpy).toHaveBeenCalled();
    expect(agent.getState().currentSignal).toBe('PAUSE');
  });

  // ── Lifecycle ────────────────────────────────────────────────

  it('start() is idempotent', () => {
    vi.setSystemTime(new Date('2026-02-27T07:00:00.000Z'));

    const runSpy = vi.fn();
    eventBus.on(Events.SCHEDULER_RUN, runSpy);

    agent = new SchedulerAgent(
      eventBus,
      {
        windowStartHour: 9,
        windowEndHour: 21,
        timezone: 'Asia/Ho_Chi_Minh',
        pollingIntervalMs: 30_000,
      },
      createSilentLogger(),
    );

    agent.start();
    agent.start(); // should be a no-op

    // Only one immediate tick should have fired
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it('stop() cleans up the interval', () => {
    vi.setSystemTime(new Date('2026-02-27T07:00:00.000Z'));

    const runSpy = vi.fn();
    eventBus.on(Events.SCHEDULER_RUN, runSpy);

    agent = new SchedulerAgent(
      eventBus,
      {
        windowStartHour: 9,
        windowEndHour: 21,
        timezone: 'Asia/Ho_Chi_Minh',
        pollingIntervalMs: 1_000,
      },
      createSilentLogger(),
    );

    agent.start();
    expect(runSpy).toHaveBeenCalledTimes(1);

    agent.stop();

    // Advance time — no more ticks should fire
    vi.advanceTimersByTime(5_000);
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(agent.getState().isRunning).toBe(false);
  });

  // ── Polling ──────────────────────────────────────────────────

  it('ticks on the configured polling interval', () => {
    vi.setSystemTime(new Date('2026-02-27T07:00:00.000Z'));

    const runSpy = vi.fn();
    eventBus.on(Events.SCHEDULER_RUN, runSpy);

    agent = new SchedulerAgent(
      eventBus,
      {
        windowStartHour: 9,
        windowEndHour: 21,
        timezone: 'Asia/Ho_Chi_Minh',
        pollingIntervalMs: 1_000,
      },
      createSilentLogger(),
    );

    agent.start(); // immediate tick
    expect(runSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000); // second tick
    expect(runSpy).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1_000); // third tick
    expect(runSpy).toHaveBeenCalledTimes(3);
  });

  // ── State ────────────────────────────────────────────────────

  it('getState() returns an immutable snapshot', () => {
    vi.setSystemTime(new Date('2026-02-27T07:00:00.000Z'));

    agent = new SchedulerAgent(
      eventBus,
      {
        windowStartHour: 9,
        windowEndHour: 21,
        timezone: 'Asia/Ho_Chi_Minh',
        pollingIntervalMs: 30_000,
      },
      createSilentLogger(),
    );

    agent.start();

    const state = agent.getState();
    expect(state.currentSignal).toBe('RUN');
    expect(state.isRunning).toBe(true);
    expect(state.isHealthy).toBe(true);
    expect(state.lastCheck).toBeTruthy();
    expect(state.lastError).toBeNull();
    expect(Object.isFrozen(state)).toBe(true);
  });

  // ── Signal transition history ────────────────────────────────

  it('records signal transitions in history', () => {
    // Start outside window
    vi.setSystemTime(new Date('2026-02-27T01:00:00.000Z')); // 08:00 VN

    agent = new SchedulerAgent(
      eventBus,
      {
        windowStartHour: 9,
        windowEndHour: 21,
        timezone: 'Asia/Ho_Chi_Minh',
        pollingIntervalMs: 60_000 * 60, // 1hr ticks for easy stepping
      },
      createSilentLogger(),
    );

    agent.start();
    // Initial state is PAUSE (08:00 < 09:00), but since default
    // currentSignal is already PAUSE, no transition is recorded
    const historyBefore = agent.getHistory();

    // Move into the window (09:00 VN = 02:00 UTC)
    vi.setSystemTime(new Date('2026-02-27T02:00:00.000Z'));
    vi.advanceTimersByTime(60_000 * 60);

    const historyAfter = agent.getHistory();
    expect(historyAfter.length).toBeGreaterThan(historyBefore.length);
    expect(historyAfter[0].signal).toBe('RUN');
    expect(historyAfter[0].reason).toContain('Entered operational window');
  });

  // ── Error handling ───────────────────────────────────────────

  it('defaults to PAUSE on time resolution error', () => {
    vi.setSystemTime(new Date('2026-02-27T07:00:00.000Z'));

    const pauseSpy = vi.fn();
    eventBus.on(Events.SCHEDULER_PAUSE, pauseSpy);

    agent = new SchedulerAgent(
      eventBus,
      {
        windowStartHour: 9,
        windowEndHour: 21,
        timezone: 'Invalid/Timezone_That_Does_Not_Exist',
        pollingIntervalMs: 30_000,
      },
      createSilentLogger(),
    );

    agent.start();

    expect(pauseSpy).toHaveBeenCalled();
    expect(agent.getState().currentSignal).toBe('PAUSE');
    expect(agent.getState().isHealthy).toBe(false);
    expect(agent.getState().lastError).toBeTruthy();
  });

  // ── Policy accessor ──────────────────────────────────────────

  it('getPolicy() returns the merged policy', () => {
    agent = new SchedulerAgent(
      eventBus,
      {
        windowStartHour: 10,
        windowEndHour: 20,
        timezone: 'UTC',
        pollingIntervalMs: 5_000,
      },
      createSilentLogger(),
    );

    const policy = agent.getPolicy();
    expect(policy.windowStartHour).toBe(10);
    expect(policy.windowEndHour).toBe(20);
    expect(policy.timezone).toBe('UTC');
    expect(policy.pollingIntervalMs).toBe(5_000);
  });
});
