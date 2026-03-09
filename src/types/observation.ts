/**
 * Structured observation returned by the Monitoring Agent.
 */
export interface Observation {
  /** Permalink URL to the latest post */
  latest_post_link: string;
  /**
   * Ordered list of candidate post permalinks observed on the page
   * (most prominent / newest-first). Includes latest_post_link as
   * the first element when present.
   */
  candidate_post_links?: string[];
  /** ISO 8601 timestamp of when the extraction occurred */
  extracted_at: string;
  /** Truncated text content preview of the post (max 280 chars) */
  content_preview: string;
  /** SHA-256 hash of the posts container DOM for change detection */
  raw_dom_hash: string;
}

/**
 * Configuration for a single selector with ordered fallbacks.
 */
export interface SelectorEntry {
  /** Human-readable name for logging */
  name: string;
  /** Ordered list of CSS selectors to try (first match wins) */
  selectors: string[];
}

/**
 * Full selector configuration for the monitoring agent.
 */
export interface SelectorConfig {
  /** Selectors for the posts feed container */
  feedContainer: SelectorEntry;
  /** Selectors for individual post wrappers */
  postItem: SelectorEntry;
  /** Selectors for the permalink anchor within a post */
  postPermalink: SelectorEntry;
  /** Selectors for the text content within a post */
  postContent: SelectorEntry;
}

/**
 * A single browser cookie to inject into the monitoring session.
 * Matches Playwright's AddCookie shape.
 */
export interface CookieInput {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * Configuration for the Monitoring Agent runtime behaviour.
 */
export interface MonitoringAgentConfig {
  /** Target Facebook page URL */
  pageUrl: string;
  /** CSS selector configuration with fallbacks */
  selectors: SelectorConfig;
  /** Maximum number of navigation retries */
  maxRetries: number;
  /** Base delay between retries in ms (exponential backoff applied) */
  retryDelayMs: number;
  /** Navigation timeout in ms */
  navigationTimeoutMs: number;
  /** Timeout for waiting on selectors in ms */
  selectorTimeoutMs: number;
  /** User-Agent string override */
  userAgent: string;
  /** Viewport dimensions */
  viewport: { width: number; height: number };
  /**
   * Optional authenticated session cookies to inject into the browser context.
   * Required for pages behind a login wall (e.g. Facebook).
   */
  cookies?: CookieInput[];
}
