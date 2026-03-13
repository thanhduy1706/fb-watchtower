import { EventBus, Events } from '../../core/eventBus.js';
import { createLogger } from '../../core/logger.js';
import { loadSchedulerPolicy, DEFAULT_SCHEDULER_POLICY } from './config.js';
import type { SchedulerPolicy } from '../../types/scheduler.js';
import { resolveCurrentTime, isWithinOperationalWindow, formatTimeForLog } from './utils.js';


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

    
    const envPolicy = loadSchedulerPolicy();
    this.policy = {
      ...DEFAULT_SCHEDULER_POLICY,
      ...envPolicy,
      ...policyOverrides,
    };
  }

  

  
  start() {
    if (this.isRunning) {
      this.log.warn('Already running — ignoring duplicate start()');
      return;
    }

    this.isRunning = true;
    this.log.info(
      `Started — window ${this.formatWindow()}, polling every ${this.policy.pollingIntervalMs}ms`,
    );

    
    this.tick();
    this.intervalId = setInterval(() => this.tick(), this.policy.pollingIntervalMs);
  }

  
  stop() {
    if (!this.isRunning) return;

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    this.log.info('Stopped');
  }

  

  
  getState() {
    return Object.freeze({
      currentSignal: this.currentSignal,
      lastCheck: this.lastCheck,
      lastError: this.lastError,
      isHealthy: this.isHealthy,
      isRunning: this.isRunning,
    });
  }

  
  getHistory() {
    return [...this.history];
  }

  
  getPolicy() {
    return { ...this.policy };
  }

  

  
  private tick() {
    try {
      const now = resolveCurrentTime(this.policy.timezone);
      const timeStr = formatTimeForLog(now, this.policy.timezone);
      this.lastCheck = new Date().toISOString();
      this.isHealthy = true;

      const shouldRun = isWithinOperationalWindow(now, this.policy);
      const newSignal = shouldRun ? 'RUN' : 'PAUSE';

      
      if (newSignal !== this.currentSignal) {
        const reason = shouldRun
          ? `Entered operational window (${timeStr})`
          : `Left operational window (${timeStr})`;

        this.currentSignal = newSignal;
        this.recordTransition(newSignal, reason);
        this.log.info(`Signal → ${newSignal}: ${reason}`);
      }

      
      if (shouldRun) {
        this.eventBus.emit(Events.SCHEDULER_RUN);
      } else {
        this.eventBus.emit(Events.SCHEDULER_PAUSE);
      }
    } catch (err) {
      this.handleTickError(err);
    }
  }

  

  
  private handleTickError(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    this.lastError = message;
    this.isHealthy = false;
    this.lastCheck = new Date().toISOString();

    this.log.error(`Time resolution failed — defaulting to PAUSE: ${message}`);

    
    if (this.currentSignal !== 'PAUSE') {
      this.currentSignal = 'PAUSE';
      this.recordTransition('PAUSE', `Error: ${message}`);
    }

    this.eventBus.emit(Events.SCHEDULER_PAUSE);
  }

  

  
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

  

  
  private formatWindow() {
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = `${pad(this.policy.windowStartHour)}:${pad(this.policy.windowStartMinute)}`;
    const end = `${pad(this.policy.windowEndHour)}:${pad(this.policy.windowEndMinute)}`;
    return `${start}–${end} ${this.policy.timezone}`;
  }
}
