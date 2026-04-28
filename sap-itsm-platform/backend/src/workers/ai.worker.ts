import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { findSimilarAndSuggest } from '../services/ai.service';
import { logger } from '../config/logger';

export function startAIWorker() {
  const aiWorker = new Worker(
    'ai-processing',
    async (job) => {
      const { recordId, tenantId } = job.data;
      logger.info(`[AIWorker] Processing ticket insights for ${recordId}`);
      await findSimilarAndSuggest(recordId, tenantId);
    },
    {
      connection: redis,
      concurrency: 2,
    }
  );

  aiWorker.on('completed', (job) => {
    logger.info(`[AIWorker] Job ${job.id} completed`);
  });

  aiWorker.on('failed', (job, err) => {
    logger.error(`[AIWorker] Job ${job?.id} failed: ${err.message}`);
  });

  return aiWorker;
}
