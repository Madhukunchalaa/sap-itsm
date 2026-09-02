import { z } from 'zod';

export const createRecordSchema = z.object({
  body: z.object({
    recordType: z.enum(['INCIDENT', 'REQUEST', 'PROBLEM', 'CHANGE']),
    title: z.string().min(5).max(500),
    description: z.string().min(10).max(10000000),
    priority: z.enum(['P1', 'P2', 'P3', 'P4']).default('P3'),
    customerId: z.string().uuid().optional(),
    contractId: z.string().uuid().optional(),
    assignedAgentId: z.string().uuid().optional(),
    ciId: z.string().uuid().optional(),
    parentProblemId: z.string().uuid().optional(),
    sapModuleId: z.string().uuid().nullable().optional(),
    sapSubModuleId: z.string().uuid().nullable().optional(),
    plant: z.string().nullable().optional(),
    tags: z.array(z.string()).default([]),
    metadata: z.record(z.unknown()).optional(),
  }),
});

export const updateRecordSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    title: z.string().min(5).max(500).optional(),
    description: z.string().min(10).max(10000000).optional(),
    priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
    status: z
      .enum(['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'CANCELLED', 'AWAITING_CUSTOMER', 'WITH_SAP', 'IN_UAT', 'HOLD', 'DEVELOPMENT_COMPLETED', 'MOVED_TO_QUALITY', 'MOVED_TO_PRODUCTION', 'REOPEN'])
      .optional(),
    assignedAgentId: z.string().uuid().nullable().optional(),
    ciId: z.string().uuid().nullable().optional(),
    sapModuleId: z.string().uuid().nullable().optional(),
    sapSubModuleId: z.string().uuid().nullable().optional(),
    plant: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
    targetDate: z.union([z.coerce.date(), z.null()]).optional(),
    revisedTargetDate: z.union([z.coerce.date(), z.null()]).optional(),
  }),
});

export const listRecordsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    // 5000 ceiling: normal pages stay small, but "Export All Rows" fetches
    // the full filtered set in one request
    limit: z.coerce.number().int().min(1).max(5000).default(20),
    recordType: z
      .union([
        z.enum(['INCIDENT', 'REQUEST', 'PROBLEM', 'CHANGE']),
        z.array(z.enum(['INCIDENT', 'REQUEST', 'PROBLEM', 'CHANGE'])),
      ])
      .optional(),
    status: z
      .union([
        z.enum(['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'CANCELLED', 'AWAITING_CUSTOMER', 'WITH_SAP', 'IN_UAT', 'HOLD', 'DEVELOPMENT_COMPLETED', 'MOVED_TO_QUALITY', 'MOVED_TO_PRODUCTION', 'REOPEN']),
        z.array(z.enum(['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'CANCELLED', 'AWAITING_CUSTOMER', 'WITH_SAP', 'IN_UAT', 'HOLD', 'DEVELOPMENT_COMPLETED', 'MOVED_TO_QUALITY', 'MOVED_TO_PRODUCTION', 'REOPEN'])),
      ])
      .optional(),
    priority: z
      .union([
        z.enum(['P1', 'P2', 'P3', 'P4']),
        z.array(z.enum(['P1', 'P2', 'P3', 'P4'])),
      ])
      .optional(),
    assignedAgentId: z
      .union([
        z.string().uuid(),
        z.array(z.string().uuid()),
      ])
      .optional(),
    createdById: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    sapModuleId: z
      .union([
        z.string().uuid(),
        z.array(z.string().uuid()),
      ])
      .optional(),
    plant: z.string().optional(),
    search: z.string().max(200).optional(),
    sortBy: z
      .enum(['createdAt', 'updatedAt', 'priority', 'status', 'recordNumber'])
      .default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    targetDateFrom: z.string().datetime().optional(),
    targetDateTo: z.string().datetime().optional(),
  }),
});


export const addCommentSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    text: z.string().min(1).max(10000000), // Allow large base64 screenshots in comments
    internalFlag: z.boolean().default(false),
  }),
});

export const addTimeEntrySchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    hours: z.number().positive().max(24),
    description: z.string().min(1).max(1000),
    workDate: z.string().datetime(),
  }),
});
