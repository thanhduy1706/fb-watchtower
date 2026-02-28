import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus, Events } from '../src/core/eventBus.js';
import { Orchestrator } from '../src/agents/orchestrator.js';

// ── Mock agent factories ─────────────────────────────────────────

function createMockAgents(overrides: any = {}): any {
  return {
    monitor: {
      observe: vi.fn().mockResolvedValue({ latestPost: 'https://fb.com/post/123' }),
    },
    reasoner: {
      evaluate: vi.fn().mockResolvedValue({
        changeDetected: true,
        postLink: 'https://fb.com/post/123',
      }),
    },
    notifier: {
      notify: vi.fn().mockResolvedValue(undefined),
    },
    memory: {
      update: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

function createSilentLogger(): any {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

// ── Tests ────────────────────────────────────────────────────────

describe('Orchestrator', () => {
  let eventBus: EventBus;
  let logger: any;

  beforeEach(() => {
    eventBus = new EventBus();
    logger = createSilentLogger();
  });

  // ── Test 1: Full happy-path pipeline ─────────────────────────
  it('executes full pipeline on scheduler:run', async () => {
    const agents = createMockAgents();
    const orchestrator = new Orchestrator(agents, eventBus, logger);
    orchestrator.start();

    // Emit the run event and wait for the cycle
    const result = await orchestrator.runCycle();

    expect(agents.monitor.observe).toHaveBeenCalledOnce();
    expect(agents.reasoner.evaluate).toHaveBeenCalledOnce();
    expect(agents.notifier.notify).toHaveBeenCalledOnce();
    expect(agents.memory.update).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.changeDetected).toBe(true);
    expect(result.postLink).toBe('https://fb.com/post/123');
    expect(result.error).toBeNull();

    await orchestrator.stop();
  });

  // ── Test 2: No change → skip notify + update ─────────────────
  it('skips notify and memory update when no change detected', async () => {
    const agents = createMockAgents({
      reasoner: {
        evaluate: vi.fn().mockResolvedValue({ changeDetected: false }),
      },
    });
    const orchestrator = new Orchestrator(agents, eventBus, logger);

    const result = await orchestrator.runCycle();

    expect(agents.monitor.observe).toHaveBeenCalledOnce();
    expect(agents.reasoner.evaluate).toHaveBeenCalledOnce();
    expect(agents.notifier.notify).not.toHaveBeenCalled();
    expect(agents.memory.update).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.changeDetected).toBe(false);
  });

  // ── Test 3: Concurrency guard ────────────────────────────────
  it('rejects concurrent cycles', async () => {
    let resolveObserve: any;
    const agents = createMockAgents({
      monitor: {
        observe: vi.fn().mockReturnValue(
          new Promise((resolve) => {
            resolveObserve = resolve;
          }),
        ),
      },
    });
    const orchestrator = new Orchestrator(agents, eventBus, logger);

    // Start first cycle (will block on observe)
    const first = orchestrator.runCycle();
    const second = orchestrator.runCycle();

    const secondResult = await second;
    expect(secondResult.success).toBe(false);
    expect(secondResult.error).toMatch(/already in progress/i);

    // Resolve the first cycle
    resolveObserve({ latestPost: 'https://fb.com/post/123' });
    const firstResult = await first;
    expect(firstResult.success).toBe(true);
  });

  // ── Test 4: MonitoringAgent failure ──────────────────────────
  it('handles MonitoringAgent failure gracefully', async () => {
    const agents = createMockAgents({
      monitor: {
        observe: vi.fn().mockRejectedValue(new Error('Network timeout')),
      },
    });
    const orchestrator = new Orchestrator(agents, eventBus, logger);

    const result = await orchestrator.runCycle();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network timeout');
    // Downstream agents should NOT be called
    expect(agents.reasoner.evaluate).not.toHaveBeenCalled();
    expect(agents.notifier.notify).not.toHaveBeenCalled();
    expect(agents.memory.update).not.toHaveBeenCalled();
  });

  // ── Test 5: NotificationAgent failure → memory still updates ─
  it('still updates memory when notification fails', async () => {
    const agents = createMockAgents({
      notifier: {
        notify: vi.fn().mockRejectedValue(new Error('Slack 500')),
      },
    });
    const orchestrator = new Orchestrator(agents, eventBus, logger);

    const result = await orchestrator.runCycle();

    expect(agents.notifier.notify).toHaveBeenCalledOnce();
    expect(agents.memory.update).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
  });

  // ── Test 6: Graceful shutdown waits for active cycle ─────────
  it('stop() waits for active cycle to finish', async () => {
    let resolveObserve: any;
    const agents = createMockAgents({
      monitor: {
        observe: vi.fn().mockReturnValue(
          new Promise((resolve) => {
            resolveObserve = resolve;
          }),
        ),
      },
    });
    const orchestrator = new Orchestrator(agents, eventBus, logger);
    orchestrator.start();

    // Trigger cycle via event
    eventBus.emit(Events.SCHEDULER_RUN as any, { timestamp: Date.now() });

    // Begin shutdown while cycle is in-flight
    const stopPromise = orchestrator.stop();

    // Resolve the blocked cycle
    resolveObserve({ latestPost: 'https://fb.com/post/456' });

    // stop() should resolve without error
    await expect(stopPromise).resolves.toBeUndefined();
  });

  // ── Test 7: Emits cycle:complete event ───────────────────────
  it('emits cycle:complete event with CycleResult', async () => {
    const agents = createMockAgents();
    const orchestrator = new Orchestrator(agents, eventBus, logger);

    const completeSpy = vi.fn();
    eventBus.on(Events.CYCLE_COMPLETE as any, completeSpy);

    await orchestrator.runCycle();

    expect(completeSpy).toHaveBeenCalledOnce();

    const emitted = completeSpy.mock.calls[0][0];
    expect(emitted).toMatchObject({
      success: true,
      changeDetected: true,
      postLink: 'https://fb.com/post/123',
      error: null,
    });
    expect(typeof emitted.duration).toBe('number');
  });
});
