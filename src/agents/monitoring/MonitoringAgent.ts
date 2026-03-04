import { createHash } from 'node:crypto';
import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { MonitoringAgentConfig, Observation } from '../../types/index.js';
import { DEFAULT_AGENT_CONFIG } from '../../config/index.js';
import { MonitoringError, MonitoringErrorCode } from './errors.js';
import { createLogger, type Logger } from '../../core/logger.js';

// Apply stealth plugin globally to playwright-extra
chromium.use(stealthPlugin());

/**
 * Monitoring (Perception) Agent
 *
 * Launches a headless Chromium browser via Playwright, navigates to a target
 * Facebook page, extracts the latest post metadata via embedded JSON blobs,
 * and returns a structured observation object.
 *
 * Resilience features:
 * - Playwright Stealth plugin to evade bot detection
 * - Retry navigation up to N times with exponential backoff
 * - Structured error reporting
 */
export class MonitoringAgent {
  private config: MonitoringAgentConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private logger: Logger;

  constructor(config: Partial<MonitoringAgentConfig> & { pageUrl: string }) {
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config };
    this.logger = createLogger('Monitor');
  }

  // Lifecycle

  /**
   * Launch headless Chromium and create an isolated browser context.
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing browser...');
    try {
      this.browser = await chromium.launch({ headless: true });
      this.context = await this.browser.newContext({
        userAgent: this.config.userAgent,
        viewport: this.config.viewport,
        locale: 'en-US',
        timezoneId: 'America/New_York',
      });
      this.page = await this.context.newPage();
      this.logger.info('Browser initialized successfully.');
    } catch (err) {
      throw new MonitoringError(
        MonitoringErrorCode.BROWSER_LAUNCH_FAILED,
        `Failed to launch browser: ${(err as Error).message}`,
        { retryable: false, cause: err as Error },
      );
    }
  }

  /**
   * Close the browser context and browser instance.
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down browser...');
    try {
      await this.context?.close();
      await this.browser?.close();
    } catch {
      // Best-effort shutdown; ignore errors
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.logger.info('Browser shut down.');
  }

  // Main Pipeline

  /**
   * Full observation pipeline:
   * 1. Navigate to the target page (with retries)
   * 2. Wait for DOM readiness
   * 3. Extract latest post permalink via embedded JSON Blob (bypasses login wall)
   * 4. Compute hash
   * 5. Return structured Observation
   */
  async observe(): Promise<Observation> {
    if (!this.page) {
      throw new MonitoringError(
        MonitoringErrorCode.BROWSER_LAUNCH_FAILED,
        'Browser not initialized. Call initialize() first.',
        { retryable: false },
      );
    }

    // Step 1: Navigate with retries
    await this.navigateWithRetry();

    // Step 2 & 3: Poll the DOM for post IDs with early exit
    const maxWaitMs = this.config.selectorTimeoutMs;
    const pollIntervalMs = 500;
    const startTime = Date.now();
    let postIds: string[] = [];

    while (Date.now() - startTime < maxWaitMs) {
      const html = await this.page.content();
      postIds = this.#extractPostIdsFromHtml(html);
      if (postIds.length > 0) {
        break;
      }
      await this.sleep(pollIntervalMs);
    }

    // Fallback: attempt DOM-based extraction via configured selectors
    if (postIds.length === 0) {
      postIds = await this.#extractPostIdsFromDom();
    }

    if (postIds.length === 0) {
      throw new MonitoringError(
        MonitoringErrorCode.EXTRACTION_FAILED,
        'Could not locate any post IDs in the page source via JSON blobs or DOM selectors.',
        { retryable: true },
      );
    }

    // Build ordered list of candidate permalinks (most prominent first)
    const baseUrl = this.config.pageUrl.endsWith('/')
      ? this.config.pageUrl.slice(0, -1)
      : this.config.pageUrl;
    const candidateLinks = postIds.map((id) => `${baseUrl}/posts/${id}`);
    const permalink = candidateLinks[0];

    // Step 4: Extract content preview (best effort)
    // Attempting to extract text from the DOM is brittle; fallback to a generic message
    const contentPreview = `[Extracted post ID: ${postIds[0]} via JSON blob] Check the link for full content.`;

    // Step 5: Compute DOM hash
    // Hashing the list of post IDs provides an extremely stable change detector for the feed!
    const changeSignature = postIds.slice(0, 10).join(',');
    const rawDomHash = createHash('sha256').update(changeSignature).digest('hex');

    const observation: Observation = {
      latest_post_link: permalink,
      candidate_post_links: candidateLinks,
      extracted_at: new Date().toISOString(),
      content_preview: contentPreview,
      raw_dom_hash: rawDomHash,
    };

    this.logger.info('Observation complete.', observation);
    return observation;
  }

  // Navigation

  /**
   * Navigate to the target page with retry and exponential backoff.
   */
  private async navigateWithRetry(): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        this.logger.info(`Navigation attempt ${attempt}/${this.config.maxRetries}...`);
        await this.page!.goto(this.config.pageUrl, {
          waitUntil: 'domcontentloaded',
          timeout: this.config.navigationTimeoutMs,
        });
        this.logger.info('Navigation succeeded.');
        return;
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(`Navigation attempt ${attempt} failed: ${lastError.message}`);

        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          this.logger.info(`Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    throw new MonitoringError(
      MonitoringErrorCode.NAVIGATION_FAILED,
      `Navigation failed after ${this.config.maxRetries} attempts: ${lastError?.message}`,
      { retryable: true, cause: lastError },
    );
  }



  // Utilities

  /**
   * Extract candidate post IDs from the raw HTML using multiple resilient patterns.
   */
  #extractPostIdsFromHtml(html: string): string[] {
    // Facebook obfuscates the JSON/DOM, so we use multiple strategies to find post IDs.
    // Common patterns include:
    //  • "top_level_post_id":"12345" or "top_level_post_id":"pfbid0..."
    //  • "post_id":"12345"
    //  • "story_fbid":"12345" or "story_fbid":"pfbid0..."
    //  • Permalink URLs such as https://www.facebook.com/<page>/posts/12345 or /posts/pfbid0...
    const regexOptions = [
      // JSON blobs (raw + HTML-encoded)
      /"top_level_post_id":"([^"]+)"/g,
      /&quot;top_level_post_id&quot;:&quot;([^"&]+)&quot;/g,
      /"post_id":"([^"]+)"/g,
      /&quot;post_id&quot;:&quot;([^"&]+)&quot;/g,
      /"story_fbid":"([^"]+)"/g,
      /&quot;story_fbid&quot;:&quot;([^"&]+)&quot;/g,
      // Permalink URLs (desktop / mobile / group variants all contain `/posts/<id>`)
      /\/posts\/([^?"'\\\s]+)/g,
      /story_fbid=([^&"'\\\s]+)/g,
    ];

    const extractedIds = new Set<string>();
    for (const regex of regexOptions) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(html)) !== null) {
        extractedIds.add(match[1]);
      }
    }

    return Array.from(extractedIds);
  }

  /**
   * Best-effort DOM-based fallback using configured permalink selectors.
   */
  async #extractPostIdsFromDom(): Promise<string[]> {
    if (!this.page) return [];

    const ids = new Set<string>();
    const permalinkSelectors = this.config.selectors.postPermalink.selectors;

    for (const selector of permalinkSelectors) {
      try {
        const elements = await this.page.$$(selector);
        for (const el of elements) {
          const href = await el.getAttribute('href');
          if (!href) continue;

          // Normalize relative URLs against base pageUrl
          let urlStr = href;
          if (href.startsWith('/')) {
            const base = new URL(this.config.pageUrl);
            urlStr = `${base.origin}${href}`;
          }

          try {
            const url = new URL(urlStr, this.config.pageUrl);

            // 1) /posts/<id> pattern
            const postsMatch = url.pathname.match(/\/posts\/([^/]+)/);
            if (postsMatch?.[1]) {
              ids.add(postsMatch[1]);
              continue;
            }

            // 2) story_fbid=<id> query parameter
            const storyId = url.searchParams.get('story_fbid');
            if (storyId) {
              ids.add(storyId);
              continue;
            }
          } catch {
            // Ignore malformed URLs and continue
          }
        }

        if (ids.size > 0) {
          break;
        }
      } catch {
        // Selector may be invalid on this variant of the page; continue to next
        continue;
      }
    }

    return Array.from(ids);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
