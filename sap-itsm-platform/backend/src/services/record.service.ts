import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { AppError } from '../utils/AppError';
import { auditLog, diffObjects } from '../utils/audit';
import { generateRecordNumber } from '../utils/recordNumber';
import { buildPaginatedResult, paginate } from '../utils/pagination';
import { emailQueue } from '../workers/queues';
import { slaQueue } from '../workers/queues';
import { calculateSLADeadline, isSLAApplicable } from './sla.service';
import { notify } from './notifications/notification.service';
import { RecordStatus, RecordType, Priority, Prisma } from '@prisma/client';

export interface CreateRecordInput {
  recordType: RecordType;
  title: string;
  description: string;
  priority: Priority;
  customerId?: string;
  contractId?: string;
  assignedAgentId?: string;
  ciId?: string;
  parentProblemId?: string;
  sapModuleId?: string;
  sapSubModuleId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  tenantId: string;
  createdById: string;
}

export interface ListRecordsInput {
  tenantId: string;
  page: number;
  limit: number;
  recordType?: RecordType;
  status?: RecordStatus;
  priority?: Priority;
  assignedAgentId?: string;
  customerId?: string;
  customerIdIn?: string[];  // PROJECT_MANAGER role: scope to managed company IDs
  createdById?: string;     // USER role: scope to own tickets only
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  from?: string;
  to?: string;
}

const RECORD_SELECT = {
  id: true,
  tenantId: true,
  recordType: true,
  recordNumber: true,
  title: true,
  description: true,
  priority: true,
  status: true,
  customerId: true,
  contractId: true,
  assignedAgentId: true,
  ciId: true,
  parentProblemId: true,
  tags: true,
  sapModuleId: true,
  sapSubModuleId: true,
  metadata: true,
  resolvedAt: true,
  closedAt: true,
  respondedAt: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, companyName: true, timezone: true } },
  assignedAgent: {
    select: { id: true, level: true, user: { select: { firstName: true, lastName: true, email: true } } },
  },
  ci: { select: { id: true, name: true, ciType: true } },
  sapModule: { select: { id: true, code: true, name: true } },
  sapSubModule: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  contract: {
    select: {
      id: true, contractNumber: true,
      slaPolicyMaster: { select: { name: true, code: true, warningThreshold: true, priorities: true } },
      supportTypeMaster: { select: { name: true, code: true, workDays: true, slaPauseConditions: true } },
    },
  },
  slaTracking: {
    select: {
      responseDeadline: true,
      resolutionDeadline: true,
      respondedAt: true,
      pausedAt: true,
      pausedMinutes: true,
      breachResponse: true,
      breachResolution: true,
    },
  },
} satisfies Prisma.ITSMRecordSelect;

export async function createRecord(input: CreateRecordInput) {
  const recordNumber = await generateRecordNumber(input.tenantId, input.recordType);

  // Auto-resolve customerId: if not provided, use the creating user's customerId
  if (!input.customerId && input.createdById) {
    const creator = await prisma.user.findUnique({
      where: { id: input.createdById },
      select: { customerId: true },
    });
    if (creator?.customerId) {
      input.customerId = creator.customerId;
    }
  }

  let slaTracking: Prisma.SLATrackingCreateWithoutRecordInput | undefined;

  if (input.contractId) {
    // Check if SLA applies for this contract + priority
    const applicable = await isSLAApplicable(input.contractId, input.priority);

    if (applicable) {
      // Load contract with SLA policy
      const contract = await prisma.contract.findUnique({
        where: { id: input.contractId },
        include: {
          slaPolicyMaster: true,
          customer: { select: { timezone: true } },
        },
      });

      if (contract?.slaPolicyMaster) {
        const priorities = contract.slaPolicyMaster.priorities as Record<string, { response: number; resolution: number; enabled?: boolean }>;
        const targets = priorities[input.priority];

        if (targets && targets.response && targets.resolution) {
          const timezone = contract.customer?.timezone || 'UTC';
          const now = new Date();

          // Use business-hours-aware deadline calculator
          const [responseDeadline, resolutionDeadline] = await Promise.all([
            calculateSLADeadline({
              startTime: now,
              targetMinutes: targets.response,
              contractId: input.contractId,
              timezone,
            }),
            calculateSLADeadline({
              startTime: now,
              targetMinutes: targets.resolution,
              contractId: input.contractId,
              timezone,
            }),
          ]);

          slaTracking = { responseDeadline, resolutionDeadline };
        }
      }
    }
  }

  // Smart Agent Assignment: if no agent specified and customer has assignment rules
  if (!input.assignedAgentId && input.customerId) {
    try {
      const { findMatchingRule, scoreAgents, roundRobinAgent } = await import('./assignment.service');
      const rule = await findMatchingRule({
        tenantId: input.tenantId,
        customerId: input.customerId,
        recordType: input.recordType,
        priority: input.priority,
        sapModuleId: input.sapModuleId,
      });

      if (rule && rule.assignmentMode === 'AUTO_ASSIGN') {
        const scores = await scoreAgents({
          tenantId: input.tenantId,
          customerId: input.customerId,
          priority: input.priority,
          sapModuleId: input.sapModuleId,
          sapSubModuleId: input.sapSubModuleId,
          preferredLevel: rule.preferredLevel,
        });
        const best = scores.find(s => s.status !== 'OFFLINE' && s.openTickets < s.maxConcurrent);
        if (best) input.assignedAgentId = best.agentId;
      } else if (rule && rule.assignmentMode === 'ROUND_ROBIN') {
        const agent = await roundRobinAgent({
          tenantId: input.tenantId,
          customerId: input.customerId,
          sapModuleId: input.sapModuleId,
        });
        if (agent) input.assignedAgentId = agent.agentId;
      }
    } catch (err) {
      // Don't fail ticket creation if assignment engine errors
      console.error('[SmartAssignment] Error:', err);
    }
  }

  const record = await prisma.iTSMRecord.create({
    data: {
      tenantId:        input.tenantId,
      recordType:      input.recordType,
      recordNumber,
      title:           input.title,
      description:     input.description,
      priority:        input.priority,
      customerId:      input.customerId,
      contractId:      input.contractId,
      assignedAgentId: input.assignedAgentId,
      ciId:            input.ciId,
      parentProblemId: input.parentProblemId,
      sapModuleId:     input.sapModuleId || null,
      sapSubModuleId:  input.sapSubModuleId || null,
      tags:            input.tags || [],
      metadata:        (input.metadata || {}) as any,
      createdById:     input.createdById,
      status:          'NEW',
      slaTracking:     slaTracking ? { create: slaTracking } : undefined,
    },
    select: RECORD_SELECT,
  });

  await auditLog({
    tenantId:   input.tenantId,
    userId:     input.createdById,
    recordId:   record.id,
    action:     'CREATE',
    entityType: 'ITSMRecord',
    entityId:   record.id,
    newValues:  { recordNumber, recordType: input.recordType, priority: input.priority },
  });

  // Notify via notification rules (creates in-app + queues email)
  await notify({ event: 'TICKET_CREATED', recordId: record.id, tenantId: input.tenantId, triggeredBy: input.createdById });

  if (slaTracking) {
    await slaQueue.add('sla-check', { recordId: record.id }, { delay: 60 * 1000 });
  }

  return record;
}

export async function listRecords(input: ListRecordsInput) {
  const { skip, take } = paginate(input.page, input.limit);

  const where: Prisma.ITSMRecordWhereInput = {
    tenantId: input.tenantId,
    ...(input.recordType      && { recordType:      input.recordType }),
    ...(input.status          && { status:          input.status }),
    ...(input.priority        && { priority:        input.priority }),
    ...(input.assignedAgentId && { assignedAgentId: input.assignedAgentId }),
    ...(input.customerId      && { customerId:      input.customerId }),
    ...(input.customerIdIn    && { customerId:      { in: input.customerIdIn } }),
    ...(input.createdById     && { createdById:     input.createdById }),
    ...(input.search && {
      OR: [
        { title:        { contains: input.search, mode: 'insensitive' } },
        { description:  { contains: input.search, mode: 'insensitive' } },
        { recordNumber: { contains: input.search, mode: 'insensitive' } },
      ],
    }),
    ...((input.from || input.to) ? {
      createdAt: {
        ...(input.from && { gte: new Date(input.from) }),
        ...(input.to   && { lte: new Date(input.to) }),
      },
    } : {}),
  };

  const orderBy: Prisma.ITSMRecordOrderByWithRelationInput = {
    [input.sortBy || 'createdAt']: input.sortOrder || 'desc',
  };

  const [records, total] = await Promise.all([
    prisma.iTSMRecord.findMany({ where, select: RECORD_SELECT, skip, take, orderBy }),
    prisma.iTSMRecord.count({ where }),
  ]);

  return buildPaginatedResult(records, total, input.page, input.limit);
}

export async function getRecord(id: string, tenantId: string) {
  const cacheKey = `record:${id}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const record = await prisma.iTSMRecord.findFirst({
    where: { id, tenantId },
    select: {
      ...RECORD_SELECT,
      comments: {
        select: {
          id: true, text: true, internalFlag: true, createdAt: true,
          author: { select: { id: true, firstName: true, lastName: true, role: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      timeEntries: {
        select: {
          id: true, hours: true, description: true, workDate: true, status: true,
          agent: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      },
      linkedIncidents: {
        select: { id: true, recordNumber: true, title: true, status: true, priority: true },
      },
    },
  });

  if (!record) throw new AppError('Record not found', 404, 'NOT_FOUND');

  await cache.set(cacheKey, record, 120);
  return record;
}

export async function updateRecord(
  id: string,
  tenantId: string,
  userId: string,
  updates: Partial<{
    title: string;
    description: string;
    priority: Priority;
    status: RecordStatus;
    assignedAgentId: string | null;
    ciId: string | null;
    sapModuleId: string | null;
    sapSubModuleId: string | null;
    tags: string[];
    metadata: Record<string, unknown>;
  }>
) {
  const existing = await prisma.iTSMRecord.findFirst({ where: { id, tenantId } });
  if (!existing) throw new AppError('Record not found', 404, 'NOT_FOUND');

  const now = new Date();
  const statusData: Partial<Prisma.ITSMRecordUpdateInput> = {};

  if (updates.status) {
    if (['RESOLVED', 'CLOSED'].includes(updates.status) && !existing.resolvedAt) {
      statusData.resolvedAt = now;
    }
    if (updates.status === 'CLOSED' && !existing.closedAt) {
      statusData.closedAt = now;
    }

    // SLA pause/resume using support type conditions from contract
    const sla = await prisma.sLATracking.findUnique({ where: { recordId: id } });
    if (sla) {
      // Load contract's support type pause conditions
      let pauseConditions: string[] = ['PENDING'];
      if (existing.contractId) {
        const contract = await prisma.contract.findUnique({
          where: { id: existing.contractId },
          select: { supportTypeMaster: { select: { slaPauseConditions: true } } },
        });
        if (contract?.supportTypeMaster?.slaPauseConditions?.length) {
          pauseConditions = contract.supportTypeMaster.slaPauseConditions;
        }
      }

      const statusPauseMap: Record<string, string> = {
        'PENDING': 'WAITING_CUSTOMER',
      };
      const newStatusCondition = statusPauseMap[updates.status] || updates.status;
      const oldStatusCondition = statusPauseMap[existing.status] || existing.status;

      const willPause  = pauseConditions.includes('WAITING_CUSTOMER') && updates.status === 'PENDING';
      const wasPaused  = pauseConditions.includes('WAITING_CUSTOMER') && existing.status === 'PENDING';

      if (!wasPaused && willPause && !sla.pausedAt) {
        await prisma.sLATracking.update({
          where: { recordId: id },
          data: { pausedAt: now },
        });
      } else if (wasPaused && !willPause && sla.pausedAt) {
        const addedMinutes = Math.floor((now.getTime() - sla.pausedAt.getTime()) / 60000);
        await prisma.sLATracking.update({
          where: { recordId: id },
          data: {
            pausedAt:          null,
            pausedMinutes:     { increment: addedMinutes },
            responseDeadline:  new Date(sla.responseDeadline.getTime()  + addedMinutes * 60000),
            resolutionDeadline: new Date(sla.resolutionDeadline.getTime() + addedMinutes * 60000),
          },
        });
      }
    }
  }

  const updated = await prisma.iTSMRecord.update({
    where: { id },
    data: { ...(updates as any), ...(statusData as any) },
    select: RECORD_SELECT,
  });

  await cache.del(`record:${id}`);

  const diff = diffObjects(existing as any, { ...existing, ...updates } as any);
  await auditLog({
    tenantId, userId, recordId: id,
    action:     updates.status ? 'STATUS_CHANGE' : 'UPDATE',
    entityType: 'ITSMRecord',
    entityId:   id,
    oldValues:  diff.old,
    newValues:  diff.new,
  });

  if (updates.status) {
    await notify({
      event: 'STATUS_CHANGED', recordId: id, tenantId, triggeredBy: userId,
      payload: { oldStatus: existing.status, newStatus: updates.status },
    });
  }
  if (updates.assignedAgentId && updates.assignedAgentId !== existing.assignedAgentId) {
    await notify({
      event: 'ASSIGNED', recordId: id, tenantId, triggeredBy: userId,
      payload: { agentId: updates.assignedAgentId },
    });
  }

  return updated;
}

export async function addComment(
  recordId: string, tenantId: string, authorId: string,
  text: string, internalFlag: boolean
) {
  const record = await prisma.iTSMRecord.findFirst({ where: { id: recordId, tenantId } });
  if (!record) throw new AppError('Record not found', 404, 'NOT_FOUND');

  const comment = await prisma.comment.create({
    data: { recordId, authorId, text, internalFlag },
    include: { author: { select: { firstName: true, lastName: true, role: true } } },
  });

  await cache.del(`record:${recordId}`);
  await auditLog({
    tenantId, userId: authorId, recordId,
    action: 'COMMENT', entityType: 'Comment', entityId: comment.id,
    newValues: { internalFlag, length: text.length },
  });

  if (!internalFlag) {
    // Determine event based on commenter's role
    const authorRole = comment.author?.role;
    const commentEvent = (authorRole === 'AGENT' || authorRole === 'SUPER_ADMIN' || authorRole === 'PROJECT_MANAGER')
      ? 'COMMENT_AGENT' : 'COMMENT_USER';
    await notify({
      event: commentEvent, recordId, tenantId, triggeredBy: authorId,
      payload: {
        commentId: comment.id,
        commentText: text,
        authorName: `${comment.author.firstName} ${comment.author.lastName}`,
      },
    });
  }
  return comment;
}

export async function addTimeEntry(
  recordId: string, tenantId: string, agentUserId: string,
  hours: number, description: string, workDate: string
) {
  const record = await prisma.iTSMRecord.findFirst({ where: { id: recordId, tenantId } });
  if (!record) throw new AppError('Record not found', 404, 'NOT_FOUND');

  const agent = await prisma.agent.findFirst({ where: { userId: agentUserId } });
  if (!agent) throw new AppError('Agent profile not found', 404, 'NOT_FOUND');

  const entry = await prisma.timeEntry.create({
    data: { recordId, agentId: agent.id, hours, description, workDate: new Date(workDate) },
    include: { agent: { include: { user: { select: { firstName: true, lastName: true } } } } },
  });

  await auditLog({
    tenantId, userId: agentUserId, recordId,
    action: 'UPDATE', entityType: 'TimeEntry', entityId: entry.id,
    newValues: { hours, description, workDate },
  });

  return entry;
}
