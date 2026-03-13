


export type Signal = 'RUN' | 'PAUSE';


export interface SchedulerPolicy {
  
  windowStartHour: number;
  
  windowStartMinute: number;
  
  windowEndHour: number;
  
  windowEndMinute: number;
  
  timezone: string;
  
  pollingIntervalMs: number;
}


export interface SchedulerState {
  
  currentSignal: Signal;
  
  lastCheck: string | null;
  
  lastError: string | null;
  
  isHealthy: boolean;
  
  isRunning: boolean;
}


export interface SignalTransition {
  
  signal: Signal;
  
  timestamp: string;
  
  reason: string;
}
