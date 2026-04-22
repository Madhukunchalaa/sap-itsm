import { Queue } from 'bullmq';
import { redis } from '../config/redis';

const connection = redis;

export const emailQueue = new Queue('email', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
});

export const slaQueue = new Queue('sla', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 10000 },
    removeOnComplete: { count: 500 },
  },
});

export const escalationQueue = new Queue('escalation', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { count: 200 },
  },
});

export const contractRenewalQueue = new Queue('contract-renewal', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 },
  },
});

export const sapSyncQueue = new Queue('sap-sync', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 60000 }, // Initial retry after 1 min
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 1000 },
  },
});
