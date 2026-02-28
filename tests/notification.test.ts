import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationAgent } from '../src/agents/notification.js';

// ── Helpers ──────────────────────────────────────────────────────

const WEBHOOK_URL = 'https://hooks.slack.com/services/T00/B00/xxx';

const DECISION = {
  changeDetected: true,
  postLink: 'https://facebook.com/page/posts/123',
};

function silentLogger(): any {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function mockFetchResponse(status: number, body = 'ok'): any {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(body),
  });
}

// ── Tests ────────────────────────────────────────────────────────

describe('NotificationAgent', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── 1: Correct Block Kit payload ───────────────────────────────
  it('sends POST with Block Kit payload to webhook URL', async () => {
    globalThis.fetch = mockFetchResponse(200);
    const agent = new NotificationAgent(WEBHOOK_URL, { logger: silentLogger() });

    await agent.notify(DECISION);

    expect(globalThis.fetch).toHaveBeenCalledOnce();

    const [url, options] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe(WEBHOOK_URL);
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(options.body as string);
    expect(body.blocks).toHaveLength(3);
    expect(body.blocks[0].type).toBe('header');
    expect(body.blocks[1].text.text).toContain(DECISION.postLink);
    expect(body.blocks[2].type).toBe('context');
  });

  // ── 2: Success result on 200 ──────────────────────────────────
  it('returns success result on 200 response', async () => {
    globalThis.fetch = mockFetchResponse(200);
    const agent = new NotificationAgent(WEBHOOK_URL, { logger: silentLogger() });

    const result = await agent.notify(DECISION);

    expect(result).toEqual({
      success: true,
      statusCode: 200,
      attempts: 1,
      error: null,
    });
  });

  // ── 3: Retries on 5xx ─────────────────────────────────────────
  it('retries on 5xx and succeeds on later attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: vi.fn().mockResolvedValue('unavail') })
      .mockResolvedValueOnce({ ok: true, status: 200, text: vi.fn().mockResolvedValue('ok') });

    globalThis.fetch = fetchMock as any;
    const agent = new NotificationAgent(WEBHOOK_URL, {
      maxRetries: 3,
      logger: silentLogger(),
    });

    const result = await agent.notify(DECISION);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  // ── 4: All retries exhausted ──────────────────────────────────
  it('returns failure after all retries exhausted on 5xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    }) as any;

    const agent = new NotificationAgent(WEBHOOK_URL, {
      maxRetries: 2,
      logger: silentLogger(),
    });

    const result = await agent.notify(DECISION);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.attempts).toBe(2);
    expect(result.error).toContain('All 2 attempts failed');
  });

  // ── 5: No retry on 4xx ────────────────────────────────────────
  it('does not retry on 4xx client error', async () => {
    globalThis.fetch = mockFetchResponse(403, 'invalid_token');
    const agent = new NotificationAgent(WEBHOOK_URL, { logger: silentLogger() });

    const result = await agent.notify(DECISION);

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.error).toContain('403');
  });

  // ── 6: Network error handled ──────────────────────────────────
  it('handles fetch network errors gracefully', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
    const agent = new NotificationAgent(WEBHOOK_URL, {
      maxRetries: 2,
      logger: silentLogger(),
    });

    const result = await agent.notify(DECISION);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.error).toContain('ECONNREFUSED');
  });

  // ── 7: Constructor validation ─────────────────────────────────
  it('throws if webhook URL is missing', () => {
    expect(() => new NotificationAgent('')).toThrow(/webhook URL/i);
    expect(() => new NotificationAgent(undefined as any)).toThrow(/webhook URL/i);
  });
});
