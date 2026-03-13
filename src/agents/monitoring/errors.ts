
export enum MonitoringErrorCode {
  NAVIGATION_FAILED = 'NAVIGATION_FAILED',
  SELECTOR_NOT_FOUND = 'SELECTOR_NOT_FOUND',
  EXTRACTION_FAILED = 'EXTRACTION_FAILED',
  TIMEOUT = 'TIMEOUT',
  BROWSER_LAUNCH_FAILED = 'BROWSER_LAUNCH_FAILED',
}


export class MonitoringError extends Error {
  readonly code: MonitoringErrorCode;
  readonly retryable: boolean;
  readonly cause?: Error;

  constructor(
    code: MonitoringErrorCode,
    message: string,
    options?: { retryable?: boolean; cause?: Error },
  ) {
    super(message);
    this.name = 'MonitoringError';
    this.code = code;
    this.retryable = options?.retryable ?? true;
    this.cause = options?.cause;
  }
}
