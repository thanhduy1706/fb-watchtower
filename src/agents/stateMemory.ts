import pkg from 'pg';
const { Pool } = pkg;
import { type AppConfig } from '../core/config.js';

const STATE_KEY = 'last_post';

export class StateMemory {
  private pool: pkg.Pool;

  constructor(config: AppConfig) {
    this.pool = new Pool({
      host: config.dbHost,
      port: config.dbPort,
      user: config.dbUser,
      password: config.dbPass,
      database: config.dbName,
    });
  }

  /** Create the state table if it doesn't exist. */
  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS state (
        key        VARCHAR(255) PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  /**
   * Returns the array of recently stored post links.
   * Internally parses the JSON array.
   */
  async getRecentPosts(): Promise<string[]> {
    const res = await this.pool.query('SELECT value FROM state WHERE key = $1', [STATE_KEY]);
    if (res.rows.length === 0) return [];

    try {
      const parsed = JSON.parse(res.rows[0].value);
      return Array.isArray(parsed) ? parsed : [res.rows[0].value];
    } catch {
      return [res.rows[0].value]; // fallback for old single-string state
    }
  }

  /**
   * Atomically stores the post link, keeping a history of up to 5 posts.
   * No-ops if the value is already in the recent history.
   */
  async setLastPost(postLink: string): Promise<void> {
    if (typeof postLink !== 'string' || postLink.trim() === '') {
      throw new Error('postLink must be a non-empty string');
    }

    const recents = await this.getRecentPosts();
    if (recents.includes(postLink)) {
      return; // idempotent — skip duplicate write
    }

    const updated = [postLink, ...recents].slice(0, 5);
    const valueStr = JSON.stringify(updated);

    await this.pool.query(
      `INSERT INTO state (key, value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [STATE_KEY, valueStr],
    );
  }

  /** Gracefully close the database connection. */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
