import pkg from 'pg';
const { Pool } = pkg;
import { type AppConfig } from '../core/config.js';

const STATE_KEY = 'last_post';

// Each observation can surface 10+ post IDs; the window must comfortably hold
// everything visible on the page so an already-notified post never rotates
// back out of memory and triggers a duplicate notification.
const MAX_REMEMBERED_POSTS = 100;

export class StateMemory {
  public pool: pkg.Pool;

  constructor(config: AppConfig) {
    this.pool = new Pool({
      host: config.dbHost,
      port: config.dbPort,
      user: config.dbUser,
      password: config.dbPass,
      database: config.dbName,
    });
  }

  
  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS state (
        key        VARCHAR(255) PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  
  async getRecentPosts(): Promise<string[]> {
    const res = await this.pool.query('SELECT value FROM state WHERE key = $1', [STATE_KEY]);
    if (res.rows.length === 0) return [];

    try {
      const parsed = JSON.parse(res.rows[0].value);
      return Array.isArray(parsed) ? parsed : [res.rows[0].value];
    } catch {
      return [res.rows[0].value]; 
    }
  }

  
  async setLastPost(postLink: string): Promise<void> {
    if (typeof postLink !== 'string' || postLink.trim() === '') {
      throw new Error('postLink must be a non-empty string');
    }
    await this.addPosts([postLink]);
  }


  async addPosts(postLinks: string[]): Promise<void> {
    const links = postLinks.filter((l) => typeof l === 'string' && l.trim() !== '');
    if (links.length === 0) return;

    const recents = await this.getRecentPosts();
    const fresh = links.filter((l) => !recents.includes(l));
    if (fresh.length === 0) return;

    const updated = [...fresh, ...recents].slice(0, MAX_REMEMBERED_POSTS);
    const valueStr = JSON.stringify(updated);

    await this.pool.query(
      `INSERT INTO state (key, value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [STATE_KEY, valueStr],
    );
  }

  
  async close(): Promise<void> {
    await this.pool.end();
  }
}
