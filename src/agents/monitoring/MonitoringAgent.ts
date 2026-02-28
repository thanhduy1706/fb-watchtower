import { createHash } from 'node:crypto';
import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { MonitoringAgentConfig, Observation, SelectorEntry } from '../../types/index.js';
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

    // Step 2: Wait a moment for JS to hydrate the JSON blobs
    await this.sleep(3000);

    // Step 3: Extract post IDs from HTML
    const html = await this.page.content();

    // Facebook obfuscates the JSON in the DOM, so we use regex to find the ID.
    // It usually appears as "top_level_post_id":"12345" or HTML-encoded variants.
    const regexOptions = [
      /"top_level_post_id":"(\d+)"/g,
      /&quot;top_level_post_id&quot;:&quot;(\d+)&quot;/g,
      /"post_id":"(\d+)"/g,
      /&quot;post_id&quot;:&quot;(\d+)&quot;/g
    ];

    const extractedIds = new Set<string>();
    for (const regex of regexOptions) {
      let match;
      while ((match = regex.exec(html)) !== null) {
        extractedIds.add(match[1]);
      }
    }

    const postIds = Array.from(extractedIds);

    if (postIds.length === 0) {
      throw new MonitoringError(
        MonitoringErrorCode.EXTRACTION_FAILED,
        'Could not locate any post IDs in the page source via JSON blobs.',
        { retryable: true },
      );
    }

    // Assuming the first ID found is the most recent or pinned post
    const latestPostId = postIds[0];

    // Normalize absolute URL
    const baseUrl = this.config.pageUrl.endsWith('/') ? this.config.pageUrl.slice(0, -1) : this.config.pageUrl;
    const permalink = `${baseUrl}/posts/${latestPostId}`;

    // Step 4: Extract content preview (best effort)
    // Attempting to extract text from the DOM is brittle; fallback to a generic message
    const contentPreview = `[Extracted post ID: ${latestPostId} via JSON blob] Check the link for full content.`;

    // Step 5: Compute DOM hash
    // Hashing the list of post IDs provides an extremely stable change detector for the feed!
    const changeSignature = postIds.slice(0, 10).join(',');
    const rawDomHash = createHash('sha256').update(changeSignature).digest('hex');

    const observation: Observation = {
      latest_post_link: permalink,
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
