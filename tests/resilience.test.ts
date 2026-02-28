import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResilienceAgent } from '../src/agents/resilience.js';

describe('ResilienceAgent', () => {
  let agent: ResilienceAgent;
  let mockRecover: any;
  let mockAlert: any;

  beforeEach(() => {
    mockRecover = vi.fn();
    mockAlert = vi.fn();
    agent = new ResilienceAgent({
      maxConsecutiveFailures: 3,
      maxCycleDurationMs: 100,
      rollingWindowSize: 5,
      onRecover: mockRecover,
      onAlert: mockAlert,
    });
  });

  it('initial metrics — all counters at zero', () => {
    const m = agent.getMetrics();
    expect(m.consecutiveFailures).toEqual({ perception: 0, slack: 0, memory: 0 });
    expect(m.totalFailures).toEqual({ perception: 0, slack: 0, memory: 0 });
    expect(m.lastCycleDurationMs).toBeNull();
    expect(m.cycleDurations).toEqual([]);
    expect(m.alertsSent).toBe(0);
  });

  it('recordSuccess resets consecutive failures for a subsystem', () => {
    agent.recordFailure('perception', new Error('fail'));
    agent.recordFailure('perception', new Error('fail'));
    expect(agent.getMetrics().consecutiveFailures.perception).toBe(2);

    agent.recordSuccess('perception');
    expect(agent.getMetrics().consecutiveFailures.perception).toBe(0);
    // totalFailures should be unchanged
    expect(agent.getMetrics().totalFailures.perception).toBe(2);
  });

  it('recordFailure below threshold — no recovery, no alert', () => {
    agent.recordFailure('slack', new Error('timeout'));
    agent.recordFailure('slack', new Error('timeout'));

    expect(agent.getMetrics().consecutiveFailures.slack).toBe(2);
    expect(mockRecover).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('recordFailure at threshold — triggers onRecover and onAlert', () => {
    const err = new Error('crash');
    agent.recordFailure('perception', err);
    agent.recordFailure('perception', err);
    agent.recordFailure('perception', err); // hits threshold of 3

    expect(mockRecover).toHaveBeenCalledTimes(1);
    expect(mockRecover).toHaveBeenCalledWith('perception', err);
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockAlert).toHaveBeenCalledWith(expect.stringContaining('[RECOVERY]'));
    // consecutive counter is reset after recovery
    expect(agent.getMetrics().consecutiveFailures.perception).toBe(0);
    // totalFailures still accumulates
    expect(agent.getMetrics().totalFailures.perception).toBe(3);
  });

  it('cycle duration tracking via startCycle / endCycle', async () => {
    agent.startCycle();
    await new Promise((r) => setTimeout(r, 20));
    agent.endCycle();

    const m = agent.getMetrics();
    expect(m.lastCycleDurationMs).toBeGreaterThanOrEqual(15);
    expect(m.cycleDurations.length).toBe(1);
  });

  it('slow cycle fires onAlert', async () => {
    agent.startCycle();
    await new Promise((r) => setTimeout(r, 150)); // exceeds 100ms threshold
    agent.endCycle();

    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockAlert).toHaveBeenCalledWith(expect.stringContaining('[SLOW CYCLE]'));
    expect(agent.getMetrics().alertsSent).toBe(1);
  });

  it('rolling window keeps only last N durations', () => {
    for (let i = 0; i < 8; i++) {
      (agent as any).lastCycleStartMs = Date.now() - 10;
      agent.endCycle();
    }

    expect(agent.getMetrics().cycleDurations.length).toBe(5); // rollingWindowSize
  });

  it('reset() clears all consecutive failure counts', () => {
    agent.recordFailure('perception', new Error('a'));
    agent.recordFailure('slack', new Error('b'));
    agent.recordFailure('memory', new Error('c'));

    agent.reset();

    const m = agent.getMetrics();
    expect(m.consecutiveFailures).toEqual({ perception: 0, slack: 0, memory: 0 });
    // totalFailures are NOT cleared by reset
    expect(m.totalFailures.perception).toBe(1);
    expect(m.totalFailures.slack).toBe(1);
    expect(m.totalFailures.memory).toBe(1);
  });

  it('failures in one subsystem do not affect another', () => {
    agent.recordFailure('perception', new Error('x'));
    agent.recordFailure('perception', new Error('x'));

    expect(agent.getMetrics().consecutiveFailures.perception).toBe(2);
    expect(agent.getMetrics().consecutiveFailures.slack).toBe(0);
    expect(agent.getMetrics().consecutiveFailures.memory).toBe(0);
  });

  it('works gracefully without onRecover / onAlert callbacks', () => {
    const bare = new ResilienceAgent({ maxConsecutiveFailures: 1 });

    // should not throw even though no callbacks are set
    expect(() => {
      bare.recordFailure('perception', new Error('oops'));
    }).not.toThrow();

    expect(bare.getMetrics().alertsSent).toBe(1);
    expect(bare.getMetrics().consecutiveFailures.perception).toBe(0);
  });
});
