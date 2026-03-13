import 'dotenv/config';
import { ConfigAgent, SCHEMA } from '../agents/configAgent.js';

export interface AppConfig {
  facebookPageUrl: string;
  slackWebhookUrl: string;
  checkIntervalMs: number;
  timezone: string;
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbPass: string;
  dbName: string;
  scheduleStart: number;
  scheduleEnd: number;
}

export function loadConfig(): AppConfig {
  const agent = new ConfigAgent('.env');
  agent.load();

  return Object.freeze({
    facebookPageUrl: agent.get('facebookPageUrl'),
    slackWebhookUrl: agent.get('slackWebhookUrl'),
    checkIntervalMs: Number(agent.get('checkIntervalMs')),
    timezone: agent.get('timezone'),

    dbHost: agent.get('dbHost'),
    dbPort: Number(agent.get('dbPort')),
    dbUser: agent.get('dbUser'),
    dbPass: agent.get('dbPass'),
    dbName: agent.get('dbName'),

    
    scheduleStart: parseHour(agent.get('scheduleStart')),
    scheduleEnd: parseHour(agent.get('scheduleEnd')),
  });
}

function parseHour(timeStr: string): number {
  return Number(timeStr.split(':')[0]);
}
