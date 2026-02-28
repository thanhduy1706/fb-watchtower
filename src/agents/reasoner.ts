import { createLogger, type Logger } from '../core/logger.js';
import type { Observation } from '../types/index.js';
import type { Decision } from './notification.js';
import type { StateMemory } from './stateMemory.js';

/**
 * Reasoner (Decision) Agent
 *
 * Compares the latest observed post link against the stored state.
 * Returns a Decision that drives whether a Slack notification is sent.
 */
export class ReasonerAgent {
  #memory: StateMemory;
  #log: Logger;

  constructor(memory: StateMemory, logger?: Logger) {
    this.#memory = memory;
    this.#log = logger ?? createLogger('Reasoner');
  }

  /**
   * Evaluate an observation against the persisted state.
   *
   * - Fetches the last seen post link from the database.
   * - Compares it to the newly observed post link.
   * - Returns changeDetected=true if the post is new.
   */
  async evaluate(observation: Observation): Promise<Decision> {
    const { latest_post_link, content_preview } = observation;
    const cleanCurrent = this.#normalizeUrl(latest_post_link);

    this.#log.info(`Evaluating observation — post: ${cleanCurrent.slice(0, 60)}…`);

    const recentPosts = await this.#memory.getRecentPosts();

    if (recentPosts.length === 0) {
      // First ever run — seed the memory, don't trigger notification
      this.#log.info('No prior state found — seeding memory on first run.');
      await this.#memory.setLastPost(cleanCurrent);
      return { changeDetected: false, postLink: null };
    }

    const cleanRecents = recentPosts.map((p) => this.#normalizeUrl(p));

    if (cleanRecents.includes(cleanCurrent)) {
      this.#log.info('Post already seen recently — no notification needed.');
      return { changeDetected: false, postLink: null };
    }

    // New post detected!
    this.#log.info(`New post detected! Previous: ${cleanRecents[0]?.slice(0, 60) ?? 'none'}…`);
    this.#log.info(`New link: ${cleanCurrent.slice(0, 60)}…`);
    return { changeDetected: true, postLink: cleanCurrent, contentPreview: content_preview };
  }

  /**
   * Strip dynamic Facebook query parameters (e.g., __cft__, __tn__)
   * which change on every scrape, to ensure stable equality checks.
   */
  #normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return url.split('?')[0]; // fallback
    }
  }
}
