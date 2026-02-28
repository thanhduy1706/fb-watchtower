import { readFileSync, watchFile, unwatchFile } from 'fs';
import { resolve } from 'path';
import { EventEmitter } from 'events';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'time';

export interface ConfigFieldSchema {
  key: string;
  env: string;
  type: ConfigFieldType;
  required?: boolean;
  default?: any;
}

export const SCHEMA: ConfigFieldSchema[] = [
  { key: 'facebookPageUrl', env: 'FACEBOOK_PAGE_URL', type: 'string', required: true },
  { key: 'slackWebhookUrl', env: 'SLACK_WEBHOOK_URL', type: 'string', required: true },
  { key: 'checkIntervalMs', env: 'CHECK_INTERVAL_MS', type: 'number', default: 30000 },
  { key: 'scheduleStart', env: 'SCHEDULE_START', type: 'time', default: '09:00' },
  { key: 'scheduleEnd', env: 'SCHEDULE_END', type: 'time', default: '21:00' },
  { key: 'timezone', env: 'TIMEZONE', type: 'string', default: 'Asia/Ho_Chi_Minh' },
  { key: 'maxRetries', env: 'MAX_RETRIES', type: 'number', default: 3 },
  { key: 'dbHost', env: 'DATABASE_HOST', type: 'string', default: 'localhost' },
  { key: 'dbPort', env: 'DATABASE_PORT', type: 'number', default: 5432 },
  { key: 'dbUser', env: 'DATABASE_USERNAME', type: 'string', default: 'postgres' },
  { key: 'dbPass', env: 'DATABASE_PASSWORD', type: 'string', default: 'postgres' },
  { key: 'dbName', env: 'DATABASE_NAME', type: 'string', default: 'fb_watchtower' },
  { key: 'logLevel', env: 'LOG_LEVEL', type: 'string', default: 'info' },
  { key: 'headless', env: 'HEADLESS', type: 'boolean', default: true },
];

/**
 * Parse a raw .env file string into a plain key→value object.
 * Supports KEY=VALUE, quoted values, comments, and blank lines.
 */
export function parseEnvString(src: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of src.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let val = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return vars;
}

/**
 * Coerce a raw string value according to the schema field type.
 */
function coerce(field: ConfigFieldSchema, raw: string): any {
  switch (field.type) {
    case 'string':
      return raw;

    case 'number': {
      const n = Number(raw);
      if (Number.isNaN(n)) {
        throw new Error(`Config "${field.key}" (${field.env}): expected a number, got "${raw}"`);
      }
      return n;
    }

    case 'boolean': {
      const lower = raw.toLowerCase();
      if (lower === 'true' || lower === '1') return true;
      if (lower === 'false' || lower === '0') return false;
      throw new Error(
        `Config "${field.key}" (${field.env}): expected boolean (true/false/1/0), got "${raw}"`,
      );
    }

    case 'time': {
      if (!HH_MM.test(raw)) {
        throw new Error(
          `Config "${field.key}" (${field.env}): expected HH:mm format, got "${raw}"`,
        );
      }
      return raw;
    }

    default:
      return raw;
  }
}

export class ConfigAgent extends EventEmitter {
  private _envPath: string;
  private _config: Record<string, any> | null;
  private _watching: boolean;

  /**
   * @param envPath — path to the .env file (relative to cwd or absolute).
   */
  constructor(envPath = '.env') {
    super();
    this._envPath = resolve(envPath);
    this._config = null;
    this._watching = false;
  }

  /**
   * Parse the .env file, validate against the schema, and store the resolved config.
   * Throws on missing required fields or invalid values.
   */
  load(): void {
    let envVars: Record<string, string> = {};
    try {
      const src = readFileSync(this._envPath, 'utf8');
      envVars = parseEnvString(src);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
      // .env file is optional — fall through to defaults + process.env
    }

    // Merge: .env file values < process.env overrides
    const merged: Record<string, string | undefined> = { ...envVars };
    for (const field of SCHEMA) {
      if (process.env[field.env] !== undefined) {
        merged[field.env] = process.env[field.env];
      }
    }

    const config: Record<string, any> = {};
    const errors: string[] = [];

    for (const field of SCHEMA) {
      const raw = merged[field.env];

      if (raw === undefined || raw === '') {
        if (field.required) {
          errors.push(`Missing required config: ${field.env}`);
          continue;
        }
        config[field.key] = field.default;
        continue;
      }

      try {
        config[field.key] = coerce(field, raw);
      } catch (e: any) {
        errors.push(e.message);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Configuration errors:\n  • ${errors.join('\n  • ')}`);
    }

    this._config = Object.freeze({ ...config });
  }

  /**
   * Return a single config value by its camelCase key.
   */
  get(key: string): any {
    if (!this._config) throw new Error('ConfigAgent: call load() before get()');
    if (!(key in this._config)) {
      throw new Error(`ConfigAgent: unknown config key "${key}"`);
    }
    return this._config[key];
  }

  /**
   * Return a frozen copy of the entire config object.
   */
  getAll(): Readonly<Record<string, any>> {
    if (!this._config) throw new Error('ConfigAgent: call load() before getAll()');
    return this._config; // already frozen
  }

  /**
   * Watch the .env file for changes. On change, re-parse + validate.
   * If valid → update config and emit 'config:updated'.
   * If invalid → emit 'config:error', keep previous config.
   */
  enableHotReload(): void {
    if (this._watching) return;
    this._watching = true;

    watchFile(this._envPath, { interval: 1000 }, () => {
      try {
        const previous = this._config;
        this.load();
        this.emit('config:updated', this._config, previous);
      } catch (err) {
        this.emit('config:error', err);
      }
    });
  }

  /** Stop watching the .env file. */
  stopHotReload(): void {
    if (!this._watching) return;
    unwatchFile(this._envPath);
    this._watching = false;
  }
}
