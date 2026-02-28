import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonitoringError, MonitoringErrorCode } from '../errors.js';
import type { MonitoringAgentConfig } from '../../../types/index.js';

// ─── Mock Playwright (MUST be hoisted before any imports that use it) ──

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

// Import agent AFTER mock is set up
import { MonitoringAgent } from '../MonitoringAgent.js';

// ─── Helpers ───────────────────────────────────────────────

function setupBrowserMocks() {
  const page = {
    goto: mockGoto,
    content: mockPageContent,
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
    mockPageContent.mockResolvedValue('<html></html>');
    mockPageClose.mockResolvedValue(undefined);
    mockContextClose.mockResolvedValue(undefined);
    mockBrowserClose.mockResolvedValue(undefined);
  });

  // ─── Successful Observation ─────────────────────

  it('should return a structured observation on success', async () => {
    setupBrowserMocks();
    mockPageContent.mockResolvedValue('{"top_level_post_id":"12345"}');

    const agent = createAgent();
    await agent.initialize();
    const observation = await agent.observe();

    expect(observation).toEqual({
      latest_post_link: 'https://www.facebook.com/TestPage/posts/12345',
      extracted_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      content_preview: expect.stringContaining('12345'),
      raw_dom_hash: expect.any(String),
    });

    await agent.shutdown();
  });

  it('should handle HTML encoded JSON blobs', async () => {
    setupBrowserMocks();
    mockPageContent.mockResolvedValue('&quot;top_level_post_id&quot;:&quot;99999&quot;');

    const agent = createAgent();
    await agent.initialize();
    const observation = await agent.observe();

    expect(observation.latest_post_link).toBe('https://www.facebook.com/TestPage/posts/99999');

    await agent.shutdown();
  });

  // ─── Retry on Navigation Failure ────────────────

  it('should retry navigation and succeed after transient failure', async () => {
    setupBrowserMocks();

    mockGoto
      .mockRejectedValueOnce(new Error('net::ERR_CONNECTION_RESET'))
      .mockResolvedValueOnce(undefined);

    mockPageContent.mockResolvedValue('{"top_level_post_id":"111"}');

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

    mockGoto.mockRejectedValue(new Error('fail 1'));

    const agent = createAgent({ maxRetries: 2 });
    await agent.initialize();

    await expect(agent.observe()).rejects.toMatchObject({
      code: MonitoringErrorCode.NAVIGATION_FAILED,
    });

    await agent.shutdown();
  });

  // ─── Selector Not Found / Extraction Failed ────

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

  // ─── DOM Hash Consistency ──────────────────────

  it('should compute consistent hash for unchanged feed', async () => {
    setupBrowserMocks();
    mockPageContent.mockResolvedValue('{"top_level_post_id":"123"}');

    const agent = createAgent();
    await agent.initialize();

    const obs1 = await agent.observe();
    const obs2 = await agent.observe();

    expect(obs1.raw_dom_hash).toBe(obs2.raw_dom_hash);
    await agent.shutdown();
  });

  // ─── Uninitialized Error ──────────────────────

  it('should throw if observe() called before initialize()', async () => {
    const agent = createAgent();

    await expect(agent.observe()).rejects.toMatchObject({
      code: MonitoringErrorCode.BROWSER_LAUNCH_FAILED,
    });
  });
});
