import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonitoringError, MonitoringErrorCode } from '../errors.js';
import type { MonitoringAgentConfig } from '../../../types/index.js';



const { mockLaunch, mockUse } = vi.hoisted(() => ({
  mockLaunch: vi.fn(),
  mockUse: vi.fn(),
}));

const mockGoto = vi.fn();
const mockPageContent = vi.fn();
const mockPageClose = vi.fn();
const mockContextNewPage = vi.fn();
const mockContextClose = vi.fn();
const mockBrowserNewContext = vi.fn();
const mockBrowserClose = vi.fn();

vi.mock('playwright-extra', () => ({
  chromium: {
    launch: (...args: unknown[]) => mockLaunch(...args),
    use: (...args: unknown[]) => mockUse(...args),
  },
}));

vi.mock('puppeteer-extra-plugin-stealth', () => ({
  default: vi.fn(() => ({})),
}));


import { MonitoringAgent } from '../MonitoringAgent.js';



function setupBrowserMocks() {
  const page = {
    goto: mockGoto,
    content: mockPageContent,
    close: mockPageClose,
    url: vi.fn(() => 'https://www.facebook.com/TestPage'),
    $$: vi.fn().mockResolvedValue([]),
  };
  const context = {
    newPage: mockContextNewPage.mockResolvedValue(page),
    close: mockContextClose,
  };
  const browser = {
    newContext: mockBrowserNewContext.mockResolvedValue(context),
    close: mockBrowserClose,
  };
  mockLaunch.mockResolvedValue(browser);
  return { page, context, browser };
}

function createAgent(overrides: Partial<MonitoringAgentConfig> = {}) {
  return new MonitoringAgent({
    pageUrl: 'https://www.facebook.com/TestPage',
    maxRetries: 2,
    retryDelayMs: 10,
    selectorTimeoutMs: 100,
    navigationTimeoutMs: 100,
    ...overrides,
  });
}



describe('MonitoringAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    mockGoto.mockResolvedValue(undefined);
    mockPageContent.mockResolvedValue('<html></html>');
    mockPageClose.mockResolvedValue(undefined);
    mockContextClose.mockResolvedValue(undefined);
    mockBrowserClose.mockResolvedValue(undefined);
  });

  

  it('should return a structured observation on success', async () => {
    setupBrowserMocks();
    mockPageContent.mockResolvedValue('{"top_level_post_id":"1234567890123"}');

    const agent = createAgent();
    await agent.initialize();
    const observation = await agent.observe();

    expect(observation).toMatchObject({
      latest_post_link: 'https://www.facebook.com/TestPage/posts/1234567890123',
      extracted_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      content_preview: expect.stringContaining('1234567890123'),
      raw_dom_hash: expect.any(String),
      candidate_post_links: ['https://www.facebook.com/TestPage/posts/1234567890123'],
    });

    await agent.shutdown();
  });

  it('should handle HTML encoded JSON blobs', async () => {
    setupBrowserMocks();
    mockPageContent.mockResolvedValue('&quot;top_level_post_id&quot;:&quot;9999999999999&quot;');

    const agent = createAgent();
    await agent.initialize();
    const observation = await agent.observe();

    expect(observation.latest_post_link).toBe('https://www.facebook.com/TestPage/posts/9999999999999');

    await agent.shutdown();
  });

  it('should extract IDs from story_fbid JSON blobs', async () => {
    setupBrowserMocks();
    mockPageContent.mockResolvedValue('{"story_fbid":"5555555555555"}');

    const agent = createAgent();
    await agent.initialize();
    const observation = await agent.observe();

    expect(observation.latest_post_link).toBe(
      'https://www.facebook.com/TestPage/posts/5555555555555',
    );

    await agent.shutdown();
  });

  it('should extract IDs from permalink URLs', async () => {
    setupBrowserMocks();
    mockPageContent.mockResolvedValue(
      '<a href="https://www.facebook.com/TestPage/posts/7777777777777">Post</a>',
    );

    const agent = createAgent();
    await agent.initialize();
    const observation = await agent.observe();

    expect(observation.latest_post_link).toBe(
      'https://www.facebook.com/TestPage/posts/7777777777777',
    );

    await agent.shutdown();
  });

  it('should support pfbid-style permalink IDs', async () => {
    setupBrowserMocks();
    mockPageContent.mockResolvedValue(
      '<a href="https://www.facebook.com/TestPage/posts/pfbid0ABC123xyz">Post</a>',
    );

    const agent = createAgent();
    await agent.initialize();
    const observation = await agent.observe();

    expect(observation.latest_post_link).toBe(
      'https://www.facebook.com/TestPage/posts/pfbid0ABC123xyz',
    );

    await agent.shutdown();
  });

  

  it('should order extracted IDs by document position, not regex-pattern order', async () => {
    setupBrowserMocks();
    // "post_id" appears FIRST in the document (top of feed = newest post),
    // "top_level_post_id" appears later. Regex-pattern order would put the
    // top_level_post_id match first; document order must win.
    mockPageContent.mockResolvedValue(
      '{"post_id":"1111111111"} ... {"top_level_post_id":"2222222222"}',
    );

    const agent = createAgent();
    await agent.initialize();
    const observation = await agent.observe();

    expect(observation.candidate_post_links).toEqual([
      'https://www.facebook.com/TestPage/posts/1111111111',
      'https://www.facebook.com/TestPage/posts/2222222222',
    ]);
    expect(observation.latest_post_link).toBe(
      'https://www.facebook.com/TestPage/posts/1111111111',
    );

    await agent.shutdown();
  });

  it('should retry navigation and succeed after transient failure', async () => {
    setupBrowserMocks();

    mockGoto
      .mockRejectedValueOnce(new Error('net::ERR_CONNECTION_RESET'))
      .mockResolvedValueOnce(undefined);

    mockPageContent.mockResolvedValue('{"top_level_post_id":"1112223334445"}');

    const agent = createAgent();
    await agent.initialize();
    const observation = await agent.observe();

    expect(mockGoto).toHaveBeenCalledTimes(2);
    expect(observation.latest_post_link).toBe('https://www.facebook.com/TestPage/posts/1112223334445');

    await agent.shutdown();
  });

  

  it('should throw NAVIGATION_FAILED after max retries', async () => {
    setupBrowserMocks();

    mockGoto.mockRejectedValue(new Error('fail 1'));

    const agent = createAgent({ maxRetries: 2 });
    await agent.initialize();

    await expect(agent.observe()).rejects.toMatchObject({
      code: MonitoringErrorCode.NAVIGATION_FAILED,
    });

    await agent.shutdown();
  });

  

  it('should throw EXTRACTION_FAILED when posts cannot be located', async () => {
    setupBrowserMocks();

    mockPageContent.mockResolvedValue('<html>no posts here</html>');

    const agent = createAgent();
    await agent.initialize();

    await expect(agent.observe()).rejects.toMatchObject({
      code: MonitoringErrorCode.EXTRACTION_FAILED,
    });

    await agent.shutdown();
  });

  

  it('should compute consistent hash for unchanged feed', async () => {
    setupBrowserMocks();
    mockPageContent.mockResolvedValue('{"top_level_post_id":"1234567890000"}');

    const agent = createAgent();
    await agent.initialize();

    const obs1 = await agent.observe();
    const obs2 = await agent.observe();

    expect(obs1.raw_dom_hash).toBe(obs2.raw_dom_hash);
    await agent.shutdown();
  });

  

  it('should throw if observe() called before initialize()', async () => {
    const agent = createAgent();

    await expect(agent.observe()).rejects.toMatchObject({
      code: MonitoringErrorCode.BROWSER_LAUNCH_FAILED,
    });
  });
});
