import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { auditLog, auditFromRequest } from '../../utils/audit';

const router = Router();
router.use(verifyJWT, enforceTenantScope);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const types = await prisma.supportTypeMaster.findMany({
      where: { tenantId: req.user!.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, types });
  } catch (err) { next(err); }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const type = await prisma.supportTypeMaster.findFirst({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
    });
    if (!type) { res.status(404).json({ success: false, error: 'Support type not found' }); return; }
    res.json({ success: true, type });
  } catch (err) { next(err); }
});

router.post('/', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      name, code, description, color,
      workDays, weekendCoverage, holidayCoverage, afterHoursCoverage,
      weekendMultiplier, holidayMultiplier, afterHoursMultiplier,
      slaPauseConditions, onCallPriorities,
      priorityScope, slaEnabled, isActive,
    } = req.body;

    const type = await prisma.supportTypeMaster.create({
      data: {
        tenantId: req.user!.tenantId,
        name, code: code.toUpperCase(),
        description, color: color || '#6366f1',
        workDays:           workDays           || [1,2,3,4,5],
        weekendCoverage:    weekendCoverage    || 'NONE',
        holidayCoverage:    holidayCoverage    || 'NONE',
        afterHoursCoverage: afterHoursCoverage || 'NONE',
        weekendMultiplier:  weekendMultiplier  ?? 2.0,
        holidayMultiplier:  holidayMultiplier  ?? 2.0,
        afterHoursMultiplier: afterHoursMultiplier ?? 1.5,
        slaPauseConditions: slaPauseConditions || [],
        onCallPriorities:   onCallPriorities   || [],
        priorityScope:      priorityScope      || 'ALL',
        slaEnabled:         slaEnabled         || { P1: true, P2: true, P3: true, P4: true },
        isActive:           isActive           ?? true,
      },
    });
    await auditLog({ ...auditFromRequest(req), action: 'CREATE', entityType: 'SupportTypeMaster', entityId: type.id, newValues: { name, code } });
    res.status(201).json({ success: true, type });
  } catch (err) { next(err); }
});

router.patch('/:id', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = [
      'name', 'description', 'color', 'workDays',
      'weekendCoverage', 'holidayCoverage', 'afterHoursCoverage', 'weekendMultiplier', 'holidayMultiplier', 'afterHoursMultiplier',
      'slaPauseConditions', 'onCallPriorities', 'priorityScope', 'slaEnabled', 'isActive',
    ];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    await prisma.supportTypeMaster.updateMany({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
      data: data as any,
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.delete('/:id', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const inUse = await prisma.contract.count({ where: { supportTypeMasterId: req.params.id } });
    if (inUse > 0) { res.status(409).json({ success: false, error: `Cannot delete — used by ${inUse} contract(s)` }); return; }
    await prisma.supportTypeMaster.deleteMany({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
