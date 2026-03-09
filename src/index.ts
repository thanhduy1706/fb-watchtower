import { EventBus } from './core/eventBus.js';
import { loadConfig, type AppConfig } from './core/config.js';
import { createLogger } from './core/logger.js';
import { Orchestrator, type OrchestratorAgents } from './agents/orchestrator.js';
import { SchedulerAgent } from './agents/scheduler/index.js';
import { MonitoringAgent } from './agents/monitoring/index.js';
import { NotificationAgent } from './agents/notification.js';
import { ReasonerAgent } from './agents/reasoner.js';
import { StateMemory } from './agents/stateMemory.js';
import type { CookieInput } from './types/index.js';

const log = createLogger('Main');

function parseFacebookCookies(): CookieInput[] {
  const raw = process.env.FACEBOOK_COOKIES;
  if (!raw || raw.trim() === '') {
    log.warn('FACEBOOK_COOKIES is not set — monitoring will run unauthenticated.');
    return [];
  }

  let parsed: Record<string, unknown>[];
  try {
    parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Expected a JSON array');
  } catch (err) {
    log.error(`Failed to parse FACEBOOK_COOKIES: ${(err as Error).message}. Skipping cookie injection.`);
    return [];
  }

  const normaliseSameSite = (value: unknown): CookieInput['sameSite'] => {
    const v = String(value ?? '').toLowerCase();
    if (v === 'strict') return 'Strict';
    if (v === 'lax') return 'Lax';
    // "no_restriction" is Cookie-Editor's label for the SameSite=None attribute
    return 'None';
  };

  return parsed
    .filter((c) => c.name && c.value && c.domain)
    .map((c) => ({
      name: String(c.name),
      value: String(c.value),
      domain: String(c.domain),
      path: String(c.path ?? '/'),
      // Cookie-Editor uses `expirationDate`; Playwright expects `expires`
      ...(c.expirationDate != null ? { expires: Math.floor(Number(c.expirationDate)) } : {}),
      ...(c.httpOnly != null ? { httpOnly: Boolean(c.httpOnly) } : {}),
      ...(c.secure != null ? { secure: Boolean(c.secure) } : {}),
      ...(c.sameSite != null ? { sameSite: normaliseSameSite(c.sameSite) } : {}),
    }));
}

async function main() {
  log.info('fb-watchtower starting…');
  const config: AppConfig = loadConfig();
  const eventBus = new EventBus();

  const memory = new StateMemory(config);
  await memory.init();

  const cookies = parseFacebookCookies();
  const monitor = new MonitoringAgent({ pageUrl: config.facebookPageUrl, cookies });
  await monitor.initialize();

  const reasoner = new ReasonerAgent(memory);

  const notifier = new NotificationAgent(config.slackWebhookUrl);

  const scheduler = new SchedulerAgent(eventBus, {
    windowStartHour: config.scheduleStart,
    windowEndHour: config.scheduleEnd,
    timezone: config.timezone,
    pollingIntervalMs: config.checkIntervalMs,
  });

  const agents: OrchestratorAgents = { monitor, reasoner, notifier, memory };
  const orchestrator = new Orchestrator(agents, eventBus);

  orchestrator.start();
  scheduler.start();

  log.info('All systems go ✓');

  const shutdown = async (signal: string) => {
    log.info(`${signal} received — shutting down…`);
    scheduler.stop();
    await orchestrator.stop();
    await monitor.shutdown();
    await memory.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: any) => {
  log.error('Fatal:', err);
  process.exit(1);
});

