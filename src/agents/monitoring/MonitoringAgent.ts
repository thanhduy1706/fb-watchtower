import { createHash } from 'node:crypto';
import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { MonitoringAgentConfig, Observation } from '../../types/index.js';
import { DEFAULT_AGENT_CONFIG } from '../../config/index.js';
import { MonitoringError, MonitoringErrorCode } from './errors.js';
import { createLogger, type Logger } from '../../core/logger.js';


chromium.use(stealthPlugin());





const numericIdPattern = /^[0-9]{10,}$/;
const pfbIdPattern = /^pfbid[A-Za-z0-9_-]{5,}$/;


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

      
      if (this.config.cookies && this.config.cookies.length > 0) {
        await this.context.addCookies(this.config.cookies);
        this.logger.info(`Injected ${this.config.cookies.length} session cookie(s).`);
      } else {
        this.logger.warn('No session cookies configured — unauthenticated pages may hit a login wall.');
      }

      this.page = await this.context.newPage();
      this.logger.info('Browser initialized successfully.');
    } catch (err) {
      let message = `Failed to launch browser: ${(err as Error).message}`;
      if (message.includes("Executable doesn't exist") || message.includes("playwright install")) {
        message += "\n\n💡 INSTRUCTION TO FIX: Run 'npx playwright install chromium' to download the required browser binaries.";
      }
      throw new MonitoringError(
        MonitoringErrorCode.BROWSER_LAUNCH_FAILED,
        message,
        { retryable: false, cause: err as Error },
      );
    }
  }

  
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down browser...');
    try {
      await this.context?.close();
      await this.browser?.close();
    } catch (err) {
      this.logger.debug(`Error during browser shutdown: ${(err as Error).message}`);
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.logger.info('Browser shut down.');
  }

  

  
  async observe(): Promise<Observation> {
    if (!this.page) {
      throw new MonitoringError(
        MonitoringErrorCode.BROWSER_LAUNCH_FAILED,
        'Browser not initialized. Call initialize() first.',
        { retryable: false },
      );
    }

    
    await this.navigateWithRetry();

    
    const currentUrl = this.page.url();
    if (currentUrl.includes('/login')) {
      this.logger.warn(
        `Login wall detected — redirected to: ${currentUrl}. Post extraction will likely fail. Consider using authenticated cookies.`,
      );
      throw new MonitoringError(
        MonitoringErrorCode.EXTRACTION_FAILED,
        'Redirected to Facebook login wall. Provide valid session cookies via FACEBOOK_COOKIES env var.',
        { retryable: false },
      );
    }

    
    const maxWaitMs = this.config.selectorTimeoutMs;
    const pollIntervalMs = 500;
    const startTime = Date.now();
    let postIds: string[] = [];

    while (Date.now() - startTime < maxWaitMs) {
      const html = await this.page.content();
      postIds = this.#extractPostIdsFromHtml(html);
      if (postIds.length > 0) {
        this.logger.info(`Found initial post IDs. Waiting 2s for dynamic feed items to load...`);
        await this.sleep(2000);
        const finalHtml = await this.page.content();
        postIds = this.#extractPostIdsFromHtml(finalHtml);
        break;
      }
      await this.sleep(pollIntervalMs);
    }

    
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

    
    const baseUrl = this.config.pageUrl.endsWith('/')
      ? this.config.pageUrl.slice(0, -1)
      : this.config.pageUrl;
    const candidateLinks = postIds.map((id) => `${baseUrl}/posts/${id}`);
    const permalink = candidateLinks[0];

    
    
    const contentPreview = `[Extracted post ID: ${postIds[0]} via JSON blob] Check the link for full content.`;

    
    
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

        
        const currentUrl = this.page!.url();
        if (
          currentUrl.includes('/login') ||
          currentUrl.includes('login.php') ||
          currentUrl.includes('checkpoint')
        ) {
          this.logger.warn(
            `Login wall detected — redirected to: ${currentUrl}. ` +
            'Post extraction will likely fail. Consider using authenticated cookies.',
          );
        }

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



  

  
  #extractPostIdsFromHtml(html: string): string[] {
    
    
    
    
    
    
    
    
    
    
    
    const regexOptions = [
      
      /"top_level_post_id":"([^"]+)"/g,
      /"post_id":"([^"]+)"/g,
      /"story_fbid":"([^"]+)"/g,

      // ── Newer Relay / __bbox patterns ─────────────────────────────────────
      // e.g. {"__bbox":{"result":{"data":{"node":{"id":"..."}}}}
      /"node_id":"([0-9]{10,})"/g,
      /"unified_story_id":"([^"]+)"/g,
      /"bbId":"([^"]+)"/g,
      // CometFeedStory relay: "fluxstore_key":"pfbid0..."
      /"fluxstore_key":"(pfbid[A-Za-z0-9_-]+)"/g,
      // Generic large numeric IDs embedded near "post" key context
      /"post":\{"id":"([0-9]{10,})"/g,
      /"post_id":([0-9]{10,})/g,
      // story_id used in some newer mobile layouts
      /"story_id":"([^"]+)"/g,
      
      /\/posts\/(pfbid[A-Za-z0-9_-]+)/g,
      /\/posts\/([0-9]{10,})/g,
      /story_fbid=([^&"'\\\s]+)/g,
      /\/permalink\/([0-9]{10,})/g,
      // ── HTML-entity-encoded variants ──────────────────────────────────────
      /&quot;top_level_post_id&quot;:&quot;([^"&]+)&quot;/g,
      /&quot;post_id&quot;:&quot;([^"&]+)&quot;/g,
      /&quot;story_fbid&quot;:&quot;([^"&]+)&quot;/g,
      /&quot;story_id&quot;:&quot;([^"&]+)&quot;/g,
    ];

    const extractedIds = new Set<string>();

    // Scan raw HTML
    for (const regex of regexOptions) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(html)) !== null) {
        const id = match[1];
        // Basic sanity: must be non-empty and either numeric or a pfbid token
        if (id && (pfbIdPattern.test(id) || numericIdPattern.test(id))) {
          extractedIds.add(id);
        }
      }
    }

    // Also scan HTML-entity decoded version to catch doubly-encoded blobs
    if (extractedIds.size === 0) {
      const decoded = html
        .replaceAll('&quot;', '"')
        .replaceAll('&amp;', '&')
        .replaceAll('&#34;', '"');
      for (const regex of regexOptions) {
        regex.lastIndex = 0; // reset stateful regex
        let match: RegExpExecArray | null;
        while ((match = regex.exec(decoded)) !== null) {
          const id = match[1];
          if (id && (pfbIdPattern.test(id) || numericIdPattern.test(id))) {
            extractedIds.add(id);
          }
        }
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
