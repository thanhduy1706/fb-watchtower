import { MonitoringAgent } from './agents/monitoring/index.js';
import { Logger } from './utils/logger.js';

const logger = new Logger('Main', 'INFO');


async function main(): Promise<void> {
  const pageUrl = process.env.FB_PAGE_URL;
  if (!pageUrl) {
    logger.error('FB_PAGE_URL environment variable is required.');
    process.exit(1);
  }

  logger.info(`Starting Monitoring Agent for: ${pageUrl}`);

  const agent = new MonitoringAgent({ pageUrl });

  
  const shutdown = async () => {
    logger.info('Received shutdown signal. Cleaning up...');
    await agent.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await agent.initialize();
    const observation = await agent.observe();
    console.log('\n=== Observation Result ===');
    console.log(JSON.stringify(observation, null, 2));
  } catch (err) {
    logger.error('Observation failed.', {
      message: (err as Error).message,
      name: (err as Error).name,
    });
    process.exitCode = 1;
  } finally {
    await agent.shutdown();
  }
}

main();
