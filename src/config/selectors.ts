import type { SelectorConfig } from '../types/index.js';

/**
 * Default Facebook page selectors with fallbacks.
 *
 * Facebook's DOM is heavily obfuscated — class names are generated and change
 * frequently. These selectors rely on structural patterns and data attributes
 * that tend to be more stable. They WILL need periodic recalibration.
 */
export const DEFAULT_SELECTOR_CONFIG: SelectorConfig = {
  feedContainer: {
    name: 'Feed Container',
    selectors: [
      // Role-based selectors (most stable)
      '[role="feed"]',
      '[role="main"] [role="feed"]',
      // Structural fallbacks
      'div[data-pagelet="ProfileTimeline"]',
      'div[data-pagelet="PageTimeline"]',
      'div[data-pagelet*="Feed"]',
      // Legacy / broad fallback
      '#structured_composer_async_container ~ div',
    ],
  },
  postItem: {
    name: 'Post Item',
    selectors: [
      // Posts inside a feed are typically direct children with role="article"
      '[role="article"]',
      '[data-ad-preview="message"]',
      // Structural: divs that look like post wrappers
      '[role="feed"] > div',
    ],
  },
  postPermalink: {
    name: 'Post Permalink',
    selectors: [
      // Timestamp links typically contain the permalink
      'a[href*="/posts/"]',
      'a[href*="/photos/"]',
      'a[href*="/videos/"]',
      'a[href*="story_fbid"]',
      'a[href*="/permalink/"]',
      // Fallback: any link with an absolute time element inside it
      'a:has(abbr[data-utime])',
      'a:has(span[id^="jsc_"])',
      // Very broad fallback: links that look like timestamps
      'a[role="link"][tabindex="0"]',
    ],
  },
  postContent: {
    name: 'Post Content',
    selectors: [
      // Data attribute selectors
      '[data-ad-preview="message"]',
      '[data-ad-comet-preview="message"]',
      // Structural: the text block within a post
      '[dir="auto"]',
      // Broad fallback
      'span[dir="auto"]',
    ],
  },
};
