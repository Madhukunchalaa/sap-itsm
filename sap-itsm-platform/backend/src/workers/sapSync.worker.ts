import { Worker } from 'bullmq';
import { bullConnection } from '../config/redis';
import { sapSyncQueue } from './queues';
import { logger } from '../config/logger';
import { sapService } from '../services/sap.service';
import { prisma } from '../config/database';
import { addComment } from '../services/record.service';

export function startSAPSyncWorker(): void {
  const worker = new Worker(
    'sap-sync',
    async (job) => {
      if (job.name === 'mirror-ticket') {
        const { ticketId, triggeredBy } = job.data;
        
        // 1. Fetch full ticket details
        const ticket = await prisma.iTSMRecord.findUnique({
          where: { id: ticketId },
          include: {
            sapModule: true,
            customer: true,
          },
        });

        if (!ticket) {
          logger.error(`[SAPWorker] Ticket ${ticketId} not found. Skipping.`);
          return;
        }

        // 2. Call SAP Service
        try {
          const sapId = await sapService.createSAPIncident(ticket);
          
          if (sapId) {
            // 3. Update metadata on success
            const existingMetadata = (ticket.metadata as any) || {};
            await prisma.iTSMRecord.update({
              where: { id: ticketId },
              data: {
                metadata: {
                  ...existingMetadata,
                  sapIncidentId: sapId,
                  sapSyncTimestamp: new Date().toISOString(),
                  sapSyncStatus: 'SUCCESS',
                },
              },
            });

            // 4. Add automated internal comment
            await addComment(
              ticketId,
              ticket.tenantId,
              triggeredBy,
              `✅ SAP Mirroring Successful: SAP Incident #${sapId} created.`,
              true // Internal flag
            );
          }
        } catch (error: any) {
          // Failure: update status in metadata for UI visibility
          const existingMetadata = (ticket.metadata as any) || {};
          await prisma.iTSMRecord.update({
            where: { id: ticketId },
            data: {
              metadata: {
                ...existingMetadata,
                sapSyncStatus: 'FAILED',
                sapSyncError: error.message,
              },
            },
          });
          
          throw error; // Rethrow to let BullMQ handle retries
        }
      }
    },
    {
      connection: bullConnection,
      concurrency: 2, // Allow 2 concurrent SAP syncs
    }
  );

  worker.on('completed', (job) => {
    logger.info(`[SAPSyncWorker] Job ${job.id} mirroring completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[SAPSyncWorker] Job ${job?.id} mirroring failed:`, err);
  });

  logger.info('🚀 SAP Sync Worker started and listening for jobs...');
}
