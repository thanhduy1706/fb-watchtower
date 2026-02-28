import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateMemory } from '../src/agents/stateMemory.js';
import pkg from 'pg';
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

  it('returns null when no post has been stored', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const post = await store.getLastPost();
    expect(post).toBeNull();
  });

  it('setLastPost stores a value retrievable by getLastPost', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // getLastPost returns nothing initially
    mockPool.query.mockResolvedValueOnce({}); // INSERT

    await store.setLastPost('https://facebook.com/post/123');

    expect(mockPool.query).toHaveBeenCalledTimes(2); // 1 for getLastPost, 1 for INSERT
    expect(mockPool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO state'),
      ['last_post', 'https://facebook.com/post/123'],
    );
  });

  it('setLastPost with same value is a no-op (idempotent)', async () => {
    const link = 'https://facebook.com/post/456';
    mockPool.query.mockResolvedValueOnce({ rows: [{ value: link }] }); // getLastPost returns identical link

    await store.setLastPost(link);

    expect(mockPool.query).toHaveBeenCalledTimes(1); // Only getLastPost was called
  });

  it('rejects empty or non-string input', async () => {
    await expect(store.setLastPost('')).rejects.toThrow('non-empty string');
    await expect(store.setLastPost('   ')).rejects.toThrow('non-empty string');
    await expect((store as any).setLastPost(null)).rejects.toThrow('non-empty string');
    await expect((store as any).setLastPost(undefined)).rejects.toThrow('non-empty string');
    await expect((store as any).setLastPost(123)).rejects.toThrow('non-empty string');
  });
});
