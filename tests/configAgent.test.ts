import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConfigAgent } from '../src/agents/configAgent.js';

const REQUIRED_ENV = [
  'FACEBOOK_PAGE_URL=https://www.facebook.com/baoquandoinhandan',
  'SLACK_WEBHOOK_URL=https://hooks.slack.com/test',
].join('\n');

function createTmpDir() {
  const dir = join(tmpdir(), `cfg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('ConfigAgent', () => {
  let testDir: string | null = null;

  afterEach(() => {
    delete process.env.FACEBOOK_PAGE_URL;
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.CHECK_INTERVAL_MS;

    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
      testDir = null;
    }
  });

  it('load() reads values from .env and populates config', () => {
    testDir = createTmpDir();
    const envPath = join(testDir, '.env');
    writeFileSync(envPath, REQUIRED_ENV);

    const cfg = new ConfigAgent(envPath);
    cfg.load();
    expect(cfg.get('facebookPageUrl')).toBe('https://www.facebook.com/baoquandoinhandan');
    expect(cfg.get('slackWebhookUrl')).toBe('https://hooks.slack.com/test');
  });

  it('get() returns values as strings', () => {
    testDir = createTmpDir();
    const envPath = join(testDir, '.env');
    writeFileSync(envPath, [REQUIRED_ENV, 'CHECK_INTERVAL_MS=5000'].join('\n'));

    const cfg = new ConfigAgent(envPath);
    cfg.load();
    // In our implementation, everything in ConfigAgent is a string
    expect(cfg.get('checkIntervalMs')).toBe('5000');
  });

  it('getAll() returns a frozen (immutable) object', () => {
    testDir = createTmpDir();
    const envPath = join(testDir, '.env');
    writeFileSync(envPath, REQUIRED_ENV);

    const cfg = new ConfigAgent(envPath);
    cfg.load();
    const all = cfg.getAll();
    expect(Object.isFrozen(all)).toBe(true);
    expect(() => {
      (all as unknown as Record<string, string>).facebookPageUrl = 'hack';
    }).toThrow();
  });

  it('missing required fields → throws descriptive error', () => {
    testDir = createTmpDir();
    const envPath = join(testDir, '.env');
    writeFileSync(envPath, '# empty');

    const cfg = new ConfigAgent(envPath);
    // ConfigAgent throws error on missing required keys
    expect(() => cfg.load()).toThrow(/Missing required configuration/);
  });

  it('default values applied when optional fields are absent', () => {
    testDir = createTmpDir();
    const envPath = join(testDir, '.env');
    writeFileSync(envPath, REQUIRED_ENV);

    const cfg = new ConfigAgent(envPath);
    cfg.load();
    expect(cfg.get('checkIntervalMs')).toBe('300000');
    expect(cfg.get('scheduleStart')).toBe('07:00');
    expect(cfg.get('scheduleEnd')).toBe('22:00');
    expect(cfg.get('timezone')).toBe('Asia/Ho_Chi_Minh');
  });

  it('process.env overrides .env file values', () => {
    testDir = createTmpDir();
    const envPath = join(testDir, '.env');
    writeFileSync(envPath, REQUIRED_ENV);
    process.env.CHECK_INTERVAL_MS = '9999';

    const cfg = new ConfigAgent(envPath);
    cfg.load();
    expect(cfg.get('checkIntervalMs')).toBe('9999');
  });

  it('hot-reload detects file change and emits config:updated', async () => {
    testDir = createTmpDir();
    const envPath = join(testDir, '.env');
    writeFileSync(envPath, REQUIRED_ENV);

    const cfg = new ConfigAgent(envPath);
    cfg.load();
    cfg.enableHotReload();

    try {
      await new Promise<void>((resolve, reject) => {
        cfg.on('config:updated', (newConfig) => {
          try {
            expect(newConfig.checkIntervalMs).toBe('9999');
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        setTimeout(() => {
          writeFileSync(envPath, [REQUIRED_ENV, 'CHECK_INTERVAL_MS=9999'].join('\n'));
        }, 100);

        // Timeout if no event received
        setTimeout(() => reject(new Error('Timeout waiting for config:updated')), 2000);
      });
    } finally {
      cfg.stopHotReload();
    }
  });

  it('get() on unknown key → throws', () => {
    testDir = createTmpDir();
    const envPath = join(testDir, '.env');
    writeFileSync(envPath, REQUIRED_ENV);

    const cfg = new ConfigAgent(envPath);
    cfg.load();
    expect(() => cfg.get('nonexistent')).toThrow(/Config key not found/);
  });
});
