import { EventBus, Events } from '../../core/eventBus.js';
import { createLogger } from '../../core/logger.js';
import { loadSchedulerPolicy, DEFAULT_SCHEDULER_POLICY, SchedulerPolicy } from './config.js';
import { resolveCurrentTime, isWithinOperationalWindow, formatTimeForLog } from './utils.js';

/**
 * Scheduler Agent — Temporal governance and lifecycle control.
 *
 * Responsibilities:
 *  • Enforce operational window (configurable, default 09:00–21:00 Asia/Ho_Chi_Minh)
 *  • Activate / suspend monitoring cycles via EventBus signals
 *  • Emit "SCHEDULER_RUN" or "SCHEDULER_PAUSE" to downstream agents
 *
 * Failure handling:
 *  • Logs time resolution errors
 *  • Defaults to safe "PAUSE" mode if time cannot be resolved
 */
export class SchedulerAgent {
  private policy: SchedulerPolicy;
  private eventBus: EventBus;
  private log: ReturnType<typeof createLogger>;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private currentSignal = 'PAUSE';
  private lastCheck: string | null = null;
  private lastError: string | null = null;
  private isHealthy = true;
  private history: { signal: string; timestamp: string; reason: string }[] = [];

  static MAX_HISTORY = 50;

  constructor(
    eventBus: EventBus,
    policyOverrides?: Partial<SchedulerPolicy>,
    logger?: ReturnType<typeof createLogger>,
  ) {
    this.eventBus = eventBus;
    this.log = logger ?? createLogger('Scheduler');

    // Merge: env vars → overrides → defaults
    const envPolicy = loadSchedulerPolicy();
    this.policy = {
      ...DEFAULT_SCHEDULER_POLICY,
      ...envPolicy,
      ...policyOverrides,
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  /** Start the polling loop. Idempotent — calling twice is a no-op. */
  start() {
    if (this.isRunning) {
      this.log.warn('Already running — ignoring duplicate start()');
      return;
    }

    this.isRunning = true;
    this.log.info(
      `Started — window ${this.formatWindow()}, polling every ${this.policy.pollingIntervalMs}ms`,
    );

    // Run immediately, then on interval
    this.tick();
    this.intervalId = setInterval(() => this.tick(), this.policy.pollingIntervalMs);
  }

  /** Stop the polling loop and reset state. */
  stop() {
    if (!this.isRunning) return;

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    this.log.info('Stopped');
  }

  // ── Public accessors ───────────────────────────────────────────

  /** Returns an immutable snapshot of the current agent state. */
  getState() {
    return Object.freeze({
      currentSignal: this.currentSignal,
      lastCheck: this.lastCheck,
      lastError: this.lastError,
      isHealthy: this.isHealthy,
      isRunning: this.isRunning,
    });
  }

  /** Returns a copy of the signal transition history (newest first). */
  getHistory() {
    return [...this.history];
  }

  /** Returns the active policy configuration. */
  getPolicy() {
    return { ...this.policy };
  }

  // ── Core tick logic ────────────────────────────────────────────

  /** @private One scheduling cycle: resolve time → decide → emit. */
  private tick() {
    try {
      const now = resolveCurrentTime(this.policy.timezone);
      const timeStr = formatTimeForLog(now, this.policy.timezone);
      this.lastCheck = new Date().toISOString();
      this.isHealthy = true;

      const shouldRun = isWithinOperationalWindow(now, this.policy);
      const newSignal = shouldRun ? 'RUN' : 'PAUSE';

      // Record transition only on change
      if (newSignal !== this.currentSignal) {
        const reason = shouldRun
          ? `Entered operational window (${timeStr})`
          : `Left operational window (${timeStr})`;

        this.currentSignal = newSignal;
        this.recordTransition(newSignal, reason);
        this.log.info(`Signal → ${newSignal}: ${reason}`);
      }

      // Always emit the current signal so late-joining listeners receive the correct state
      if (shouldRun) {
        this.eventBus.emit(Events.SCHEDULER_RUN as any);
      } else {
        this.eventBus.emit(Events.SCHEDULER_PAUSE as any);
      }
    } catch (err) {
      this.handleTickError(err);
    }
  }

  // ── Error handling ─────────────────────────────────────────────

  /** @private Safe fallback: emit PAUSE and log the error. */
  private handleTickError(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    this.lastError = message;
    this.isHealthy = false;
    this.lastCheck = new Date().toISOString();

    this.log.error(`Time resolution failed — defaulting to PAUSE: ${message}`);

    // Safe default: PAUSE on error
    if (this.currentSignal !== 'PAUSE') {
      this.currentSignal = 'PAUSE';
      this.recordTransition('PAUSE', `Error: ${message}`);
    }

    this.eventBus.emit(Events.SCHEDULER_PAUSE as any);
  }

  // ── History tracking ───────────────────────────────────────────

  /** @private Append a transition entry; cap at MAX_HISTORY. */
  private recordTransition(signal: string, reason: string) {
    this.history.unshift({
      signal,
      timestamp: new Date().toISOString(),
      reason,
    });

    if (this.history.length > SchedulerAgent.MAX_HISTORY) {
      this.history.length = SchedulerAgent.MAX_HISTORY;
    }
  }

  // ── Formatting helpers ─────────────────────────────────────────

  /** @private Format the operational window for log output. */
  private formatWindow() {
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = `${pad(this.policy.windowStartHour)}:${pad(this.policy.windowStartMinute)}`;
    const end = `${pad(this.policy.windowEndHour)}:${pad(this.policy.windowEndMinute)}`;
    return `${start}–${end} ${this.policy.timezone}`;
  }
}
