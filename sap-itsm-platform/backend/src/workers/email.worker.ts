import { Worker } from 'bullmq';
import { bullConnection } from '../config/redis';
import { processEmailEvent } from '../services/email.service';
import { logger } from '../config/logger';

export function startEmailWorker(): void {
  const worker = new Worker(
    'email',
    async (job) => {
      await processEmailEvent(job as any);
    },
    {
      connection: bullConnection,
      concurrency: 5, // Process 5 emails concurrently
    }
  );

  worker.on('completed', (job) => {
    logger.debug(`Email job ${job.id} (${job.name}) sent`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Email job ${job?.id} (${job?.name}) failed after ${job?.attemptsMade} attempts:`, err.message);
  });

  logger.info('✅ Email Worker started');
}
