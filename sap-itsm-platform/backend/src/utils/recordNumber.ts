import { prisma } from '../config/database';
import { redis } from '../config/redis';

const PREFIX_MAP: Record<string, string> = {
  INCIDENT: 'INC',
  REQUEST: 'REQ',
  PROBLEM: 'PRB',
  CHANGE: 'CHG',
};

/**
 * Generate a unique, sequential record number per tenant per type.
 * Uses Redis atomic counter for performance, DB as fallback.
 */
export async function generateRecordNumber(
  tenantId: string,
  recordType: string
): Promise<string> {
  const prefix = PREFIX_MAP[recordType] || 'TKT';
  const year = new Date().getFullYear();
  const redisKey = `counter:${tenantId}:${recordType}:${year}`;

  try {
    const count = await redis.incr(redisKey);
    // Set expiry at end of year + buffer
    await redis.expireat(redisKey, Math.floor(new Date(`${year + 1}-02-01`).getTime() / 1000));
    return `${prefix}-${year}-${String(count).padStart(6, '0')}`;
  } catch {
    // Fallback to DB count if Redis unavailable
    const count = await prisma.iTSMRecord.count({
      where: {
        tenantId,
        recordType: recordType as any,
        createdAt: { gte: new Date(`${year}-01-01`) },
      },
    });
    return `${prefix}-${year}-${String(count + 1).padStart(6, '0')}`;
  }
}
