import type { SelectorConfig } from '../types/index.js';


export const DEFAULT_SELECTOR_CONFIG: SelectorConfig = {
  feedContainer: {
    name: 'Feed Container',
    selectors: [
      
      '[role="feed"]',
      '[role="main"] [role="feed"]',
      
      'div[data-pagelet="ProfileTimeline"]',
      'div[data-pagelet="PageTimeline"]',
      'div[data-pagelet*="Feed"]',
      
      '#structured_composer_async_container ~ div',
    ],
  },
  postItem: {
    name: 'Post Item',
    selectors: [
      
      '[role="article"]',
      '[data-ad-preview="message"]',
      
      '[role="feed"] > div',
    ],
  },
  postPermalink: {
    name: 'Post Permalink',
    selectors: [
      
      'a[href*="/posts/"]',
      'a[href*="/photos/"]',
      'a[href*="/videos/"]',
      'a[href*="story_fbid"]',
      'a[href*="/permalink/"]',
      
      'a:has(abbr[data-utime])',
      'a:has(span[id^="jsc_"])',
      
      'a[role="link"][tabindex="0"]',
    ],
  },
  postContent: {
    name: 'Post Content',
    selectors: [
      
      '[data-ad-preview="message"]',
      '[data-ad-comet-preview="message"]',
      
      '[dir="auto"]',
      
      'span[dir="auto"]',
    ],
  },
};
