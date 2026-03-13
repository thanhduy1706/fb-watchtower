export type Subsystem = 'perception' | 'slack' | 'memory';

const SUBSYSTEMS: Subsystem[] = ['perception', 'slack', 'memory'];

export interface ResilienceOptions {
  maxConsecutiveFailures?: number;
  maxCycleDurationMs?: number;
  rollingWindowSize?: number;
  onRecover?: (subsystem: string, error: Error) => void;
  onAlert?: (message: string) => void;
}

export interface ResilienceMetrics {
  consecutiveFailures: Record<string, number>;
  totalFailures: Record<string, number>;
  lastCycleDurationMs: number | null;
  cycleDurations: number[];
  alertsSent: number;
}

export class ResilienceAgent {
  public maxConsecutiveFailures: number;
  public maxCycleDurationMs: number;
  public rollingWindowSize: number;
  public onRecover: ((subsystem: string, error: Error) => void) | null;
  public onAlert: ((message: string) => void) | null;

  private consecutiveFailures: Record<string, number>;
  private totalFailures: Record<string, number>;

  private lastCycleStartMs: number | null;
  private lastCycleDurationMs: number | null;
  private cycleDurations: number[];
  private alertsSent: number;

  constructor(options: ResilienceOptions = {}) {
    this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? 3;
    this.maxCycleDurationMs = options.maxCycleDurationMs ?? 60_000;
    this.rollingWindowSize = options.rollingWindowSize ?? 20;
    this.onRecover = options.onRecover ?? null;
    this.onAlert = options.onAlert ?? null;

    this.consecutiveFailures = {};
    this.totalFailures = {};
    for (const s of SUBSYSTEMS) {
      this.consecutiveFailures[s] = 0;
      this.totalFailures[s] = 0;
    }

    this.lastCycleStartMs = null;
    this.lastCycleDurationMs = null;
    this.cycleDurations = [];
    this.alertsSent = 0;
  }

  
  recordSuccess(subsystem: Subsystem): void {
    this._assertSubsystem(subsystem);
    this.consecutiveFailures[subsystem] = 0;
  }

  
  recordFailure(subsystem: Subsystem, error: Error): void {
    this._assertSubsystem(subsystem);

    this.consecutiveFailures[subsystem] = (this.consecutiveFailures[subsystem] || 0) + 1;
    this.totalFailures[subsystem] = (this.totalFailures[subsystem] || 0) + 1;

    if (this.consecutiveFailures[subsystem] >= this.maxConsecutiveFailures) {
      this._triggerRecovery(subsystem, error);
    }
  }

  
  startCycle(): void {
    this.lastCycleStartMs = Date.now();
  }

  
  endCycle(): void {
    if (this.lastCycleStartMs === null) {
      return;
    }

    const duration = Date.now() - this.lastCycleStartMs;
    this.lastCycleDurationMs = duration;

    this.cycleDurations.push(duration);
    if (this.cycleDurations.length > this.rollingWindowSize) {
      this.cycleDurations.shift();
    }

    if (duration > this.maxCycleDurationMs) {
      this._sendAlert(
        `[SLOW CYCLE] Duration ${duration}ms exceeded threshold of ${this.maxCycleDurationMs}ms`,
      );
    }

    this.lastCycleStartMs = null;
  }

  
  getMetrics(): ResilienceMetrics {
    return Object.freeze({
      consecutiveFailures: { ...this.consecutiveFailures },
      totalFailures: { ...this.totalFailures },
      lastCycleDurationMs: this.lastCycleDurationMs,
      cycleDurations: [...this.cycleDurations],
      alertsSent: this.alertsSent,
    });
  }

  
  reset(): void {
    for (const s of SUBSYSTEMS) {
      this.consecutiveFailures[s] = 0;
    }
  }

  

  private _assertSubsystem(subsystem: string): asserts subsystem is Subsystem {
    if (!SUBSYSTEMS.includes(subsystem as Subsystem)) {
      throw new Error(
        `Unknown subsystem "${subsystem}". Expected one of: ${SUBSYSTEMS.join(', ')}`,
      );
    }
  }

  private _triggerRecovery(subsystem: Subsystem, error: Error): void {
    const message =
      `[RECOVERY] Subsystem "${subsystem}" failed ${this.consecutiveFailures[subsystem]} ` +
      `consecutive times. Last error: ${error?.message ?? String(error)}`;

    this.consecutiveFailures[subsystem] = 0;

    if (this.onRecover) {
      try {
        this.onRecover(subsystem, error);
      } catch {
        
      }
    }

    this._sendAlert(message);
  }

  private _sendAlert(message: string): void {
    this.alertsSent += 1;

    if (this.onAlert) {
      try {
        this.onAlert(message);
      } catch {
        
      }
    }
  }
}
