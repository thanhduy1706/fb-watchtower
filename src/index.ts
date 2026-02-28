import { EventBus } from './core/eventBus.js';
import { loadConfig, type AppConfig } from './core/config.js';
import { createLogger } from './core/logger.js';
import { Orchestrator } from './agents/orchestrator.js';
import { SchedulerAgent } from './agents/scheduler/index.js';
import { MonitoringAgent } from './agents/monitoring/index.js';
import { NotificationAgent } from './agents/notification.js';
import { ReasonerAgent } from './agents/reasoner.js';
import { StateMemory } from './agents/stateMemory.js';

const log = createLogger('Main');

async function main() {
  log.info('fb-watchtower starting…');
  const config: AppConfig = loadConfig();
  const eventBus = new EventBus();

  const memory = new StateMemory(config);
  await memory.init();

  const monitor = new MonitoringAgent({ pageUrl: config.facebookPageUrl });
  await monitor.initialize();

  const reasoner = new ReasonerAgent(memory);

  const notifier = new NotificationAgent(config.slackWebhookUrl);

  const scheduler = new SchedulerAgent(eventBus, {
    windowStartHour: config.scheduleStart,
    windowEndHour: config.scheduleEnd,
    timezone: config.timezone,
    pollingIntervalMs: config.checkIntervalMs,
  });

  const orchestrator = new Orchestrator({ monitor, reasoner, notifier, memory }, eventBus);

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
