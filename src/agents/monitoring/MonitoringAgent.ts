import { createHash } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { MonitoringAgentConfig, Observation, SelectorEntry } from '../../types/index.js';
import { DEFAULT_AGENT_CONFIG } from '../../config/index.js';
import { MonitoringError, MonitoringErrorCode } from './errors.js';
import { createLogger, type Logger } from '../../core/logger.js';

/**
 * Monitoring (Perception) Agent
 *
 * Launches a headless Chromium browser via Playwright, navigates to a target
 * Facebook page, extracts the latest post permalink and metadata, and returns
 * a structured observation object.
 *
 * Resilience features:
 * - Retry navigation up to N times with exponential backoff
 * - Fallback CSS selectors for each extraction target
 * - Separate timeouts for navigation and selector waits
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
   * 3. Dismiss any overlays (cookie consent, login modals)
   * 4. Extract latest post permalink + metadata
   * 5. Compute DOM hash
   * 6. Return structured Observation
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

    // Step 2: Dismiss overlays
    await this.dismissOverlays();

    // Step 3: Wait for feed container
    const feedEl = await this.resolveSelector(this.config.selectors.feedContainer);
    if (!feedEl) {
      throw new MonitoringError(
        MonitoringErrorCode.SELECTOR_NOT_FOUND,
        'Could not locate the feed container on the page.',
        { retryable: true },
      );
    }

    // Step 4: Find the latest post
    const postEl = await this.resolveSelector(this.config.selectors.postItem);
    if (!postEl) {
      throw new MonitoringError(
        MonitoringErrorCode.SELECTOR_NOT_FOUND,
        'Could not locate any post items in the feed.',
        { retryable: true },
      );
    }

    // Step 5: Extract permalink
    const permalink = await this.extractPermalink(postEl);

    // Step 6: Extract content preview
    const contentPreview = await this.extractContentPreview(postEl);

    // Step 7: Compute DOM hash of the feed
    const rawDomHash = await this.computeDomHash(feedEl);

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

  // Overlay Dismissal

  /**
   * Attempt to dismiss common Facebook overlays:
   * - Cookie consent banners
   * - Login modals
   */
  private async dismissOverlays(): Promise<void> {
    const overlaySelectors = [
      // Cookie consent buttons
      'button[data-cookiebanner="accept_button"]',
      'button[data-testid="cookie-policy-manage-dialog-accept-button"]',
      'button[title="Allow all cookies"]',
      'button[title="Accept All"]',
      // "Not Now" on login modals
      'div[role="dialog"] a[role="button"]',
      'div[role="dialog"] button:has-text("Not Now")',
      'div[role="dialog"] button:has-text("Close")',
      // "See more" / "Continue" overlays
      'a[role="button"]:has-text("Not now")',
    ];

    for (const selector of overlaySelectors) {
      try {
        const el = await this.page!.$(selector);
        if (el) {
          await el.click();
          this.logger.debug(`Dismissed overlay: ${selector}`);
          await this.sleep(500); // Brief pause after dismissal
        }
      } catch {
        // Overlay not found or not clickable — safe to ignore
      }
    }
  }

  // Selector Resolution

  /**
   * Try each selector in a SelectorEntry in order.
   * Returns the first matching ElementHandle, or null if none match.
   */
  private async resolveSelector(
    entry: SelectorEntry,
  ): Promise<import('playwright').ElementHandle | null> {
    for (const selector of entry.selectors) {
      try {
        this.logger.debug(`Trying selector [${entry.name}]: ${selector}`);
        const el = await this.page!.waitForSelector(selector, {
          timeout: this.config.selectorTimeoutMs,
          state: 'attached',
        });
        if (el) {
          this.logger.debug(`Matched selector [${entry.name}]: ${selector}`);
          return el;
        }
      } catch {
        this.logger.debug(`Selector not found [${entry.name}]: ${selector}`);
      }
    }

    this.logger.warn(`All selectors exhausted for [${entry.name}]`);
    return null;
  }

  // Extraction

  /**
   * Extract the permalink from the first matching post element.
   * Walks through the postPermalink selector entries within the post scope.
   */
  private async extractPermalink(postEl: import('playwright').ElementHandle): Promise<string> {
    for (const selector of this.config.selectors.postPermalink.selectors) {
      try {
        const linkEl = await postEl.$(selector);
        if (linkEl) {
          const href = await linkEl.getAttribute('href');
          if (href) {
            // Normalize: ensure absolute URL
            const absoluteUrl = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
            this.logger.debug(`Extracted permalink: ${absoluteUrl}`);
            return absoluteUrl;
          }
        }
      } catch {
        // Continue to next selector
      }
    }

    // Fallback: try getting any link from the post
    try {
      const anyLink = await postEl.$('a[href]');
      if (anyLink) {
        const href = await anyLink.getAttribute('href');
        if (href && (href.includes('/posts/') || href.includes('story_fbid'))) {
          const absoluteUrl = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
          return absoluteUrl;
        }
      }
    } catch {
      // Ignore
    }

    throw new MonitoringError(
      MonitoringErrorCode.EXTRACTION_FAILED,
      'Could not extract permalink from the latest post.',
      { retryable: true },
    );
  }

  /**
   * Extract a text content preview from the post, truncated to 280 characters.
   */
  private async extractContentPreview(postEl: import('playwright').ElementHandle): Promise<string> {
    for (const selector of this.config.selectors.postContent.selectors) {
      try {
        const contentEl = await postEl.$(selector);
        if (contentEl) {
          const text = await contentEl.textContent();
          if (text && text.trim().length > 0) {
            const preview = text.trim().slice(0, 280);
            this.logger.debug(`Extracted content preview: "${preview.slice(0, 50)}..."`);
            return preview;
          }
        }
      } catch {
        // Continue to next selector
      }
    }

    // If we can't extract content, return empty string rather than failing
    this.logger.warn('Could not extract content preview; returning empty string.');
    return '';
  }

  // DOM Hashing

  /**
   * Compute a SHA-256 hash of the feed container's innerHTML.
   * Used for change detection between observation cycles.
   */
  private async computeDomHash(feedEl: import('playwright').ElementHandle): Promise<string> {
    try {
      const innerHTML = await feedEl.evaluate((el: any) => el.innerHTML);
      const hash = createHash('sha256').update(innerHTML).digest('hex');
      this.logger.debug(`DOM hash: ${hash.slice(0, 16)}...`);
      return hash;
    } catch (err) {
      throw new MonitoringError(
        MonitoringErrorCode.EXTRACTION_FAILED,
        `Failed to compute DOM hash: ${(err as Error).message}`,
        { retryable: false, cause: err as Error },
      );
    }
  }

  // Utilities

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
