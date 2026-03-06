import { z } from 'zod';

export const createRecordSchema = z.object({
  body: z.object({
    recordType: z.enum(['INCIDENT', 'REQUEST', 'PROBLEM', 'CHANGE']),
    title: z.string().min(5).max(500),
    description: z.string().min(10).max(10000),
    priority: z.enum(['P1', 'P2', 'P3', 'P4']).default('P3'),
    customerId: z.string().uuid().optional(),
    contractId: z.string().uuid().optional(),
    assignedAgentId: z.string().uuid().optional(),
    ciId: z.string().uuid().optional(),
    parentProblemId: z.string().uuid().optional(),
    sapModuleId: z.string().uuid().nullable().optional(),
    sapSubModuleId: z.string().uuid().nullable().optional(),
    tags: z.array(z.string()).default([]),
    metadata: z.record(z.unknown()).optional(),
  }),
});

export const updateRecordSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    title: z.string().min(5).max(500).optional(),
    description: z.string().min(10).max(10000).optional(),
    priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
    status: z
      .enum(['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'CANCELLED'])
      .optional(),
    assignedAgentId: z.string().uuid().nullable().optional(),
    ciId: z.string().uuid().nullable().optional(),
    sapModuleId: z.string().uuid().nullable().optional(),
    sapSubModuleId: z.string().uuid().nullable().optional(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
});

export const listRecordsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    recordType: z.enum(['INCIDENT', 'REQUEST', 'PROBLEM', 'CHANGE']).optional(),
    status: z
      .enum(['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'CANCELLED'])
      .optional(),
    priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
    assignedAgentId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    search: z.string().max(200).optional(),
    sortBy: z
      .enum(['createdAt', 'updatedAt', 'priority', 'status', 'recordNumber'])
      .default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  }),
});

export const addCommentSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    text: z.string().min(1).max(5000),
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
