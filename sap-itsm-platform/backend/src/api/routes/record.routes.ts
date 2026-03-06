import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import {
  createRecordSchema, updateRecordSchema, listRecordsSchema,
  addCommentSchema, addTimeEntrySchema,
} from '../validators/record.validators';
import {
  createRecord, listRecords, getRecord, updateRecord, addComment, addTimeEntry,
} from '../../services/record.service';
import { prisma } from '../../config/database';
import { resolveAgent, resolveManagedCustomerIds } from './scopeHelpers';
import { buildPaginatedResult } from '../../utils/pagination';

const router = Router();
router.use(verifyJWT, enforceTenantScope);

const EMPTY = { success: true, ...buildPaginatedResult([], 0, 1, 20) };

// ─────────────────────────────────────────────────────────────
// GET /records — list with role-based scoping
//
//  SUPER_ADMIN   → all records in tenant
//  COMPANY_ADMIN → WHERE customer_id = user's customerId
//  PM            → WHERE customer_id IN (companies where PM is assigned)
//  USER          → WHERE created_by_id = userId
//  AGENT         → WHERE assigned_agent_id = agent.id
// ─────────────────────────────────────────────────────────────
router.get('/', validate(listRecordsSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q    = req.query as any;
    const role = req.user!.role;

    // These will be passed to listRecords to add WHERE conditions
    let customerId:      string | undefined;
    let customerIdIn:    string[] | undefined;
    let createdById:     string | undefined;
    let assignedAgentId: string | undefined;

    switch (role) {
      case 'COMPANY_ADMIN': {
        if (!req.user!.customerId) { res.json(EMPTY); return; }
        customerId = req.user!.customerId;
        break;
      }
      case 'PROJECT_MANAGER': {
        const agent = await resolveAgent(req.user!.sub);
        if (!agent) { res.json(EMPTY); return; }
        const ids = await resolveManagedCustomerIds(agent.id, req.user!.tenantId);
        if (ids.length === 0) { res.json(EMPTY); return; }
        customerIdIn = ids;
        break;
      }
      case 'USER': {
        createdById = req.user!.sub;
        break;
      }
      case 'AGENT': {
        const agent = await resolveAgent(req.user!.sub);
        if (!agent) { res.json(EMPTY); return; }
        assignedAgentId = agent.id;
        break;
      }
      // SUPER_ADMIN: no extra filters
    }

    const result = await listRecords({
      tenantId:        req.user!.tenantId,
      page:            Number(q.page) || 1,
      limit:           Number(q.limit) || 20,
      recordType:      q.recordType,
      status:          q.status,
      priority:        q.priority,
      customerId:      customerIdIn ? undefined : customerId,
      customerIdIn:    customerIdIn,
      createdById:     createdById,
      assignedAgentId: assignedAgentId,
      search:          q.search,
      sortBy:          q.sortBy,
      sortOrder:       q.sortOrder,
      from:            q.from,
      to:              q.to,
    });

    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────
// GET /records/:id — single record with same role-based access
// ─────────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const record = await getRecord(req.params.id, req.user!.tenantId) as any;
    if (!record) { res.status(404).json({ success: false, error: 'Not found' }); return; }

    const role   = req.user!.role;
    const userId = req.user!.sub;

    // Access check — same 5 rules
    switch (role) {
      case 'COMPANY_ADMIN': {
        if (record.customerId !== req.user!.customerId) {
          res.status(403).json({ success: false, error: 'Access denied' }); return;
        }
        break;
      }
      case 'PROJECT_MANAGER': {
        const agent = await resolveAgent(userId);
        if (!agent) { res.status(403).json({ success: false, error: 'Access denied' }); return; }
        const ids = await resolveManagedCustomerIds(agent.id, req.user!.tenantId);
        if (!ids.includes(record.customerId)) {
          res.status(403).json({ success: false, error: 'Access denied' }); return;
        }
        break;
      }
      case 'USER': {
        if (record.createdBy?.id !== userId) {
          res.status(403).json({ success: false, error: 'Access denied' }); return;
        }
        break;
      }
      case 'AGENT': {
        const agent = await resolveAgent(userId);
        if (!agent || record.assignedAgentId !== agent.id) {
          res.status(403).json({ success: false, error: 'Access denied' }); return;
        }
        break;
      }
      // SUPER_ADMIN: no check needed
    }

    // Filter internal notes — only staff roles
    if (!['SUPER_ADMIN', 'AGENT', 'PROJECT_MANAGER'].includes(role)) {
      if (record.comments) {
        record.comments = record.comments.filter((c: any) => !c.internalFlag);
      }
      record.timeEntries = [];
    }

    res.json({ success: true, record });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────
// POST /records — create
// ─────────────────────────────────────────────────────────────
router.post('/',
  enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'AGENT', 'USER', 'PROJECT_MANAGER'),
  validate(createRecordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await createRecord({
        ...req.body,
        tenantId: req.user!.tenantId,
        createdById: req.user!.sub,
      });
      res.status(201).json({ success: true, record });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────────────────────
// PATCH /records/:id — update (USER blocked)
// ─────────────────────────────────────────────────────────────
router.patch('/:id',
  enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'AGENT', 'PROJECT_MANAGER'),
  validate(updateRecordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await updateRecord(
        req.params.id, req.user!.tenantId, req.user!.sub, req.body
      );
      res.json({ success: true, record });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────────────────────
// POST /records/:id/comment
// ─────────────────────────────────────────────────────────────
router.post('/:id/comment', validate(addCommentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const comment = await addComment(
        req.params.id, req.user!.tenantId, req.user!.sub,
        req.body.text, req.body.internalFlag ?? false,
      );
      res.status(201).json({ success: true, comment });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────────────────────
// POST /records/:id/time-entry
// ─────────────────────────────────────────────────────────────
router.post('/:id/time-entry',
  enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'AGENT', 'PROJECT_MANAGER'),
  validate(addTimeEntrySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await addTimeEntry(
        req.params.id, req.user!.tenantId, req.user!.sub,
        req.body.hours, req.body.description, req.body.workDate,
      );
      res.status(201).json({ success: true, entry });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────────────────────
// PATCH /records/:id/time-entry/:entryId (approve/reject)
// ─────────────────────────────────────────────────────────────
router.patch('/:id/time-entry/:entryId',
  enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_MANAGER'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = req.body;
      if (!['APPROVED', 'REJECTED'].includes(status)) {
        res.status(400).json({ success: false, error: 'Invalid status' }); return;
      }
      await prisma.timeEntry.updateMany({
        where: { id: req.params.entryId, record: { tenantId: req.user!.tenantId } },
        data: { status, approvedById: req.user!.sub, approvedAt: new Date() },
      });
      res.json({ success: true });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────────────────────
// GET /records/:id/history (all roles can view, internal entries filtered in frontend)
// ─────────────────────────────────────────────────────────────
router.get('/:id/history',
  enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'AGENT', 'PROJECT_MANAGER', 'USER'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const history = await prisma.auditLog.findMany({
        where: { recordId: req.params.id, tenantId: req.user!.tenantId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
      });
      res.json({ success: true, history });
    } catch (err) { next(err); }
  }
);

export default router;
