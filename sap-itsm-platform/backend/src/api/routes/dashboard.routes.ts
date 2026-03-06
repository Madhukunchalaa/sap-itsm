import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceTenantScope, enforceRole } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { RecordStatus } from '@prisma/client';
import { cache } from '../../config/redis';
import { resolveAgent, resolveManagedCustomerIds } from './scopeHelpers';

const router = Router();
router.use(verifyJWT, enforceTenantScope);
router.use(enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'AGENT', 'PROJECT_MANAGER', 'USER'));

function emptyDashboard() {
  return { summary: { totalOpen: 0, newToday: 0, p1Open: 0, slaBreaches: 0 }, byStatus: [], byPriority: [], byType: [], recentRecords: [], agentWorkload: [], monthlyTrend: [], generatedAt: new Date() };
}

// Helper: build scoped where clause based on role
async function buildScopeWhere(req: any): Promise<{ where: any; cacheKey: string } | null> {
  const role = req.user!.role, userId = req.user!.sub, tenantId = req.user!.tenantId;
  const customerId = req.user!.customerId;

  if (role === 'SUPER_ADMIN') {
    return { where: { tenantId }, cacheKey: cache.key.dashboard(tenantId) };
  }
  if (role === 'COMPANY_ADMIN') {
    if (!customerId) return null;
    return { where: { tenantId, customerId }, cacheKey: `dash:ca:${customerId}` };
  }
  if (role === 'USER') {
    return { where: { tenantId, createdById: userId }, cacheKey: `dash:u:${userId}` };
  }
  if (role === 'AGENT') {
    const agent = await resolveAgent(userId);
    if (!agent) return null;
    return { where: { tenantId, assignedAgentId: agent.id }, cacheKey: `dash:ag:${agent.id}` };
  }
  if (role === 'PROJECT_MANAGER') {
    const agent = await resolveAgent(userId);
    if (!agent) return null;
    const ids = await resolveManagedCustomerIds(agent.id, tenantId);
    if (ids.length === 0) return null;
    return { where: { tenantId, customerId: { in: ids } }, cacheKey: `dash:pm:${agent.id}` };
  }
  return null;
}

// GET /dashboard
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await buildScopeWhere(req);
    if (!scope) { res.json({ success: true, dashboard: emptyDashboard() }); return; }
    const { where: baseWhere, cacheKey } = scope;

    try { const c = await cache.get(cacheKey); if (c) { res.json({ success: true, dashboard: c }); return; } } catch {}

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [totalOpen, newToday, p1Open, slaBreaches, byStatus, byPriority, byType, recentRecords] = await Promise.all([
      prisma.iTSMRecord.count({ where: { ...baseWhere, status: { in: ['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING'] as RecordStatus[] } } }),
      prisma.iTSMRecord.count({ where: { ...baseWhere, createdAt: { gte: today } } }),
      prisma.iTSMRecord.count({ where: { ...baseWhere, priority: 'P1', status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] } } }),
      prisma.sLATracking.count({ where: { AND: [{ record: baseWhere }, { OR: [{ breachResponse: true }, { breachResolution: true }] }] } }).catch(() => 0),
      prisma.iTSMRecord.groupBy({ by: ['status'], where: baseWhere, _count: true }),
      prisma.iTSMRecord.groupBy({ by: ['priority'], where: { ...baseWhere, status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] } }, _count: true }),
      prisma.iTSMRecord.groupBy({ by: ['recordType'], where: { ...baseWhere, status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] } }, _count: true }),
      prisma.iTSMRecord.findMany({
        where: baseWhere,
        select: {
          id: true, recordNumber: true, title: true, priority: true, status: true, recordType: true, createdAt: true,
          customer: { select: { companyName: true } },
          assignedAgent: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { createdAt: 'desc' }, take: 10,
      }),
    ]);

    const dashboard = {
      summary: { totalOpen, newToday, p1Open, slaBreaches },
      byStatus: byStatus.map((s: any) => ({ status: s.status, count: s._count })),
      byPriority: byPriority.map((p: any) => ({ priority: p.priority, count: p._count })),
      byType: byType.map((t: any) => ({ type: t.recordType, count: t._count })),
      recentRecords,
      agentWorkload: [],
      monthlyTrend: [],
      generatedAt: now,
    };

    try { await cache.set(cacheKey, dashboard, 120); } catch {}
    res.json({ success: true, dashboard });
  } catch (err) { next(err); }
});

// GET /dashboard/sla-report
router.get('/sla-report', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await buildScopeWhere(req);
    const emptySla = { success: true, summary: { total: 0, breachResponse: 0, breachResolution: 0, compliant: 0 }, records: [] };
    if (!scope) { res.json(emptySla); return; }

    const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 30 * 86400000);
    const to = req.query.to ? new Date(req.query.to as string) : new Date();
    const baseWhere = { ...scope.where, createdAt: { gte: from, lte: to } };

    const slaData = await prisma.sLATracking.findMany({
      where: { record: baseWhere },
      include: { record: { select: { recordNumber: true, priority: true, recordType: true, status: true, customer: { select: { companyName: true } } } } },
      orderBy: { createdAt: 'desc' }, take: 500,
    });

    const summary = {
      total: slaData.length,
      breachResponse: slaData.filter((s: any) => s.breachResponse).length,
      breachResolution: slaData.filter((s: any) => s.breachResolution).length,
      compliant: slaData.filter((s: any) => !s.breachResponse && !s.breachResolution).length,
    };

    res.json({ success: true, summary, records: slaData });
  } catch (err) { next(err); }
});

// ── PM Operational Health Dashboard ───────────────────────────
router.get('/pm', enforceRole('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    let customerIds: string[] = [];

    if (req.user!.role === 'PROJECT_MANAGER') {
      const agent = await prisma.agent.findUnique({ where: { userId: req.user!.sub }, select: { id: true } });
      if (!agent) { res.json({ success: true, customers: [], slaRisk: [], aging: [], pending: [], moduleHeat: [], agentWorkload: [], recent: [] }); return; }
      const managed = await prisma.customer.findMany({ where: { projectManagerAgentId: agent.id, tenant: { id: tenantId } }, select: { id: true } });
      customerIds = managed.map(c => c.id);
    } else {
      const all = await prisma.customer.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { id: true } });
      customerIds = all.map(c => c.id);
    }

    if (customerIds.length === 0) { res.json({ success: true, customers: [], slaRisk: [], aging: [], pending: [], moduleHeat: [], agentWorkload: [], recent: [] }); return; }

    const baseWhere = { tenantId, customerId: { in: customerIds } };
    const openStatuses: RecordStatus[] = ['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING'];
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    const [customerHealth, slaRisk, aging, pending, moduleHeat, agentWorkload, recent] = await Promise.all([
      // Customer health: per customer SLA + open + breach counts
      Promise.all(customerIds.map(async cid => {
        const cust = await prisma.customer.findUnique({ where: { id: cid }, select: { companyName: true } });
        const open = await prisma.iTSMRecord.count({ where: { tenantId, customerId: cid, status: { in: openStatuses } } });
        const breaches = await prisma.sLATracking.count({ where: { record: { tenantId, customerId: cid, createdAt: { gte: thirtyDaysAgo } }, OR: [{ breachResponse: true }, { breachResolution: true }] } as any });
        const total = await prisma.iTSMRecord.count({ where: { tenantId, customerId: cid, createdAt: { gte: thirtyDaysAgo } } });
        const slaOk = total > 0 ? Math.round(((total - breaches) / total) * 100) : 100;
        return { customerId: cid, companyName: cust?.companyName || '', openTickets: open, breaches, slaCompliance: slaOk };
      })),

      // SLA risk: warning sent but not breached
      prisma.sLATracking.findMany({
        where: { record: { ...baseWhere, status: { in: ['NEW', 'OPEN', 'IN_PROGRESS'] as RecordStatus[] } }, OR: [{ warningResponseSent: true, breachResponse: false }, { warningResolutionSent: true, breachResolution: false }] } as any,
        include: { record: { select: { id: true, recordNumber: true, title: true, priority: true, status: true, customer: { select: { companyName: true } }, assignedAgent: { select: { user: { select: { firstName: true, lastName: true } } } } } } },
        take: 10,
      }),

      // Aging tickets > 5 days
      prisma.iTSMRecord.findMany({
        where: { ...baseWhere, status: { in: openStatuses }, createdAt: { lte: fiveDaysAgo } },
        select: { id: true, recordNumber: true, title: true, priority: true, status: true, createdAt: true, sapModule: { select: { code: true } }, customer: { select: { companyName: true } }, assignedAgent: { select: { user: { select: { firstName: true, lastName: true } } } } },
        orderBy: { createdAt: 'asc' }, take: 10,
      }),

      // Pending > 24h
      prisma.iTSMRecord.findMany({
        where: { ...baseWhere, status: 'PENDING', updatedAt: { lte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
        select: { id: true, recordNumber: true, title: true, priority: true, updatedAt: true, customer: { select: { companyName: true } } },
        orderBy: { updatedAt: 'asc' }, take: 10,
      }),

      // Module heat map
      (prisma.iTSMRecord.groupBy as any)({
        by: ['sapModuleId'],
        where: { ...baseWhere, createdAt: { gte: thirtyDaysAgo }, sapModuleId: { not: null } },
        _count: true,
        orderBy: { _count: { id: 'desc' } },
      }),

      // Agent workload
      prisma.agent.findMany({
        where: { customerAgents: { some: { customerId: { in: customerIds } } }, user: { tenantId, status: 'ACTIVE' }, agentType: 'AGENT' },
        include: {
          user: { select: { firstName: true, lastName: true } },
          _count: { select: { assignments: { where: { status: { in: openStatuses } } } } },
        },
      }),

      // Recent 10
      prisma.iTSMRecord.findMany({
        where: baseWhere,
        select: { id: true, recordNumber: true, title: true, priority: true, status: true, recordType: true, createdAt: true, customer: { select: { companyName: true } }, assignedAgent: { select: { user: { select: { firstName: true, lastName: true } } } } },
        orderBy: { createdAt: 'desc' }, take: 10,
      }),
    ]);

    // Resolve module names for heat map
    const mhArr: any[] = moduleHeat as any[];
    const moduleIds = mhArr.map((m: any) => m.sapModuleId).filter(Boolean);
    const modules = moduleIds.length > 0 ? await prisma.sAPModuleMaster.findMany({ where: { id: { in: moduleIds } }, select: { id: true, code: true, name: true } }) : [];
    const moduleHeatResolved = mhArr.map((m: any) => {
      const mod = modules.find(mm => mm.id === m.sapModuleId);
      return { moduleCode: mod?.code || '?', moduleName: mod?.name || '', count: m._count };
    });

    res.json({ success: true, customers: customerHealth, slaRisk, aging, pending, moduleHeat: moduleHeatResolved, agentWorkload: agentWorkload.map((a: any) => ({ ...a, openTickets: (a._count as any).assignments })), recent });
  } catch (err) { next(err); }
});

// ── Customer Dashboard ────────────────────────────────────────
router.get('/customer', enforceRole('COMPANY_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const customerId = req.user!.customerId;
    if (!customerId) { res.json({ success: true, summary: {}, openByPriority: [], slaStatus: {}, awaitingResponse: [], moduleBreakdown: [], recent: [], contract: null }); return; }

    const openStatuses: RecordStatus[] = ['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING'];
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [openCount, resolvedMonth, avgResolution, openByPriority, slaBreaches, slaTotal, awaitingResponse, moduleBreakdown, recent, contract, monthlyTrend] = await Promise.all([
      prisma.iTSMRecord.count({ where: { tenantId, customerId, status: { in: openStatuses } } }),
      prisma.iTSMRecord.count({ where: { tenantId, customerId, status: { in: ['RESOLVED', 'CLOSED'] as RecordStatus[] }, resolvedAt: { gte: thirtyDaysAgo } } }),
      prisma.$queryRawUnsafe(`SELECT AVG(EXTRACT(EPOCH FROM ("resolved_at" - "created_at"))/3600)::numeric(10,1) as avg_hours FROM itsm_records WHERE tenant_id=$1 AND customer_id=$2 AND resolved_at IS NOT NULL AND created_at >= $3`, tenantId, customerId, thirtyDaysAgo),
      prisma.iTSMRecord.groupBy({ by: ['priority'], where: { tenantId, customerId, status: { in: openStatuses } }, _count: true }),
      prisma.sLATracking.count({ where: { record: { tenantId, customerId, createdAt: { gte: thirtyDaysAgo } }, OR: [{ breachResponse: true }, { breachResolution: true }] } as any }),
      prisma.iTSMRecord.count({ where: { tenantId, customerId, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.iTSMRecord.findMany({
        where: { tenantId, customerId, status: 'PENDING' },
        select: { id: true, recordNumber: true, title: true, priority: true, updatedAt: true },
        orderBy: { updatedAt: 'asc' }, take: 5,
      }),
      (prisma.iTSMRecord.groupBy as any)({ by: ['sapModuleId'], where: { tenantId, customerId, createdAt: { gte: thirtyDaysAgo }, sapModuleId: { not: null } }, _count: true, orderBy: { _count: { id: 'desc' } } }),
      prisma.iTSMRecord.findMany({
        where: { tenantId, customerId },
        select: { id: true, recordNumber: true, title: true, priority: true, status: true, recordType: true, createdAt: true, assignedAgent: { select: { user: { select: { firstName: true, lastName: true } } } } },
        orderBy: { createdAt: 'desc' }, take: 10,
      }),
      prisma.contract.findFirst({
        where: { customerId, endDate: { gte: now } },
        include: { supportTypeMaster: { select: { name: true, code: true } }, slaPolicyMaster: { select: { name: true, code: true, priorities: true } } },
        orderBy: { endDate: 'desc' },
      }),
      // Monthly trend (last 6 months)
      prisma.$queryRawUnsafe(`SELECT to_char(date_trunc('month', created_at), 'Mon') as month, COUNT(*)::int as count FROM itsm_records WHERE tenant_id=$1 AND customer_id=$2 AND created_at >= $3 GROUP BY date_trunc('month', created_at) ORDER BY date_trunc('month', created_at)`, tenantId, customerId, new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)),
    ]);

    // Resolve module names
    const mbArr: any[] = moduleBreakdown as any[];
    const modIds = mbArr.map((m: any) => m.sapModuleId).filter(Boolean);
    const mods = modIds.length > 0 ? await prisma.sAPModuleMaster.findMany({ where: { id: { in: modIds } }, select: { id: true, code: true } }) : [];

    const avgHrs = (avgResolution as any)?.[0]?.avg_hours || 0;
    const slaCompliance = slaTotal > 0 ? Math.round(((slaTotal - slaBreaches) / slaTotal) * 100) : 100;

    res.json({
      success: true,
      summary: { openCount, resolvedMonth, avgResolutionHours: Number(avgHrs), slaCompliance },
      openByPriority: openByPriority.map((p: any) => ({ priority: p.priority, count: p._count })),
      slaStatus: { onTrack: slaTotal - slaBreaches, breached: slaBreaches, total: slaTotal },
      awaitingResponse,
      moduleBreakdown: mbArr.map((m: any) => ({ code: mods.find(mm => mm.id === m.sapModuleId)?.code || '?', count: m._count })),
      recent,
      contract: contract ? { contractNumber: contract.contractNumber, supportType: contract.supportTypeMaster?.name, slaPolicy: contract.slaPolicyMaster?.name, endDate: contract.endDate, slaPriorities: contract.slaPolicyMaster?.priorities } : null,
      monthlyTrend,
    });
  } catch (err) { next(err); }
});

// ── Agent Workload Dashboard ──────────────────────────────────
router.get('/agent', enforceRole('AGENT'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const agent = await prisma.agent.findUnique({ where: { userId: req.user!.sub }, select: { id: true, maxConcurrent: true } });
    if (!agent) { res.json({ success: true, assigned: 0, max: 5, urgent: [], myTickets: [], recentResolved: [] }); return; }

    const openStatuses: RecordStatus[] = ['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING'];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [assigned, urgent, myTickets, recentResolved] = await Promise.all([
      prisma.iTSMRecord.count({ where: { tenantId, assignedAgentId: agent.id, status: { in: openStatuses } } }),
      prisma.iTSMRecord.findMany({
        where: { tenantId, assignedAgentId: agent.id, status: { in: ['NEW', 'OPEN', 'IN_PROGRESS'] as RecordStatus[] }, priority: { in: ['P1', 'P2'] } },
        select: { id: true, recordNumber: true, title: true, priority: true, status: true, createdAt: true, customer: { select: { companyName: true } }, slaTracking: { select: { responseDeadline: true, resolutionDeadline: true, breachResponse: true, breachResolution: true } } },
        orderBy: { priority: 'asc' }, take: 10,
      }),
      prisma.iTSMRecord.findMany({
        where: { tenantId, assignedAgentId: agent.id, status: { in: openStatuses } },
        select: { id: true, recordNumber: true, title: true, priority: true, status: true, createdAt: true, customer: { select: { companyName: true } } },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }], take: 20,
      }),
      prisma.iTSMRecord.findMany({
        where: { tenantId, assignedAgentId: agent.id, status: { in: ['RESOLVED', 'CLOSED'] as RecordStatus[] }, resolvedAt: { gte: sevenDaysAgo } },
        select: { id: true, recordNumber: true, title: true, priority: true, resolvedAt: true },
        orderBy: { resolvedAt: 'desc' }, take: 10,
      }),
    ]);

    res.json({ success: true, assigned, max: agent.maxConcurrent, urgent, myTickets, recentResolved });
  } catch (err) { next(err); }
});

// ── User Dashboard ────────────────────────────────────────────
router.get('/user', enforceRole('USER'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.sub;
    const openStatuses: RecordStatus[] = ['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING'];

    const [openCount, resolvedCount, totalCount, awaitingResponse, myTickets] = await Promise.all([
      prisma.iTSMRecord.count({ where: { tenantId, createdById: userId, status: { in: openStatuses } } }),
      prisma.iTSMRecord.count({ where: { tenantId, createdById: userId, status: { in: ['RESOLVED', 'CLOSED'] as RecordStatus[] } } }),
      prisma.iTSMRecord.count({ where: { tenantId, createdById: userId } }),
      prisma.iTSMRecord.findMany({
        where: { tenantId, createdById: userId, status: 'PENDING' },
        select: { id: true, recordNumber: true, title: true, priority: true, updatedAt: true },
        orderBy: { updatedAt: 'asc' }, take: 5,
      }),
      prisma.iTSMRecord.findMany({
        where: { tenantId, createdById: userId },
        select: { id: true, recordNumber: true, title: true, priority: true, status: true, createdAt: true, assignedAgent: { select: { user: { select: { firstName: true, lastName: true } } } } },
        orderBy: { createdAt: 'desc' }, take: 10,
      }),
    ]);

    res.json({ success: true, summary: { openCount, resolvedCount, totalCount }, awaitingResponse, myTickets });
  } catch (err) { next(err); }
});

export default router;
