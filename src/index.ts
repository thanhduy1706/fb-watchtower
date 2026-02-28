import { EventBus } from './core/eventBus.js';
import { loadConfig, type AppConfig } from './core/config.js';
import { createLogger } from './core/logger.js';
import { Orchestrator } from './agents/orchestrator.js';
import { SchedulerAgent } from './agents/scheduler/index.js';
import { MonitoringAgent } from './agents/monitoring/index.js';
import { NotificationAgent } from './agents/notification.js';
import { ReasonerAgent } from './agents/reasoner.js';
import { StateMemory } from './agents/stateMemory.js';

// ── Bootstrap ────────────────────────────────────────────────────
//
// This entry point wires all agents through the Orchestrator.
//
// Individual agent modules (MonitoringAgent, ReasoningAgent, etc.)
// are imported here once they are implemented. Until then, stub
// placeholders are used so the orchestrator can be started.
// ─────────────────────────────────────────────────────────────────

const log = createLogger('Main');

async function main() {
  log.info('fb-watchtower starting…');
  const config: AppConfig = loadConfig();
  const eventBus = new EventBus();

  // ── Instantiate agents ───────────────────────────────────────
  // TODO: Replace stubs with real agent imports once implemented.

  const memory = new StateMemory(config);
  await memory.init(); // Postgres requires async init

  // ── Monitoring Agent (LIVE) ──────────────────────────────────
  const monitor = new MonitoringAgent({ pageUrl: config.facebookPageUrl });
  await monitor.initialize();

  // ── Reasoner Agent (LIVE) ────────────────────────────────────
  const reasoner = new ReasonerAgent(memory);

  // ── Notification Agent (LIVE) ─────────────────────────────────
  const notifier = new NotificationAgent(config.slackWebhookUrl);

  // ── Scheduler Agent (LIVE) ───────────────────────────────────
  const scheduler = new SchedulerAgent(eventBus, {
    windowStartHour: config.scheduleStart,
    windowEndHour: config.scheduleEnd,
    timezone: config.timezone,
    pollingIntervalMs: config.checkIntervalMs,
  });

  // ── Wire orchestrator ────────────────────────────────────────
  const orchestrator = new Orchestrator({ monitor, reasoner, notifier, memory }, eventBus);

  orchestrator.start();
  scheduler.start();

  log.info('All systems go ✓');

  // ── Graceful shutdown ────────────────────────────────────────
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

// ── Stub helper (temporary) ──────────────────────────────────────
function stubAgent(name: string): any {
  const noop = async () => {
    log.warn(`${name} agent is a stub — no-op`);
    return {};
  };

  return new Proxy(
    {},
    {
      get: (_, prop) => noop,
    },
  );
}

main().catch((err: any) => {
  log.error('Fatal:', err);
  process.exit(1);
});
