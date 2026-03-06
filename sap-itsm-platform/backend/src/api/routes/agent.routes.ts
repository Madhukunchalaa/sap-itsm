import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { paginate, buildPaginatedResult } from '../../utils/pagination';
import { auditLog, auditFromRequest } from '../../utils/audit';

const router = Router();
router.use(verifyJWT, enforceTenantScope);

// GET /agents?agentType=AGENT|PROJECT_MANAGER
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 100;
    const { skip, take } = paginate(page, limit);
    const tenantId = req.user!.tenantId;
    const isCompanyAdmin = req.user!.role === 'COMPANY_ADMIN';
    let companyCustomerId: string | null = null;
    let companyPMAgentId: string | null = null;
    if (isCompanyAdmin) {
      const customer = await prisma.customer.findFirst({
        where: { adminUserId: req.user!.sub },
        select: { id: true, projectManagerAgentId: true },
      });
      companyCustomerId = customer?.id || null;
      companyPMAgentId = customer?.projectManagerAgentId || null;
    }

    const where: any = {
      user: { tenantId },
      ...(req.query.level  && { level:  req.query.level  as any }),
      ...(req.query.status && { status: req.query.status as any }),
      ...(req.query.agentType && { agentType: req.query.agentType as any }),
      // Filter by customer assignment if customerId is provided
      ...(req.query.customerId && {
        customerAgents: { some: { customerId: req.query.customerId as string } },
      }),
      // COMPANY_ADMIN: scope to agents in their customerAgents OR their assigned PM
      ...(isCompanyAdmin && companyCustomerId && !req.query.customerId && {
        OR: [
          { customerAgents: { some: { customerId: companyCustomerId } } },
          // Also include PM even though they're not in customerAgents
          ...(companyPMAgentId ? [{ id: companyPMAgentId }] : []),
        ],
      }),
    };

    const [agents, total] = await Promise.all([
      prisma.agent.findMany({
        where, skip, take,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, role: true, status: true } },
          _count: { select: { assignments: { where: { status: { in: ['NEW', 'OPEN', 'IN_PROGRESS'] } } } } },
          specializations: { include: { sapModule: { select: { id: true, code: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.agent.count({ where }),
    ]);

    res.json({ success: true, ...buildPaginatedResult(agents, total, page, limit) });
  } catch (err) { next(err); }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const agent = await prisma.agent.findFirst({
      where: { id: req.params.id, user: { tenantId: req.user!.tenantId } },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        _count: { select: { assignments: true, timeEntries: true } },
        specializations: { include: { sapModule: { select: { id: true, code: true, name: true, subModules: { select: { id: true, code: true, name: true }, where: { isActive: true } } } } } },
      },
    });
    if (!agent) { res.status(404).json({ success: false, error: 'Agent not found' }); return; }
    res.json({ success: true, agent });
  } catch (err) { next(err); }
});

router.post('/', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const agentType = req.body.agentType || 'AGENT';
    const agent = await prisma.agent.create({
      data: {
        userId: req.body.userId,
        specialization: req.body.specialization,
        level: req.body.level || 'L1',
        timezone: req.body.timezone || 'UTC',
        maxConcurrent: req.body.maxConcurrent || 5,
        agentType,
        status: req.body.status || 'AVAILABLE',
        metadata: req.body.metadata || {},
      },
    });
    await auditLog({ ...auditFromRequest(req), action: 'CREATE', entityType: 'Agent', entityId: agent.id });
    res.status(201).json({ success: true, agent });
  } catch (err) { next(err); }
});

// POST /agents/link-user — fix an existing user who was created with wrong role
// Corrects their role to AGENT or PROJECT_MANAGER and creates the agent record
router.post('/link-user', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, agentType, specialization, level, timezone, status, metadata } = req.body;
    if (!email) { res.status(400).json({ success: false, error: 'Email is required' }); return; }

    const existingUser = await prisma.user.findFirst({
      where: { email: email.toLowerCase().trim(), tenantId: req.user!.tenantId },
      include: { agent: true },
    });
    if (!existingUser) {
      res.status(404).json({ success: false, error: `No user found with email ${email}` });
      return;
    }
    const correctRole = agentType === 'PROJECT_MANAGER' ? 'PROJECT_MANAGER' : 'AGENT';

    let agent: any;
    if (existingUser.agent) {
      // Agent record already exists — just fix the user role and update agentType
      [, agent] = await prisma.$transaction([
        prisma.user.update({
          where: { id: existingUser.id },
          data: { role: correctRole as any },
        }),
        prisma.agent.update({
          where: { id: existingUser.agent.id },
          data: {
            agentType: agentType || existingUser.agent.agentType,
            ...(specialization && { specialization }),
            ...(level    && { level }),
            ...(timezone && { timezone }),
            ...(status   && { status }),
            ...(metadata && { metadata }),
          },
        }),
      ]);
    } else {
    [, agent] = await prisma.$transaction([
      prisma.user.update({
        where: { id: existingUser.id },
        data: { role: correctRole as any },
      }),
      prisma.agent.create({
        data: {
          userId:         existingUser.id,
          agentType:      agentType || 'AGENT',
          specialization: specialization || 'General',
          level:          level    || 'L1',
          timezone:       timezone || 'IST',
          maxConcurrent:  5,
          status:         status   || 'AVAILABLE',
          metadata:       metadata || {},
        },
      }),
    ]);
    }

    await auditLog({ ...auditFromRequest(req), action: 'UPDATE', entityType: 'Agent', entityId: agent.id,
      newValues: { linkedUserId: existingUser.id, fixedRole: correctRole } });

    res.status(201).json({
      success: true, agent,
      fixedRole: correctRole,
      userName: existingUser.firstName + ' ' + existingUser.lastName,
    });
  } catch (err) { next(err); }
});

router.patch('/:id', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = ['specialization', 'level', 'timezone', 'maxConcurrent', 'status', 'agentType', 'metadata'];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];

    const agent = await prisma.agent.updateMany({
      where: { id: req.params.id, user: { tenantId: req.user!.tenantId } },
      data,
    });
    res.json({ success: true, updated: agent.count });
  } catch (err) { next(err); }
});

// DELETE /agents/:id — removes agent record AND the linked user account
router.delete('/:id', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const agent = await prisma.agent.findFirst({
      where: { id: req.params.id, user: { tenantId: req.user!.tenantId } },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    if (!agent) { res.status(404).json({ success: false, error: 'Agent not found' }); return; }

    // Delete agent record first (FK), then the user account
    await prisma.$transaction([
      prisma.agent.delete({ where: { id: agent.id } }),
      prisma.user.delete({ where: { id: agent.userId } }),
    ]);

    await auditLog({
      ...auditFromRequest(req),
      action: 'DELETE',
      entityType: 'Agent',
      entityId: agent.id,
      newValues: { deletedUser: agent.user?.email },
    });

    res.json({ success: true, message: `${agent.user?.firstName} ${agent.user?.lastName} removed` });
  } catch (err) { next(err); }
});

// PUT /agents/:id/specializations — replace all specializations
router.put('/:id/specializations', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const agentId = req.params.id;
    const specs: Array<{ sapModuleId: string; sapSubModuleIds: string[] }> = req.body.specializations || [];

    // Delete existing
    await prisma.agentSpecialization.deleteMany({ where: { agentId } });

    // Create new
    if (specs.length > 0) {
      await prisma.agentSpecialization.createMany({
        data: specs.map(s => ({ agentId, sapModuleId: s.sapModuleId, sapSubModuleIds: s.sapSubModuleIds || [] })),
      });
    }

    const updated = await prisma.agentSpecialization.findMany({
      where: { agentId },
      include: { sapModule: { select: { id: true, code: true, name: true } } },
    });

    await auditLog({ ...auditFromRequest(req), action: 'UPDATE', entityType: 'Agent', entityId: agentId, newValues: { specializations: specs.map(s => s.sapModuleId) } });
    res.json({ success: true, specializations: updated });
  } catch (err) { next(err); }
});

export default router;
