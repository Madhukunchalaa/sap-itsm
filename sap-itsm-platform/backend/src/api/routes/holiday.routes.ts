import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { resolveAgent, resolveManagedCustomerIds } from './scopeHelpers';

export const holidayRouter = Router();
holidayRouter.use(verifyJWT, enforceTenantScope);

holidayRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const calendars = await prisma.holidayCalendar.findMany({
      where: { tenantId: req.user!.tenantId },
      include: { dates: { orderBy: { date: 'asc' } } },
    });
    res.json({ success: true, calendars });
  } catch (err) { next(err); }
});

holidayRouter.post('/', enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { dates, ...calData } = req.body;
    const calendar = await prisma.holidayCalendar.create({
      data: { ...calData, tenantId: req.user!.tenantId, dates: dates ? { create: dates } : undefined },
      include: { dates: true },
    });
    res.status(201).json({ success: true, calendar });
  } catch (err) { next(err); }
});

holidayRouter.patch('/:calendarId', enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = ['name', 'country', 'year', 'isActive'];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    await prisma.holidayCalendar.updateMany({ where: { id: req.params.calendarId, tenantId: req.user!.tenantId }, data });
    res.json({ success: true });
  } catch (err) { next(err); }
});

holidayRouter.post('/:calendarId/dates', enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cal = await prisma.holidayCalendar.findFirst({ where: { id: req.params.calendarId, tenantId: req.user!.tenantId } });
    if (!cal) { res.status(404).json({ success: false, error: 'Calendar not found' }); return; }
    const date = await prisma.holidayDate.create({ data: { ...req.body, calendarId: req.params.calendarId } });
    res.status(201).json({ success: true, date });
  } catch (err) { next(err); }
});

holidayRouter.patch('/:calendarId/dates/:dateId', enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = ['name', 'date', 'supportType'];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    await prisma.holidayDate.update({ where: { id: req.params.dateId }, data });
    res.json({ success: true });
  } catch (err) { next(err); }
});

holidayRouter.delete('/:calendarId/dates/:dateId', enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.holidayDate.delete({ where: { id: req.params.dateId } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

holidayRouter.delete('/:id', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.holidayCalendar.deleteMany({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── AUDIT ROUTES ─────────────────────────────────────────────
// Matrix: SUPER_ADMIN → all, COMPANY_ADMIN → own company records. Others blocked.
export const auditRouter = Router();
auditRouter.use(verifyJWT, enforceTenantScope, enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'));

auditRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page) || 1, limit = Number(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const role = req.user!.role, tenantId = req.user!.tenantId;

    let recordScope: string[] | undefined;

    if (role === 'COMPANY_ADMIN') {
      if (!req.user!.customerId) {
        res.json({ success: true, logs: [], pagination: { page, limit, total: 0 } }); return;
      }
      const companyRecords = await prisma.iTSMRecord.findMany({
        where: { tenantId, customerId: req.user!.customerId },
        select: { id: true },
      });
      recordScope = companyRecords.map((r: any) => r.id);
      if (recordScope.length === 0) {
        res.json({ success: true, logs: [], pagination: { page, limit, total: 0 } }); return;
      }
    }

    const where: any = {
      tenantId,
      ...(recordScope && { recordId: { in: recordScope } }),
      ...(req.query.action && { action: req.query.action }),
      ...(req.query.entityType && { entityType: req.query.entityType }),
      ...(req.query.userId && { userId: req.query.userId }),
      ...(req.query.from && { createdAt: { gte: new Date(req.query.from as string) } }),
    };

    // If a specific recordId is requested, ensure it's in scope
    if (req.query.recordId) {
      if (recordScope) {
        where.recordId = { in: recordScope.filter(id => id === req.query.recordId) };
      } else {
        where.recordId = req.query.recordId;
      }
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where, skip, take: limit,
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ success: true, logs, pagination: { page, limit, total } });
  } catch (err) { next(err); }
});

// ── REPORT ROUTES ─────────────────────────────────────────────
// Matrix:
//   time-entries:     SUPER_ADMIN=all, AGENT=own, PM=managed companies, COMPANY_ADMIN/USER=blocked
//   resolution-times: SUPER_ADMIN=all, PM=managed companies, COMPANY_ADMIN=own company, AGENT/USER=blocked
export const reportRouter = Router();
reportRouter.use(verifyJWT, enforceTenantScope, enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'AGENT', 'PROJECT_MANAGER'));

reportRouter.get('/time-entries', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = req.user!.role, tenantId = req.user!.tenantId, userId = req.user!.sub;
    // COMPANY_ADMIN and USER blocked
    if (role === 'COMPANY_ADMIN') { res.status(403).json({ success: false, error: 'Access denied' }); return; }

    const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 30 * 86400000);
    const to = req.query.to ? new Date(req.query.to as string) : new Date();
    let recordFilter: any = { tenantId };
    let agentIdFilter: string | undefined;

    if (role === 'AGENT') {
      const agent = await resolveAgent(userId);
      if (!agent) { res.json({ success: true, entries: [], totalHours: 0 }); return; }
      agentIdFilter = agent.id;
    } else if (role === 'PROJECT_MANAGER') {
      const agent = await resolveAgent(userId);
      if (!agent) { res.json({ success: true, entries: [], totalHours: 0 }); return; }
      const ids = await resolveManagedCustomerIds(agent.id, tenantId);
      if (ids.length === 0) { res.json({ success: true, entries: [], totalHours: 0 }); return; }
      recordFilter = { tenantId, customerId: { in: ids } };
    }

    const entries = await prisma.timeEntry.findMany({
      where: {
        record: recordFilter, workDate: { gte: from, lte: to },
        ...(agentIdFilter && { agentId: agentIdFilter }),
        ...(req.query.agentId && !agentIdFilter && { agentId: req.query.agentId as string }),
        ...(req.query.status && { status: req.query.status as any }),
      },
      include: {
        record: { select: { recordNumber: true, title: true, customer: { select: { companyName: true } } } },
        agent: { include: { user: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: { workDate: 'desc' }, take: 1000,
    });
    const totalHours = entries.reduce((sum: number, e: any) => sum + Number(e.hours), 0);
    res.json({ success: true, entries, totalHours });
  } catch (err) { next(err); }
});

reportRouter.get('/resolution-times', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = req.user!.role, tenantId = req.user!.tenantId, userId = req.user!.sub;
    // AGENT blocked
    if (role === 'AGENT') { res.status(403).json({ success: false, error: 'Access denied' }); return; }

    const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 30 * 86400000);
    let stats: any[];

    if (role === 'COMPANY_ADMIN') {
      const customerId = req.user!.customerId;
      if (!customerId) { res.json({ success: true, stats: [] }); return; }
      stats = await prisma.$queryRaw<any[]>`
        SELECT priority, COUNT(*) as total,
               AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as avg_hours,
               MIN(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as min_hours,
               MAX(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as max_hours
        FROM itsm_records WHERE tenant_id = ${tenantId}
          AND customer_id = ${customerId}::uuid
          AND resolved_at IS NOT NULL AND created_at >= ${from}
        GROUP BY priority ORDER BY priority`;
    } else if (role === 'PROJECT_MANAGER') {
      const agent = await resolveAgent(userId);
      if (!agent) { res.json({ success: true, stats: [] }); return; }
      const ids = await resolveManagedCustomerIds(agent.id, tenantId);
      if (ids.length === 0) { res.json({ success: true, stats: [] }); return; }
      stats = await prisma.$queryRaw<any[]>`
        SELECT priority, COUNT(*) as total,
               AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as avg_hours,
               MIN(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as min_hours,
               MAX(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as max_hours
        FROM itsm_records WHERE tenant_id = ${tenantId}
          AND customer_id = ANY(${ids}::uuid[])
          AND resolved_at IS NOT NULL AND created_at >= ${from}
        GROUP BY priority ORDER BY priority`;
    } else {
      // SUPER_ADMIN
      stats = await prisma.$queryRaw<any[]>`
        SELECT priority, COUNT(*) as total,
               AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as avg_hours,
               MIN(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as min_hours,
               MAX(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as max_hours
        FROM itsm_records WHERE tenant_id = ${tenantId}
          AND resolved_at IS NOT NULL AND created_at >= ${from}
        GROUP BY priority ORDER BY priority`;
    }
    res.json({ success: true, stats });
  } catch (err) { next(err); }
});

export default holidayRouter;

// ── EMAIL LOG ROUTES ──────────────────────────────────────────
export const emailLogRouter = Router();
emailLogRouter.use(verifyJWT, enforceTenantScope, enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'));

emailLogRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page) || 1, limit = Number(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    // COMPANY_ADMIN: only see logs for their customer's records
    let recordWhere: any = { tenantId: req.user!.tenantId };
    if (req.user!.role === 'COMPANY_ADMIN' && req.user!.customerId) {
      recordWhere.customerId = req.user!.customerId;
    }

    const [logs, total] = await Promise.all([
      prisma.emailLog.findMany({
        where: { record: recordWhere },
        include: { record: { select: { recordNumber: true, title: true } } },
        orderBy: { createdAt: 'desc' }, skip, take: limit,
      }),
      prisma.emailLog.count({ where: { record: recordWhere } }),
    ]);
    res.json({ success: true, logs, pagination: { page, limit, total } });
  } catch (err) { next(err); }
});

// GET single email log with full body for preview
emailLogRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    let recordWhere: any = { tenantId: req.user!.tenantId };
    if (req.user!.role === 'COMPANY_ADMIN' && req.user!.customerId) {
      recordWhere.customerId = req.user!.customerId;
    }

    const log = await prisma.emailLog.findFirst({
      where: { id: req.params.id, record: recordWhere },
      include: { record: { select: { recordNumber: true, title: true } } },
    });

    if (!log) {
      res.status(404).json({ success: false, error: 'Email log not found' });
      return;
    }

    res.json({ success: true, log });
  } catch (err) { next(err); }
});
