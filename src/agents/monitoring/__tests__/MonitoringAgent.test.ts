import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { MonitoringError, MonitoringErrorCode } from '../errors.js';
import type { MonitoringAgentConfig } from '../../../types/index.js';

// ─── Mock Playwright (MUST be hoisted before any imports that use it) ──

const mockGoto = vi.fn();
const mockWaitForSelector = vi.fn();
const mockPageQuery = vi.fn();
const mockPageClose = vi.fn();
const mockContextNewPage = vi.fn();
const mockContextClose = vi.fn();
const mockBrowserNewContext = vi.fn();
const mockBrowserClose = vi.fn();
const mockLaunch = vi.fn();

vi.mock('playwright', () => ({
  chromium: {
    launch: (...args: unknown[]) => mockLaunch(...args),
  },
}));

// Import agent AFTER mock is set up
import { MonitoringAgent } from '../MonitoringAgent.js';

// ─── Helpers ───────────────────────────────────────────────

const SAMPLE_HTML = '<div class="post">Hello world!</div>';
const SAMPLE_HASH = createHash('sha256').update(SAMPLE_HTML).digest('hex');

function createMockElement(overrides: Record<string, unknown> = {}) {
  return {
    $: vi.fn().mockResolvedValue(null),
    getAttribute: vi.fn().mockResolvedValue(null),
    textContent: vi.fn().mockResolvedValue(null),
    evaluate: vi.fn().mockResolvedValue(SAMPLE_HTML),
    ...overrides,
  };
}

function setupBrowserMocks() {
  const page = {
    goto: mockGoto,
    waitForSelector: mockWaitForSelector,
    $: mockPageQuery,
    close: mockPageClose,
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

// ─── Tests ─────────────────────────────────────────────────

describe('MonitoringAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset all mocks to default (resolved undefined)
    mockGoto.mockResolvedValue(undefined);
    mockWaitForSelector.mockResolvedValue(null);
    mockPageQuery.mockResolvedValue(null);
    mockPageClose.mockResolvedValue(undefined);
    mockContextClose.mockResolvedValue(undefined);
    mockBrowserClose.mockResolvedValue(undefined);
  });

  // ─── Successful Observation ─────────────────────

  it('should return a structured observation on success', async () => {
    const { page } = setupBrowserMocks();

    const feedEl = createMockElement();
    const postEl = createMockElement();
    const linkEl = createMockElement({
      getAttribute: vi.fn().mockResolvedValue('https://www.facebook.com/TestPage/posts/12345'),
    });
    const contentEl = createMockElement({
      textContent: vi.fn().mockResolvedValue('This is a test post content.'),
    });

    mockWaitForSelector
      .mockResolvedValueOnce(feedEl) // feedContainer
      .mockResolvedValueOnce(postEl); // postItem

    postEl.$ = vi.fn().mockResolvedValueOnce(linkEl).mockResolvedValueOnce(contentEl);

    const agent = createAgent();
    await agent.initialize();
    const observation = await agent.observe();

    expect(observation).toEqual({
      latest_post_link: 'https://www.facebook.com/TestPage/posts/12345',
      extracted_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      content_preview: 'This is a test post content.',
      raw_dom_hash: SAMPLE_HASH,
    });

    await agent.shutdown();
  });

  // ─── Fallback Selectors ─────────────────────────

  it('should fall back to secondary selectors when primary fails', async () => {
    setupBrowserMocks();

    const feedEl = createMockElement();
    const postEl = createMockElement();
    const linkEl = createMockElement({
      getAttribute: vi.fn().mockResolvedValue('/TestPage/posts/99999'),
    });

    // First feed selector fails, second succeeds
    mockWaitForSelector
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockResolvedValueOnce(feedEl)
      .mockResolvedValueOnce(postEl);

    postEl.$ = vi
      .fn()
      .mockResolvedValueOnce(null) // first permalink selector — no match
      .mockResolvedValueOnce(linkEl) // second permalink selector succeeds
      .mockResolvedValueOnce(
        createMockElement({
          textContent: vi.fn().mockResolvedValue('Fallback content'),
        }),
      );

    const agent = createAgent();
    await agent.initialize();
    const observation = await agent.observe();

    expect(observation.latest_post_link).toBe('https://www.facebook.com/TestPage/posts/99999');
    expect(observation.content_preview).toBe('Fallback content');

    await agent.shutdown();
  });

  // ─── Retry on Navigation Failure ────────────────

  it('should retry navigation and succeed after transient failure', async () => {
    setupBrowserMocks();

    const feedEl = createMockElement();
    const postEl = createMockElement();
    const linkEl = createMockElement({
      getAttribute: vi.fn().mockResolvedValue('https://www.facebook.com/TestPage/posts/111'),
    });
    const contentEl = createMockElement({
      textContent: vi.fn().mockResolvedValue('Retry success'),
    });

    mockGoto
      .mockRejectedValueOnce(new Error('net::ERR_CONNECTION_RESET'))
      .mockResolvedValueOnce(undefined);

    mockWaitForSelector.mockResolvedValueOnce(feedEl).mockResolvedValueOnce(postEl);

    postEl.$ = vi.fn().mockResolvedValueOnce(linkEl).mockResolvedValueOnce(contentEl);

    const agent = createAgent();
    await agent.initialize();
    const observation = await agent.observe();

    expect(mockGoto).toHaveBeenCalledTimes(2);
    expect(observation.latest_post_link).toBe('https://www.facebook.com/TestPage/posts/111');

    await agent.shutdown();
  });

  // ─── Max Retries Exhausted ─────────────────────

  it('should throw NAVIGATION_FAILED after max retries', async () => {
    setupBrowserMocks();

    mockGoto.mockRejectedValueOnce(new Error('fail 1')).mockRejectedValueOnce(new Error('fail 2'));

    const agent = createAgent({ maxRetries: 2 });
    await agent.initialize();

    await expect(agent.observe()).rejects.toMatchObject({
      code: MonitoringErrorCode.NAVIGATION_FAILED,
    });

    await agent.shutdown();
  });

  // ─── Selector Not Found ───────────────────────

  it('should throw SELECTOR_NOT_FOUND when feed cannot be located', async () => {
    setupBrowserMocks();

    // All selectors fail
    mockWaitForSelector.mockRejectedValue(new Error('Timeout'));

    const agent = createAgent();
    await agent.initialize();

    await expect(agent.observe()).rejects.toMatchObject({
      code: MonitoringErrorCode.SELECTOR_NOT_FOUND,
    });

    await agent.shutdown();
  });

  // ─── DOM Hash Consistency ──────────────────────

  it('should produce consistent hashes for identical DOM content', async () => {
    const hash1 = createHash('sha256').update('<div>same</div>').digest('hex');
    const hash2 = createHash('sha256').update('<div>same</div>').digest('hex');
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different DOM content', async () => {
    const hash1 = createHash('sha256').update('<div>content A</div>').digest('hex');
    const hash2 = createHash('sha256').update('<div>content B</div>').digest('hex');
    expect(hash1).not.toBe(hash2);
  });

  // ─── Uninitialized Error ──────────────────────

  it('should throw if observe() called before initialize()', async () => {
    const agent = createAgent();

    await expect(agent.observe()).rejects.toMatchObject({
      code: MonitoringErrorCode.BROWSER_LAUNCH_FAILED,
    });
  });

  // ─── Content Preview Truncation ───────────────

  it('should truncate content preview to 280 characters', async () => {
    setupBrowserMocks();

    const longContent = 'A'.repeat(500);
    const feedEl = createMockElement();
    const postEl = createMockElement();
    const linkEl = createMockElement({
      getAttribute: vi.fn().mockResolvedValue('https://www.facebook.com/TestPage/posts/1'),
    });
    const contentEl = createMockElement({
      textContent: vi.fn().mockResolvedValue(longContent),
    });

    mockWaitForSelector.mockResolvedValueOnce(feedEl).mockResolvedValueOnce(postEl);

    postEl.$ = vi.fn().mockResolvedValueOnce(linkEl).mockResolvedValueOnce(contentEl);

    const agent = createAgent();
    await agent.initialize();
    const observation = await agent.observe();

    expect(observation.content_preview.length).toBe(280);

    await agent.shutdown();
  });
});
