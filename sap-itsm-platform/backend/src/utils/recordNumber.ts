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
    let count = await redis.incr(redisKey);

    // If counter just started (count=1), sync with DB to avoid duplicates after restart
    if (count === 1) {
      const maxRecord = await prisma.iTSMRecord.findFirst({
        where: { tenantId, recordType: recordType as any, createdAt: { gte: new Date(`${year}-01-01`) } },
        orderBy: { recordNumber: 'desc' },
        select: { recordNumber: true },
      });
      if (maxRecord) {
        const parts = maxRecord.recordNumber.split('-');
        const maxNum = parseInt(parts[parts.length - 1]) || 0;
        await redis.set(redisKey, maxNum);
        count = await redis.incr(redisKey);
      }
    }

    // Set expiry at end of year + buffer
    await redis.expireat(redisKey, Math.floor(new Date(`${year + 1}-02-01`).getTime() / 1000));
    return `${prefix}-${year}-${String(count).padStart(6, '0')}`;
  } catch {
    // Fallback to DB max if Redis unavailable
    const maxRecord = await prisma.iTSMRecord.findFirst({
      where: { tenantId, recordType: recordType as any, createdAt: { gte: new Date(`${year}-01-01`) } },
      orderBy: { recordNumber: 'desc' },
      select: { recordNumber: true },
    });
    let nextNum = 1;
    if (maxRecord) {
      const parts = maxRecord.recordNumber.split('-');
      nextNum = (parseInt(parts[parts.length - 1]) || 0) + 1;
    }
    return `${prefix}-${year}-${String(nextNum).padStart(6, '0')}`;
  }
}
