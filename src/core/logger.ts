import winston from 'winston';

export interface Logger {
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
  debug(...args: any[]): void;
}

// ── Shared Winston Instance ──────────────────────────────────────

const customFormat = winston.format.printf(({ level, message, label, timestamp, ...meta }) => {
  const lbl = label ? `[\x1b[36m${label}\x1b[0m] ` : '';
  const objArgs = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
  return `\x1b[90m${timestamp}\x1b[0m ${level}: ${lbl}${message}${objArgs}`;
});

export const systemLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.DEBUG ? 'debug' : 'info'),
  format: winston.format.combine(winston.format.timestamp(), winston.format.colorize()),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: false }), // colorize level output automatically
        customFormat,
      ),
    }),
  ],
});

/**
 * Lightweight structured logger wrapper.
 * Each agent receives a child logger prefixed with its context label.
 */
export function createLogger(name: string): Logger {
  const child = systemLogger.child({ label: name });

  return {
    info: (...args: any[]) => child.info(formatArgs(args)),
    warn: (...args: any[]) => child.warn(formatArgs(args)),
    error: (...args: any[]) => child.error(formatArgs(args)),
    debug: (...args: any[]) => child.debug(formatArgs(args)),
  };
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Format string arguments sequentially, simulating standard console.log array parsing.
 */
function formatArgs(args: any[]): string {
  return args
    .map((arg) => {
      if (errToJSON && arg instanceof Error) {
        return errToJSON(arg);
      }
      return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
    })
    .join(' ');
}

function errToJSON(err: Error): string {
  return err.stack ? err.stack : err.message;
}
