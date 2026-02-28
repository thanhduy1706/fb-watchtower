import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConfigAgent } from '../src/agents/configAgent.js';

const REQUIRED_ENV = [
  'FACEBOOK_PAGE_URL=https://facebook.com/test',
  'SLACK_WEBHOOK_URL=https://hooks.slack.com/test',
].join('\n');

function tmpEnvPath() {
  const dir = join(tmpdir(), `cfg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return join(dir, '.env');
}

function cleanup(path: string) {
  try {
    unlinkSync(path);
  } catch {
    /* ignore */
  }
}

describe('ConfigAgent', () => {
  afterEach(() => {
    // Clear any process.env overrides set during tests
    delete process.env.FACEBOOK_PAGE_URL;
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.CHECK_INTERVAL_MS;
    delete process.env.HEADLESS;
    delete process.env.SCHEDULE_START;
    delete process.env.LOG_LEVEL;
  });

  it('load() reads values from .env and populates config', () => {
    const envPath = tmpEnvPath();
    writeFileSync(envPath, REQUIRED_ENV);

    try {
      const cfg = new ConfigAgent(envPath);
      cfg.load();
      expect(cfg.get('facebookPageUrl')).toBe('https://facebook.com/test');
      expect(cfg.get('slackWebhookUrl')).toBe('https://hooks.slack.com/test');
    } finally {
      cleanup(envPath);
    }
  });

  it('get() returns the correct value for each config key', () => {
    const envPath = tmpEnvPath();
    writeFileSync(
      envPath,
      [REQUIRED_ENV, 'CHECK_INTERVAL_MS=5000', 'MAX_RETRIES=5', 'HEADLESS=false'].join('\n'),
    );

    try {
      const cfg = new ConfigAgent(envPath);
      cfg.load();
      expect(cfg.get('checkIntervalMs')).toBe(5000);
      expect(cfg.get('maxRetries')).toBe(5);
      expect(cfg.get('headless')).toBe(false);
    } finally {
      cleanup(envPath);
    }
  });

  it('getAll() returns a frozen (immutable) object', () => {
    const envPath = tmpEnvPath();
    writeFileSync(envPath, REQUIRED_ENV);

    try {
      const cfg = new ConfigAgent(envPath);
      cfg.load();
      const all: any = cfg.getAll();
      expect(Object.isFrozen(all)).toBe(true);
      expect(() => {
        all.facebookPageUrl = 'hack';
      }).toThrow();
    } finally {
      cleanup(envPath);
    }
  });

  it('missing required fields → throws descriptive error', () => {
    const envPath = tmpEnvPath();
    writeFileSync(envPath, '# empty');

    try {
      const cfg = new ConfigAgent(envPath);
      expect(() => cfg.load()).toThrow(/FACEBOOK_PAGE_URL/);
      expect(() => cfg.load()).toThrow(/SLACK_WEBHOOK_URL/);
    } finally {
      cleanup(envPath);
    }
  });

  it('invalid numeric value → throws on NaN', () => {
    const envPath = tmpEnvPath();
    writeFileSync(envPath, [REQUIRED_ENV, 'CHECK_INTERVAL_MS=not_a_number'].join('\n'));

    try {
      const cfg = new ConfigAgent(envPath);
      expect(() => cfg.load()).toThrow(/expected a number/);
    } finally {
      cleanup(envPath);
    }
  });

  it('invalid boolean value → throws', () => {
    const envPath = tmpEnvPath();
    writeFileSync(envPath, [REQUIRED_ENV, 'HEADLESS=maybe'].join('\n'));

    try {
      const cfg = new ConfigAgent(envPath);
      expect(() => cfg.load()).toThrow(/expected boolean/);
    } finally {
      cleanup(envPath);
    }
  });

  it('invalid schedule format → throws', () => {
    const envPath = tmpEnvPath();
    writeFileSync(envPath, [REQUIRED_ENV, 'SCHEDULE_START=9am'].join('\n'));

    try {
      const cfg = new ConfigAgent(envPath);
      expect(() => cfg.load()).toThrow(/HH:mm/);
    } finally {
      cleanup(envPath);
    }
  });

  it('default values applied when optional fields are absent', () => {
    const envPath = tmpEnvPath();
    writeFileSync(envPath, REQUIRED_ENV);

    try {
      const cfg = new ConfigAgent(envPath);
      cfg.load();
      expect(cfg.get('checkIntervalMs')).toBe(30000);
      expect(cfg.get('scheduleStart')).toBe('09:00');
      expect(cfg.get('scheduleEnd')).toBe('21:00');
      expect(cfg.get('timezone')).toBe('Asia/Ho_Chi_Minh');
      expect(cfg.get('maxRetries')).toBe(3);
      expect(cfg.get('dbHost')).toBe('localhost'); // default Postgres config
      expect(cfg.get('logLevel')).toBe('info');
      expect(cfg.get('headless')).toBe(true);
    } finally {
      cleanup(envPath);
    }
  });

  it('process.env overrides .env file values', () => {
    const envPath = tmpEnvPath();
    writeFileSync(envPath, REQUIRED_ENV);
    process.env.CHECK_INTERVAL_MS = '9999';

    try {
      const cfg = new ConfigAgent(envPath);
      cfg.load();
      expect(cfg.get('checkIntervalMs')).toBe(9999);
    } finally {
      cleanup(envPath);
    }
  });

  it('hot-reload detects file change and emits config:updated', async () => {
    const envPath = tmpEnvPath();
    writeFileSync(envPath, REQUIRED_ENV);

    const cfg = new ConfigAgent(envPath);
    cfg.load();
    cfg.enableHotReload();

    await new Promise<void>((resolve, reject) => {
      cfg.on('config:updated', (newConfig, oldConfig) => {
        try {
          expect(newConfig.checkIntervalMs).toBe(9999);
          expect(oldConfig.checkIntervalMs).toBe(30000);
          cfg.stopHotReload();
          cleanup(envPath);
          resolve();
        } catch (err) {
          cfg.stopHotReload();
          cleanup(envPath);
          reject(err);
        }
      });

      // Write updated .env after a small delay to trigger the watcher
      setTimeout(() => {
        writeFileSync(envPath, [REQUIRED_ENV, 'CHECK_INTERVAL_MS=9999'].join('\n'));
      }, 200);
    });
  });

  it('get() on unknown key → throws', () => {
    const envPath = tmpEnvPath();
    writeFileSync(envPath, REQUIRED_ENV);

    try {
      const cfg = new ConfigAgent(envPath);
      cfg.load();
      expect(() => cfg.get('nonexistent')).toThrow(/unknown config key/);
    } finally {
      cleanup(envPath);
    }
  });

  it('get() before load() → throws', () => {
    const cfg = new ConfigAgent('/nonexistent/.env');
    expect(() => cfg.get('facebookPageUrl')).toThrow(/call load\(\) before get/);
  });
});
