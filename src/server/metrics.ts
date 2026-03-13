import express from 'express';
import client from 'prom-client';

export const metricsRouter = express.Router();


client.collectDefaultMetrics();

export const jobsSuccessTotal = new client.Counter({
  name: 'jobs_success_total',
  help: 'Total number of successfully completed scraping jobs',
});

export const jobsFailedTotal = new client.Counter({
  name: 'jobs_failed_total',
  help: 'Total number of failed scraping jobs',
});

export const jobDurationSeconds = new client.Histogram({
  name: 'job_duration_seconds',
  help: 'Duration of scraping jobs in seconds',
  buckets: [1, 5, 10, 30, 60, 120, 300], 
});

metricsRouter.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.send(await client.register.metrics());
});

metricsRouter.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});
