import winston from 'winston';

export interface Logger {
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
  debug(...args: any[]): void;
}

const customFormat = winston.format.printf(({ level, message, label, timestamp, ...meta }) => {
  const time = `\x1b[90m${timestamp}\x1b[0m`;

  let levelTag: string;
  switch (level.toLowerCase()) {
    case 'error':
      levelTag = '\x1b[41m\x1b[37m ✖ ERROR \x1b[0m';
      break;
    case 'warn':
      levelTag = '\x1b[43m\x1b[30m ⚠ WARN  \x1b[0m';
      break;
    case 'info':
      levelTag = '\x1b[44m\x1b[37m ℹ INFO  \x1b[0m';
      break;
    case 'debug':
    default:
      levelTag = '\x1b[45m\x1b[37m 🐞 DEBUG \x1b[0m';
      break;
  }

  const lbl = label ? `[\x1b[36m${label}\x1b[0m]` : '';
  const metaObj = Object.keys(meta).length ? meta : null;
  const metaLine = metaObj ? `\n\x1b[90m${JSON.stringify(metaObj, null, 2)}\x1b[0m` : '';

  return `${time} ${levelTag} ${lbl} ${message}${metaLine}`.trimEnd();
});

export const systemLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.DEBUG ? 'debug' : 'info'),
  format: winston.format.combine(winston.format.timestamp(), winston.format.colorize()),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: false }), 
        customFormat,
      ),
    }),
  ],
});

export function createLogger(name: string): Logger {
  const child = systemLogger.child({ label: name });

  return {
    info: (...args: any[]) => child.info(formatArgs(args)),
    warn: (...args: any[]) => child.warn(formatArgs(args)),
    error: (...args: any[]) => child.error(formatArgs(args)),
    debug: (...args: any[]) => child.debug(formatArgs(args)),
  };
}




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
