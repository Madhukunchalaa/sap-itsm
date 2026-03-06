import { Worker } from 'bullmq';
import { bullConnection } from '../config/redis';
import { processSLAChecks } from '../services/sla.service';
import { slaQueue } from './queues';
import { logger } from '../config/logger';

export function startSLAWorker(): void {
  const worker = new Worker(
    'sla',
    async (job) => {
      if (job.name === 'sla-check' || job.name === 'sla-bulk-check') {
        await processSLAChecks();
      }
    },
    {
      connection: bullConnection,
      concurrency: 1,
    }
  );

  worker.on('completed', (job) => {
    logger.debug(`SLA job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`SLA job ${job?.id} failed:`, err);
  });

  slaQueue.add(
    'sla-bulk-check',
    {},
    {
      repeat: { every: 60 * 1000 },
      jobId: 'sla-recurring-check',
    }
  );

  logger.info('✅ SLA Worker started — checking every 60s');
}
