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
   * Returns the last stored post link, or null if none exists.
   */
  async getLastPost(): Promise<string | null> {
    const res = await this.pool.query('SELECT value FROM state WHERE key = $1', [STATE_KEY]);
    return res.rows.length > 0 ? res.rows[0].value : null;
  }

  /**
   * Atomically stores the post link.
   * No-ops if the value is identical to the current one (no duplicate writes).
   */
  async setLastPost(postLink: string): Promise<void> {
    if (typeof postLink !== 'string' || postLink.trim() === '') {
      throw new Error('postLink must be a non-empty string');
    }

    const current = await this.getLastPost();
    if (current === postLink) {
      return; // idempotent — skip duplicate write
    }

    await this.pool.query(
      `INSERT INTO state (key, value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [STATE_KEY, postLink],
    );
  }

  /** Gracefully close the database connection. */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
