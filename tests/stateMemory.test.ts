import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateMemory } from '../src/agents/stateMemory.js';
import type { AppConfig } from '../src/core/config.js';

vi.mock('pg', () => {
  const mockQuery = vi.fn();
  const mockEnd = vi.fn();
  const Pool = vi.fn(() => ({
    query: mockQuery,
    end: mockEnd,
  }));
  return { default: { Pool } };
});

const getMockConfig = (): AppConfig => ({
  dbHost: 'localhost',
  dbPort: 5432,
  dbUser: 'postgres',
  dbPass: 'postgres',
  dbName: 'test_db',
  facebookPageUrl: '',
  slackWebhookUrl: '',
  checkIntervalMs: 0,
  timezone: '',
  scheduleStart: 0,
  scheduleEnd: 0,
});

describe('StateMemory', () => {
  let store: StateMemory;
  let mockPool: any;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new StateMemory(getMockConfig());
    mockPool = (store as any).pool;
  });

  afterEach(async () => {
    await store.close();
  });

  it('init method executes CREATE TABLE statement', async () => {
    mockPool.query.mockResolvedValueOnce({});
    await store.init();
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS state'),
    );
  });

  it('getRecentPosts returns empty array when nothing stored', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const posts = await store.getRecentPosts();
    expect(posts).toEqual([]);
  });

  it('getRecentPosts parses JSON array values', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ value: JSON.stringify(['a', 'b']) }],
    });
    const posts = await store.getRecentPosts();
    expect(posts).toEqual(['a', 'b']);
  });

  it('getRecentPosts wraps legacy plain-string values in an array', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ value: 'https://fb.com/p/1' }] });
    const posts = await store.getRecentPosts();
    expect(posts).toEqual(['https://fb.com/p/1']);
  });

  it('setLastPost prepends the new link to stored recents', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // getRecentPosts
    mockPool.query.mockResolvedValueOnce({}); // INSERT

    await store.setLastPost('https://facebook.com/post/123');

    expect(mockPool.query).toHaveBeenCalledTimes(2);
    const [, params] = mockPool.query.mock.calls[1];
    expect(params[0]).toBe('last_post');
    expect(JSON.parse(params[1])).toEqual(['https://facebook.com/post/123']);
  });

  it('setLastPost with an already-stored value is a no-op (idempotent)', async () => {
    const link = 'https://facebook.com/post/456';
    mockPool.query.mockResolvedValueOnce({ rows: [{ value: JSON.stringify([link]) }] });

    await store.setLastPost(link);

    expect(mockPool.query).toHaveBeenCalledTimes(1); // only the read
  });

  it('rejects empty or non-string input', async () => {
    await expect(store.setLastPost('')).rejects.toThrow('non-empty string');
    await expect(store.setLastPost('   ')).rejects.toThrow('non-empty string');
    await expect((store as any).setLastPost(null)).rejects.toThrow('non-empty string');
    await expect((store as any).setLastPost(undefined)).rejects.toThrow('non-empty string');
    await expect((store as any).setLastPost(123)).rejects.toThrow('non-empty string');
  });

  // ── Bulk writes: addPosts ──────────────────────────────────────

  it('addPosts stores multiple links at once, newest first', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ value: JSON.stringify(['old']) }] });
    mockPool.query.mockResolvedValueOnce({}); // INSERT

    await store.addPosts(['new1', 'new2']);

    const [, params] = mockPool.query.mock.calls[1];
    expect(JSON.parse(params[1])).toEqual(['new1', 'new2', 'old']);
  });

  it('addPosts skips links already stored (no duplicates)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ value: JSON.stringify(['a', 'b']) }] });
    mockPool.query.mockResolvedValueOnce({}); // INSERT

    await store.addPosts(['a', 'c']);

    const [, params] = mockPool.query.mock.calls[1];
    expect(JSON.parse(params[1])).toEqual(['c', 'a', 'b']);
  });

  it('addPosts is a no-op when every link is already stored', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ value: JSON.stringify(['a', 'b']) }] });

    await store.addPosts(['a', 'b']);

    expect(mockPool.query).toHaveBeenCalledTimes(1); // only the read
  });

  it('remembers at least 100 posts so notified posts do not rotate back as "new"', async () => {
    const existing = Array.from({ length: 99 }, (_, i) => `post-${i}`);
    mockPool.query.mockResolvedValueOnce({ rows: [{ value: JSON.stringify(existing) }] });
    mockPool.query.mockResolvedValueOnce({}); // INSERT

    await store.addPosts(['brand-new']);

    const [, params] = mockPool.query.mock.calls[1];
    const stored = JSON.parse(params[1]);
    expect(stored).toHaveLength(100);
    expect(stored[0]).toBe('brand-new');
    expect(stored).toContain('post-98');
  });
});
