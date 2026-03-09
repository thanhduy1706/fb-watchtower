export interface Observation {
  latest_post_link: string;
  candidate_post_links?: string[];
  extracted_at: string;
  content_preview: string;
  raw_dom_hash: string;
}

export interface SelectorEntry {
  name: string;
  selectors: string[];
}

export interface SelectorConfig {
  feedContainer: SelectorEntry;
  postItem: SelectorEntry;
  postPermalink: SelectorEntry;
  postContent: SelectorEntry;
}

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

export interface MonitoringAgentConfig {
  pageUrl: string;
  maxRetries: number;
  retryDelayMs: number;
  navigationTimeoutMs: number;
  selectorTimeoutMs: number;
  userAgent: string;
  viewport: { width: number; height: number };
  cookies?: CookieInput[];
}
