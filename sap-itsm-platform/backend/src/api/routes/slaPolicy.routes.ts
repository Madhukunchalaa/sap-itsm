import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { auditLog, auditFromRequest } from '../../utils/audit';

const router = Router();
router.use(verifyJWT, enforceTenantScope);

// GET /sla-policies
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const policies = await prisma.sLAPolicyMaster.findMany({
      where: { tenantId: req.user!.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, policies });
  } catch (err) { next(err); }
});

// GET /sla-policies/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const policy = await prisma.sLAPolicyMaster.findFirst({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
    });
    if (!policy) { res.status(404).json({ success: false, error: 'Policy not found' }); return; }
    res.json({ success: true, policy });
  } catch (err) { next(err); }
});

// POST /sla-policies (SUPER_ADMIN only)
router.post('/', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, code, description, color, warningThreshold, priorities, isActive } = req.body;
    const policy = await prisma.sLAPolicyMaster.create({
      data: {
        tenantId: req.user!.tenantId,
        name, code: code.toUpperCase(),
        description, color: color || '#6366f1',
        warningThreshold: warningThreshold ?? 0.80,
        priorities: priorities || {},
        isActive: isActive ?? true,
      },
    });
    await auditLog({ ...auditFromRequest(req), action: 'CREATE', entityType: 'SLAPolicyMaster', entityId: policy.id, newValues: { name, code } });
    res.status(201).json({ success: true, policy });
  } catch (err) { next(err); }
});

// PATCH /sla-policies/:id
router.patch('/:id', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = ['name', 'description', 'color', 'warningThreshold', 'priorities', 'isActive'];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    const policy = await prisma.sLAPolicyMaster.updateMany({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
      data,
    });
    res.json({ success: true, updated: policy.count });
  } catch (err) { next(err); }
});

// DELETE /sla-policies/:id
router.delete('/:id', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const inUse = await prisma.contract.count({ where: { slaPolicyMasterId: req.params.id } });
    if (inUse > 0) { res.status(409).json({ success: false, error: `Cannot delete — used by ${inUse} contract(s)` }); return; }
    await prisma.sLAPolicyMaster.deleteMany({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
