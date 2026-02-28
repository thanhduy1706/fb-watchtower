/**
 * Scheduler Agent type definitions.
 */

/** Execution permission signal emitted by the Scheduler Agent. */
export type Signal = 'RUN' | 'PAUSE';

/** Policy configuration governing the operational window. */
export interface SchedulerPolicy {
  /** Start hour of the operational window (0–23, inclusive). */
  windowStartHour: number;
  /** Start minute of the operational window (0–59). */
  windowStartMinute: number;
  /** End hour of the operational window (0–23, exclusive). */
  windowEndHour: number;
  /** End minute of the operational window (0–59). */
  windowEndMinute: number;
  /** IANA timezone identifier (e.g. 'Asia/Ho_Chi_Minh'). */
  timezone: string;
  /** How often the scheduler checks the time, in milliseconds. */
  pollingIntervalMs: number;
}

/** Immutable snapshot of the Scheduler Agent's internal state. */
export interface SchedulerState {
  /** Current signal being emitted. */
  currentSignal: Signal;
  /** ISO 8601 timestamp of the last time check. */
  lastCheck: string | null;
  /** Description of the last error, if any. */
  lastError: string | null;
  /** Whether the agent resolved time successfully on last tick. */
  isHealthy: boolean;
  /** Whether the agent's polling loop is active. */
  isRunning: boolean;
}

/** Entry in the signal transition history log. */
export interface SignalTransition {
  /** The signal that was emitted. */
  signal: Signal;
  /** ISO 8601 timestamp of the transition. */
  timestamp: string;
  /** Reason for the transition. */
  reason: string;
}
