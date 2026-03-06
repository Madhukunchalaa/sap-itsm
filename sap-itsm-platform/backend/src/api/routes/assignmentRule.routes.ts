import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyJWT, enforceTenantScope, enforceRole } from '../middleware/auth.middleware';
import { findMatchingRule, scoreAgents, roundRobinAgent } from '../../services/assignment.service';

const prisma = new PrismaClient();
const router = Router();
router.use(verifyJWT, enforceTenantScope);
router.use(enforceRole('SUPER_ADMIN', 'PROJECT_MANAGER'));

// Helper: PM can only manage rules for their managed customers
async function getPMScope(req: Request): Promise<string[] | null> {
  if (req.user!.role === 'SUPER_ADMIN') return null; // no restriction
  const agent = await prisma.agent.findUnique({ where: { userId: req.user!.sub }, select: { id: true } });
  if (!agent) return [];
  const managed = await prisma.customer.findMany({
    where: { projectManagerAgentId: agent.id, tenant: { id: req.user!.tenantId } },
    select: { id: true },
  });
  return managed.map(c => c.id);
}

// GET /assignment-rules — list rules
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pmScope = await getPMScope(req);
    const where: any = { tenantId: req.user!.tenantId };
    if (pmScope) where.customerId = { in: pmScope };
    if (req.query.customerId) where.customerId = req.query.customerId;

    const rules = await prisma.assignmentRule.findMany({
      where,
      include: {
        customer: { select: { id: true, companyName: true } },
        sapModule: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ customerId: 'asc' }, { sortOrder: 'asc' }],
    });
    res.json({ success: true, rules });
  } catch (err) { next(err); }
});

// POST /assignment-rules — create rule
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { customerId, name, recordType, priority, sapModuleId, assignmentMode, preferredLevel, sortOrder } = req.body;
    if (!customerId || !name || !assignmentMode) {
      res.status(400).json({ success: false, error: 'Customer, name, and assignment mode are required' });
      return;
    }

    // PM scope check
    const pmScope = await getPMScope(req);
    if (pmScope && !pmScope.includes(customerId)) {
      res.status(403).json({ success: false, error: 'You can only create rules for your managed customers' });
      return;
    }

    const rule = await prisma.assignmentRule.create({
      data: {
        tenantId: req.user!.tenantId,
        customerId,
        name,
        recordType: recordType || null,
        priority: priority || null,
        sapModuleId: sapModuleId || null,
        assignmentMode,
        preferredLevel: preferredLevel || null,
        sortOrder: sortOrder || 0,
        isActive: true,
      },
      include: {
        customer: { select: { id: true, companyName: true } },
        sapModule: { select: { id: true, code: true, name: true } },
      },
    });
    res.status(201).json({ success: true, rule });
  } catch (err) { next(err); }
});

// PATCH /assignment-rules/:id
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.assignmentRule.findFirst({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
    });
    if (!existing) { res.status(404).json({ success: false, error: 'Rule not found' }); return; }

    const pmScope = await getPMScope(req);
    if (pmScope && !pmScope.includes(existing.customerId)) {
      res.status(403).json({ success: false, error: 'Not authorized' });
      return;
    }

    const allowed = ['name', 'recordType', 'priority', 'sapModuleId', 'assignmentMode', 'preferredLevel', 'sortOrder', 'isActive'];
    const data: any = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        data[k] = (typeof req.body[k] === 'string' && req.body[k] === '') ? null : req.body[k];
      }
    }

    await prisma.assignmentRule.update({ where: { id: req.params.id }, data });
    const updated = await prisma.assignmentRule.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { select: { id: true, companyName: true } },
        sapModule: { select: { id: true, code: true, name: true } },
      },
    });
    res.json({ success: true, rule: updated });
  } catch (err) { next(err); }
});

// DELETE /assignment-rules/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.assignmentRule.findFirst({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
    });
    if (!existing) { res.status(404).json({ success: false, error: 'Rule not found' }); return; }

    const pmScope = await getPMScope(req);
    if (pmScope && !pmScope.includes(existing.customerId)) {
      res.status(403).json({ success: false, error: 'Not authorized' });
      return;
    }

    await prisma.assignmentRule.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /assignment-rules/recommend — get agent recommendations for a ticket
router.post('/recommend', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { customerId, recordType, priority, sapModuleId, sapSubModuleId } = req.body;
    if (!customerId || !priority) {
      res.status(400).json({ success: false, error: 'Customer and priority are required' });
      return;
    }

    // Find matching rule
    const rule = await findMatchingRule({
      tenantId: req.user!.tenantId,
      customerId, recordType, priority, sapModuleId,
    });

    // Score agents
    const scores = await scoreAgents({
      tenantId: req.user!.tenantId,
      customerId, priority, sapModuleId, sapSubModuleId,
      preferredLevel: rule?.preferredLevel,
    });

    res.json({
      success: true,
      rule: rule ? { id: rule.id, name: rule.name, assignmentMode: rule.assignmentMode } : null,
      assignmentMode: rule?.assignmentMode || 'RECOMMEND',
      recommendations: scores.slice(0, 5), // top 5
      allAgents: scores,
    });
  } catch (err) { next(err); }
});

export default router;
