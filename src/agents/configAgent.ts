import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { EventEmitter } from 'node:events';

export const SCHEMA: Record<string, { required: boolean; default?: string }> = {
  facebookPageUrl: { required: true },
  slackWebhookUrl: { required: false, default: '' },
  checkIntervalMs: { required: false, default: '300000' },
  timezone: { required: false, default: 'Asia/Ho_Chi_Minh' },
  dbHost: { required: false, default: 'localhost' },
  dbPort: { required: false, default: '5432' },
  dbUser: { required: false, default: 'postgres' },
  dbPass: { required: false, default: '' },
  dbName: { required: false, default: 'watchtower' },
  scheduleStart: { required: false, default: '07:00' },
  scheduleEnd: { required: false, default: '22:00' },
};


const ENV_MAP: Record<string, string> = {
  FACEBOOK_PAGE_URL: 'facebookPageUrl',
  SLACK_WEBHOOK_URL: 'slackWebhookUrl',
  CHECK_INTERVAL_MS: 'checkIntervalMs',
  TIMEZONE: 'timezone',
  DATABASE_HOST: 'dbHost',
  DATABASE_PORT: 'dbPort',
  DATABASE_USERNAME: 'dbUser',
  DATABASE_PASSWORD: 'dbPass',
  DATABASE_NAME: 'dbName',
  SCHEDULE_START: 'scheduleStart',
  SCHEDULE_END: 'scheduleEnd',
};

export class ConfigAgent extends EventEmitter {
  private readonly envPath: string;
  private values: Map<string, string> = new Map();
  private watcher: fs.FSWatcher | null = null;

  constructor(envFile: string = '.env') {
    super();
    this.envPath = path.resolve(process.cwd(), envFile);
  }

  load(): void {
    
    if (fs.existsSync(this.envPath)) {
      const parsed = dotenv.parse(fs.readFileSync(this.envPath));
      for (const [envKey, schemaKey] of Object.entries(ENV_MAP)) {
        if (parsed[envKey] !== undefined) {
          this.values.set(schemaKey, parsed[envKey]);
        }
      }
    }

    
    for (const [envKey, schemaKey] of Object.entries(ENV_MAP)) {
      if (process.env[envKey] !== undefined) {
        this.values.set(schemaKey, process.env[envKey] as string);
      }
    }

    
    for (const [key, spec] of Object.entries(SCHEMA)) {
      if (!this.values.has(key) && spec.default !== undefined) {
        this.values.set(key, spec.default);
      }
    }

    
    for (const [key, spec] of Object.entries(SCHEMA)) {
      if (spec.required && !this.values.get(key)) {
        throw new Error(`Missing required configuration: ${key} (set via environment variable)`);
      }
    }
  }

  get(key: string): string {
    const value = this.values.get(key);
    if (value === undefined) {
      throw new Error(`Config key not found: ${key}. Did you call load()?`);
    }
    return value;
  }

  getAll(): Record<string, string> {
    return Object.freeze(Object.fromEntries(this.values));
  }

  enableHotReload(): void {
    if (this.watcher) return;

    this.watcher = fs.watch(this.envPath, (eventType) => {
      if (eventType === 'change') {
        const oldValues = this.getAll();
        this.load();
        const newValues = this.getAll();
        this.emit('config:updated', newValues, oldValues);
      }
    });
  }

  stopHotReload(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
