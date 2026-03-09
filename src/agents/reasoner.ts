import { createLogger, type Logger } from '../core/logger.js';
import type { Observation } from '../types/index.js';
import type { Decision } from './notification.js';
import type { StateMemory } from './stateMemory.js';

export class ReasonerAgent {
  #memory: StateMemory;
  #log: Logger;

  constructor(memory: StateMemory, logger?: Logger) {
    this.#memory = memory;
    this.#log = logger ?? createLogger('Reasoner');
  }

  async evaluate(observation: Observation): Promise<Decision> {
    const { latest_post_link, candidate_post_links, content_preview } = observation;

    const candidates = candidate_post_links && candidate_post_links.length > 0
      ? candidate_post_links
      : [latest_post_link];
    const cleanCandidates = candidates.map((link) => this.#normalizeUrl(link));

    this.#log.info(
      `Evaluating observation — top post: ${cleanCandidates[0]?.slice(0, 60) ?? 'unknown'}…`,
    );

    const recentPosts = await this.#memory.getRecentPosts();

    if (recentPosts.length === 0) {
      // First ever run — seed the memory, don't trigger notification
      const seedLink = candidates[0];
      this.#log.info('No prior state found — seeding memory on first run.');
      await this.#memory.setLastPost(seedLink);
      return { changeDetected: false, postLink: null };
    }

    const cleanRecents = recentPosts.map((p) => this.#normalizeUrl(p));

    // Find the first candidate that is not already in recent history
    const firstNewIndex = cleanCandidates.findIndex(
      (candidate) => !cleanRecents.includes(candidate),
    );

    if (firstNewIndex === -1) {
      this.#log.info('All observed posts already seen recently — no notification needed.');
      return { changeDetected: false, postLink: null };
    }

    const selectedLink = candidates[firstNewIndex];
    const cleanSelected = cleanCandidates[firstNewIndex];

    // New post detected!
    this.#log.info(`New post detected! Previous: ${cleanRecents[0]?.slice(0, 60) ?? 'none'}…`);
    this.#log.info(`New link: ${cleanSelected.slice(0, 60)}…`);
    return { changeDetected: true, postLink: selectedLink, contentPreview: content_preview };
  }


  #normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return url.split('?')[0]; // fallback
    }
  }
}
