import type { MonitoringAgentConfig } from '../types/index.js';
import { DEFAULT_SELECTOR_CONFIG } from './selectors.js';

/**
 * Default Monitoring Agent configuration.
 * Override individual fields via partial config at construction time.
 */
export const DEFAULT_AGENT_CONFIG: MonitoringAgentConfig = {
  pageUrl: '',
  selectors: DEFAULT_SELECTOR_CONFIG,
  maxRetries: 3,
  retryDelayMs: 1_000,
  navigationTimeoutMs: 30_000,
  selectorTimeoutMs: 10_000,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1_280, height: 800 },
};
