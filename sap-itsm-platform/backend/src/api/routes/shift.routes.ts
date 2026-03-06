import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { auditLog, auditFromRequest } from '../../utils/audit';

const router = Router();
router.use(verifyJWT, enforceTenantScope);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shifts = await prisma.shift.findMany({
      where: { tenantId: req.user!.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, shifts });
  } catch (err) { next(err); }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shift = await prisma.shift.findFirst({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
    });
    if (!shift) { res.status(404).json({ success: false, error: 'Shift not found' }); return; }
    res.json({ success: true, shift });
  } catch (err) { next(err); }
});

router.post('/', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, startTime, endTime, timezone, breakMinutes, status, metadata } = req.body;
    if (!name || !startTime || !endTime) {
      res.status(400).json({ success: false, error: 'name, startTime, endTime required' });
      return;
    }
    const shift = await prisma.shift.create({
      data: {
        tenantId: req.user!.tenantId,
        name, startTime, endTime,
        timezone:    timezone    || 'UTC',
        breakMinutes: breakMinutes ?? 0,
        status:      status      || 'active',
        metadata:    metadata    || {},
      },
    });
    await auditLog({ ...auditFromRequest(req), action: 'CREATE', entityType: 'Shift', entityId: shift.id, newValues: { name } });
    res.status(201).json({ success: true, shift });
  } catch (err) { next(err); }
});

router.patch('/:id', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = ['name', 'startTime', 'endTime', 'timezone', 'breakMinutes', 'status', 'metadata'];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    await prisma.shift.updateMany({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
      data: data as any,
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.delete('/:id', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const inUse = await prisma.contractShift.count({ where: { shiftId: req.params.id } });
    if (inUse > 0) { res.status(409).json({ success: false, error: `Cannot delete — used by ${inUse} contract(s)` }); return; }
    await prisma.shift.deleteMany({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
