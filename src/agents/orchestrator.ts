import { Events, type EventBus } from '../core/eventBus.js';
import { createLogger, type Logger } from '../core/logger.js';

export interface CycleResult {
  success: boolean;
  duration: number; // milliseconds
  changeDetected: boolean;
  postLink: string | null;
  error: string | null;
}

export class Orchestrator {
  #agents: { monitor: any; reasoner: any; notifier: any; memory: any };
  #eventBus: EventBus;
  #log: Logger;
  #isRunning = false;
  #started = false;
  #activePromise: Promise<any> | null = null;

  constructor(
    agents: { monitor: any; reasoner: any; notifier: any; memory: any },
    eventBus: EventBus,
    logger?: Logger,
  ) {
    this.#agents = agents;
    this.#eventBus = eventBus;
    this.#log = logger ?? createLogger('Orchestrator');
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#eventBus.on(Events.SCHEDULER_RUN, this.#onRun);
    this.#log.info('Started — listening for scheduler:run events');
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    this.#eventBus.removeListener(Events.SCHEDULER_RUN, this.#onRun);

    // Drain in-flight cycle
    if (this.#activePromise) {
      this.#log.info('Waiting for active cycle to finish…');
      await this.#activePromise;
    }

    this.#log.info('Stopped');
  }

  // ── Pipeline ───────────────────────────────────────────────────

  /**
   * Execute one full observe → evaluate → notify → remember cycle.
   */
  async runCycle(): Promise<CycleResult> {
    // Concurrency guard
    if (this.#isRunning) {
      this.#log.warn('Cycle already in progress — skipping');
      return {
        success: false,
        duration: 0,
        changeDetected: false,
        postLink: null,
        error: 'Cycle already in progress',
      };
    }

    this.#isRunning = true;
    const start = Date.now();

    try {
      // Step 1 — Observe
      this.#log.info('Step 1/4 — Observing…');
      const observation = await this.#agents.monitor.observe();

      // Step 2 — Evaluate
      this.#log.info('Step 2/4 — Evaluating…');
      const decision = await this.#agents.reasoner.evaluate(observation);

      // Short-circuit if nothing changed
      if (!decision.changeDetected) {
        this.#log.info('No change detected — cycle complete');
        const result = this.#buildResult(true, start, false, null, null);
        this.#emitComplete(result);
        return result;
      }

      // Step 3 — Notify
      this.#log.info('Step 3/4 — Notifying…');
      try {
        await this.#agents.notifier.notify(decision);
      } catch (notifyErr: any) {
        this.#log.error('Notification failed (continuing to memory update):', notifyErr.message);
      }

      // Step 4 — Remember
      this.#log.info('Step 4/4 — Updating memory…');
      await this.#agents.memory.setLastPost(decision.postLink!);

      const result = this.#buildResult(true, start, true, decision.postLink, null);
      this.#emitComplete(result);
      this.#log.info(`Cycle complete — new post: ${decision.postLink}`);
      return result;
    } catch (err: any) {
      this.#log.error('Cycle failed:', err.message);
      const result = this.#buildResult(false, start, false, null, err.message);
      this.#emitComplete(result);
      return result;
    } finally {
      this.#isRunning = false;
    }
  }

  // ── Private helpers ────────────────────────────────────────────

  #onRun = (): void => {
    this.#activePromise = this.runCycle().finally(() => {
      this.#activePromise = null;
    });
  };

  #buildResult(
    success: boolean,
    startTime: number,
    changeDetected: boolean,
    postLink: string | null,
    error: string | null,
  ): CycleResult {
    return {
      success,
      duration: Date.now() - startTime,
      changeDetected,
      postLink: postLink ?? null,
      error: error ?? null,
    };
  }

  #emitComplete(result: CycleResult): void {
    this.#eventBus.emit(Events.CYCLE_COMPLETE, result);
  }
}
