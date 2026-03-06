import { Worker } from 'bullmq';
import { bullConnection } from '../config/redis';
import { escalationQueue, contractRenewalQueue, emailQueue } from './queues';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { addDays } from 'date-fns';

export function startEscalationWorker(): void {
  const escalationWorker = new Worker(
    'escalation',
    async (job) => {
      if (job.name === 'auto-escalate') {
        await processAutoEscalation();
      }
    },
    { connection: bullConnection, concurrency: 2 }
  );

  const renewalWorker = new Worker(
    'contract-renewal',
    async (job) => {
      if (job.name === 'check-renewals') {
        await processContractRenewals();
      }
    },
    { connection: bullConnection, concurrency: 1 }
  );

  // Every 5 minutes
  escalationQueue.add(
    'auto-escalate',
    {},
    { repeat: { every: 5 * 60 * 1000 }, jobId: 'escalation-recurring' }
  );

  // Every 24 hours (replaces cron which is not supported in this BullMQ version)
  contractRenewalQueue.add(
    'check-renewals',
    {},
    { repeat: { every: 24 * 60 * 60 * 1000 }, jobId: 'contract-renewal-daily' }
  );

  escalationWorker.on('failed', (job, err) => logger.error('Escalation job failed:', err));
  renewalWorker.on('failed', (job, err) => logger.error('Renewal job failed:', err));

  logger.info('✅ Escalation & Contract Renewal Workers started');
}

async function processAutoEscalation(): Promise<void> {
  const unattended = await prisma.iTSMRecord.findMany({
    where: {
      status: { in: ['NEW', 'OPEN'] },
      priority: { in: ['P1', 'P2'] },
      assignedAgentId: null,
      slaTracking: { breachResponse: true },
    },
    select: {
      id: true,
      tenantId: true,
      recordNumber: true,
      priority: true,
      createdById: true,
    },
    take: 50,
  });

  for (const record of unattended) {
    logger.warn(`Auto-escalation: ${record.recordNumber} (${record.priority}) breached SLA with no agent`);
    await emailQueue.add('escalation-alert', {
      recordId: record.id,
      event: 'SLA_BREACH_RESPONSE',
      tenantId: record.tenantId,
    });
  }
}

async function processContractRenewals(): Promise<void> {
  const warningDate = addDays(new Date(), 30);

  const expiringContracts = await prisma.contract.findMany({
    where: {
      endDate: { lte: warningDate, gte: new Date() },
      autoRenewal: false,
    },
    include: {
      customer: {
        include: {
          adminUser: { select: { email: true, firstName: true } },
        },
      },
    },
  });

  for (const contract of expiringContracts) {
    logger.info(`Contract ${contract.contractNumber} expires on ${contract.endDate}`);
    if (contract.customer.adminUser?.email) {
      await emailQueue.add('contract-expiry-warning', {
        recordId: undefined,
        event: 'CONTRACT_EXPIRY_WARNING',
        tenantId: contract.customer.tenantId,
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        expiryDate: contract.endDate,
        customerName: contract.customer.companyName,
        adminEmail: contract.customer.adminUser.email,
      });
    }
  }
}
