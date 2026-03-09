import { Events, type EventBus } from '../core/eventBus.js';
import { createLogger, type Logger } from '../core/logger.js';
import type { Observation } from '../types/index.js';
import type { MonitoringAgent } from './monitoring/MonitoringAgent.js';
import type { ReasonerAgent } from './reasoner.js';
import type { NotificationAgent } from './notification.js';
import type { StateMemory } from './stateMemory.js';
import { MonitoringError, MonitoringErrorCode } from './monitoring/errors.js';

export interface CycleResult {
  success: boolean;
  duration: number; // milliseconds
  changeDetected: boolean;
  postLink: string | null;
  error: string | null;
}

export interface OrchestratorAgents {
  monitor: MonitoringAgent;
  reasoner: ReasonerAgent;
  notifier: NotificationAgent;
  memory: StateMemory;
}

export class Orchestrator {
  #agents: OrchestratorAgents;
  #eventBus: EventBus;
  #log: Logger;
  #isRunning = false;
  #started = false;
  #activePromise: Promise<unknown> | null = null;
  #consecutiveExtractionFailures = 0;
  #pauseUntil: number | null = null;

  // After this many consecutive EXTRACTION_FAILED cycles, enter degraded mode.
  static readonly MAX_EXTRACTION_FAILURES_BEFORE_PAUSE = 5;
  // Duration of degraded-mode backoff window in milliseconds.
  static readonly EXTRACTION_BACKOFF_WINDOW_MS = 5 * 60_000; // 5 minutes

  constructor(agents: OrchestratorAgents, eventBus: EventBus, logger?: Logger) {
    this.#agents = agents;
    this.#eventBus = eventBus;
    this.#log = logger ?? createLogger('Orchestrator');
  }

  // Lifecycle

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

  // Pipeline
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

    const now = Date.now();

    // Clear degraded mode if backoff window has elapsed
    if (this.#pauseUntil !== null && now >= this.#pauseUntil) {
      this.#log.info('Extraction backoff window elapsed — resuming normal operation');
      this.#pauseUntil = null;
      this.#consecutiveExtractionFailures = 0;
    }

    // If we're still within the backoff window, skip this cycle early
    if (this.#pauseUntil !== null && now < this.#pauseUntil) {
      this.#log.warn(
        'Monitoring is in degraded backoff mode — skipping cycle until extraction stabilizes.',
      );
      return {
        success: false,
        duration: 0,
        changeDetected: false,
        postLink: null,
        error: 'Monitoring in backoff due to repeated extraction failures',
      };
    }

    this.#isRunning = true;
    const start = Date.now();

    try {
      // Step 1 — Observe
      this.#log.info('Step 1/4 — Observing…');
      const observation = (await this.#observeWithRetries()) as Observation;

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
      } catch (notifyErr) {
        const message =
          notifyErr instanceof Error ? notifyErr.message : (notifyErr as unknown as string);
        this.#log.error('Notification failed (continuing to memory update):', message);
      }

      // Step 4 — Remember
      this.#log.info('Step 4/4 — Updating memory…');
      await this.#agents.memory.setLastPost(decision.postLink!);

      const result = this.#buildResult(true, start, true, decision.postLink, null);
      this.#emitComplete(result);
      this.#log.info(`Cycle complete — new post: ${decision.postLink}`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : (err as unknown as string);
      this.#log.error('Cycle failed:', message);

      // Track consecutive extraction failures to enter degraded backoff mode.
      if (err instanceof MonitoringError && err.code === MonitoringErrorCode.EXTRACTION_FAILED) {
        this.#consecutiveExtractionFailures += 1;

        if (this.#consecutiveExtractionFailures >= Orchestrator.MAX_EXTRACTION_FAILURES_BEFORE_PAUSE) {
          this.#pauseUntil = Date.now() + Orchestrator.EXTRACTION_BACKOFF_WINDOW_MS;
          this.#log.warn(
            `Entering extraction backoff mode after ${this.#consecutiveExtractionFailures} consecutive EXTRACTION_FAILED cycles. ` +
              `Will pause new cycles for ${Orchestrator.EXTRACTION_BACKOFF_WINDOW_MS / 60_000} minutes.`,
          );
        }
      } else {
        // Reset counter for non-extraction-related errors
        this.#consecutiveExtractionFailures = 0;
      }

      const result = this.#buildResult(false, start, false, null, message);
      this.#emitComplete(result);
      return result;
    } finally {
      this.#isRunning = false;
    }
  }

  // Private helpers

  #onRun = (): void => {
    this.#activePromise = this.runCycle().finally(() => {
      this.#activePromise = null;
    });
  };

  async #observeWithRetries(): Promise<Observation> {
    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt > 1) {
          this.#log.info(`Retrying observe attempt ${attempt}/${maxAttempts}…`);
        }
        return await this.#agents.monitor.observe();
      } catch (err: unknown) {
        lastError = err;

        // Only retry for MonitoringError marked as retryable
        if (!(err instanceof MonitoringError) || !err.retryable || attempt === maxAttempts) {
          throw err;
        }

        this.#log.warn(
          `Observe attempt ${attempt}/${maxAttempts} failed (${err.code}) — will retry shortly.`,
        );

        // Small linear backoff to avoid hammering the page
        await this.#sleep(1000 * attempt);
      }
    }

    // Defensive fallback — should be unreachable
    throw lastError instanceof Error ? lastError : new Error('Unknown observe error');
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

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
