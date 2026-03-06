import { Request } from 'express';
import { AuditAction } from '@prisma/client';
import { prisma } from '../config/database';
import { logger } from '../config/logger';

export interface AuditParams {
  tenantId?: string;
  userId?: string;
  recordId?: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export async function auditLog(params: AuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        oldValues: params.oldValues as any,
        newValues: params.newValues as any,
        metadata: params.metadata as any,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        ...(params.tenantId && { tenant: { connect: { id: params.tenantId } } }),
        ...(params.userId && { user: { connect: { id: params.userId } } }),
        ...(params.recordId && { record: { connect: { id: params.recordId } } }),
      },
    });
  } catch (err) {
    logger.error('Failed to write audit log:', err);
  }
}

export function auditFromRequest(req: Request): Partial<AuditParams> {
  return {
    tenantId: req.user?.tenantId,
    userId: req.user?.sub,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

export function diffObjects(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>
): { old: Record<string, unknown>; new: Record<string, unknown> } {
  const changed: { old: Record<string, unknown>; new: Record<string, unknown> } = { old: {}, new: {} };
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  for (const key of allKeys) {
    if (JSON.stringify(oldObj[key]) !== JSON.stringify(newObj[key])) {
      changed.old[key] = oldObj[key];
      changed.new[key] = newObj[key];
    }
  }
  return changed;
}
