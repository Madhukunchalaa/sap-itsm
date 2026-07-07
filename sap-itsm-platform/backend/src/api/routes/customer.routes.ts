import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { paginate, buildPaginatedResult } from '../../utils/pagination';
import { auditLog, auditFromRequest } from '../../utils/audit';
import { resolveAgent, resolveManagedCustomerIds } from './scopeHelpers';

const router = Router();
router.use(verifyJWT, enforceTenantScope);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page) || 1, limit = Number(req.query.limit) || 20;
    const { skip, take } = paginate(page, limit);
    const tenantId = req.user!.tenantId, role = req.user!.role, userId = req.user!.sub;
    const customerId = req.user!.customerId;

    let scopeFilter: any = {};
    if (role === 'COMPANY_ADMIN') {
      if (!customerId) { res.json({ success: true, ...buildPaginatedResult([], 0, page, limit) }); return; }
      scopeFilter = { id: customerId };
    } else if (role === 'PROJECT_MANAGER') {
      const agent = await resolveAgent(userId);
      if (!agent) { res.json({ success: true, ...buildPaginatedResult([], 0, page, limit) }); return; }
      const ids = await resolveManagedCustomerIds(agent.id, tenantId);
      if (ids.length === 0) { res.json({ success: true, ...buildPaginatedResult([], 0, page, limit) }); return; }
      scopeFilter = { id: { in: ids } };
    }

    const where: any = {
      tenantId, ...scopeFilter,
      ...(req.query.status && { status: req.query.status }),
      ...(req.query.search && {
        OR: [
          { companyName: { contains: req.query.search as string, mode: 'insensitive' } },
          { country: { contains: req.query.search as string, mode: 'insensitive' } },
        ],
      }),
    };

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where, skip, take,
        include: {
          _count: { select: { contracts: true, records: true } },
          adminUser: { select: { id: true, firstName: true, lastName: true, email: true } },
          projectManagers: { include: { agent: { include: { user: { select: { firstName: true, lastName: true } } } } } },
          customerAgents: { include: { agent: { include: { user: { select: { id: true, firstName: true, lastName: true } } } } } },
          contracts: { select: { id: true, contractNumber: true, endDate: true }, orderBy: { endDate: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.customer.count({ where }),
    ]);

    res.json({ success: true, ...buildPaginatedResult(customers, total, page, limit) });
  } catch (err) { next(err); }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = req.user!.role, userId = req.user!.sub, tenantId = req.user!.tenantId;
    const customerId = req.user!.customerId;

    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, tenantId },
      include: {
        contracts: true,
        adminUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        projectManagers: { include: { agent: { include: { user: { select: { firstName: true, lastName: true, email: true } } } } } },
        customerAgents: { include: { agent: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } } } },
        users: { select: { id: true, firstName: true, lastName: true, email: true, role: true, status: true } },
        _count: { select: { records: true } },
      },
    });
    if (!customer) { res.status(404).json({ success: false, error: 'Customer not found' }); return; }

    if (role === 'COMPANY_ADMIN' && customer.id !== customerId) {
      res.status(403).json({ success: false, error: 'Access denied' }); return;
    }
    if (role === 'PROJECT_MANAGER') {
      const agent = await resolveAgent(userId);
      if (!agent) { res.status(403).json({ success: false, error: 'Access denied' }); return; }
      const ids = await resolveManagedCustomerIds(agent.id, tenantId);
      if (!ids.includes(customer.id)) { res.status(403).json({ success: false, error: 'Access denied' }); return; }
    }

    res.json({ success: true, customer });
  } catch (err) { next(err); }
});

router.post('/', enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_MANAGER'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { companyName, industry, country, timezone, status, website, contactName, contactEmail, contactPhone, billingEmail, billingAddress, notes, allowedDomains, adminUserId, projectManagerAgentIds, holidayCalendarId, agentIds } = req.body;
    const customer = await prisma.customer.create({
      data: {
        tenantId: req.user!.tenantId, companyName, industry, country,
        timezone: timezone || 'UTC', status: status || 'ACTIVE',
        website, contactName, contactEmail, contactPhone, billingEmail, billingAddress, notes,
        allowedDomains: allowedDomains || [],
        adminUserId: adminUserId || undefined,
        holidayCalendarId: holidayCalendarId || undefined,
        projectManagers: projectManagerAgentIds && projectManagerAgentIds.length > 0 ? {
          create: projectManagerAgentIds.map((id: string) => ({
            agent: { connect: { id } }
          }))
        } : undefined,
        customerAgents: agentIds?.length ? { create: agentIds.map((id: string) => ({ agentId: id })) } : undefined,
      } as any,
    });
    if (adminUserId) {
      await prisma.user.updateMany({ where: { id: adminUserId, tenantId: req.user!.tenantId }, data: { customerId: customer.id } });
    }
    await auditLog({ ...auditFromRequest(req), action: 'CREATE', entityType: 'Customer', entityId: customer.id, newValues: { companyName } });
    res.status(201).json({ success: true, customer });
  } catch (err) { next(err); }
});

router.patch('/:id', enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_MANAGER'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // PROJECT_MANAGER: verify this is one of their managed customers
    if (req.user!.role === 'PROJECT_MANAGER') {
      const agent = await resolveAgent(req.user!.sub);
      if (!agent) { res.status(403).json({ success: false, error: 'Access denied' }); return; }
      const ids = await resolveManagedCustomerIds(agent.id, req.user!.tenantId);
      if (!ids.includes(req.params.id)) { res.status(403).json({ success: false, error: 'Access denied' }); return; }
    }
    const allowed = ['companyName', 'industry', 'country', 'timezone', 'status', 'website', 'contactName', 'contactEmail', 'contactPhone', 'billingEmail', 'billingAddress', 'notes', 'allowedDomains', 'adminUserId', 'projectManagerAgentIds', 'holidayCalendarId'];
    const data: any = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    
    // We only need to check permissions, so we select id
    const oldCustomer = await prisma.customer.findFirst({ where: { id: req.params.id, tenantId: req.user!.tenantId }, select: { id: true, companyName: true, status: true, adminUserId: true } });
    if (!oldCustomer) return res.status(404).json({ error: 'Customer not found' });
    
    // If agentIds is provided, update CustomerAgent relationships
    if (req.body.agentIds !== undefined) {
      const newIds = req.body.agentIds;
      await prisma.customerAgent.deleteMany({ where: { customerId: req.params.id } });
      if (newIds.length > 0) {
        await prisma.customerAgent.createMany({
          data: newIds.map((id: string) => ({ customerId: req.params.id, agentId: id })),
        });
      }
    }

    // If projectManagerAgentIds is provided, update CustomerProjectManager relationships
    if (data.projectManagerAgentIds !== undefined) {
      const pmIds = data.projectManagerAgentIds;
      await prisma.customerProjectManager.deleteMany({ where: { customerId: req.params.id } });
      if (pmIds && pmIds.length > 0) {
        await prisma.customerProjectManager.createMany({
          data: pmIds.map((id: string) => ({ customerId: req.params.id, agentId: id })),
        });
      }
      delete data.projectManagerAgentIds; // Remove it so it doesn't get updated as scalar
    }

    if (Object.keys(data).length > 0) {
      await prisma.customer.updateMany({ where: { id: req.params.id, tenantId: req.user!.tenantId }, data: data as any });
    }
    await auditLog({ ...auditFromRequest(req), action: 'UPDATE', entityType: 'Customer', entityId: req.params.id, oldValues: oldCustomer, newValues: data });

    if (req.body.adminUserId) {
      await prisma.user.updateMany({ where: { id: req.body.adminUserId, tenantId: req.user!.tenantId }, data: { customerId: req.params.id } });
    }
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
