type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

export class Logger {
  private context: string;
  private minLevel: LogLevel;

  constructor(context: string, minLevel: LogLevel = 'INFO') {
    this.context = context;
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel];
  }

  private format(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const base = `[${timestamp}] [${level}] [${this.context}] ${message}`;
    if (data !== undefined) {
      return `${base} ${JSON.stringify(data)}`;
    }
    return base;
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog('DEBUG')) {
      console.debug(this.format('DEBUG', message, data));
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog('INFO')) {
      console.info(this.format('INFO', message, data));
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog('WARN')) {
      console.warn(this.format('WARN', message, data));
    }
  }

  error(message: string, data?: unknown): void {
    if (this.shouldLog('ERROR')) {
      console.error(this.format('ERROR', message, data));
    }
  }
}
