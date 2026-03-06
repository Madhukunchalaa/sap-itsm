import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { auditLog, auditFromRequest } from '../../utils/audit';
import { resolveAgent, resolveManagedCustomerIds } from './scopeHelpers';

const router = Router();
router.use(verifyJWT, enforceTenantScope);
// AGENT and USER blocked
router.use(enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_MANAGER'));

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = req.user!.role, tenantId = req.user!.tenantId, userId = req.user!.sub;
    const customerId = req.user!.customerId;

    let where: any;
    if (role === 'COMPANY_ADMIN') {
      if (!customerId) { res.json({ success: true, contracts: [] }); return; }
      where = { customer: { tenantId, id: customerId } };
    } else if (role === 'PROJECT_MANAGER') {
      const agent = await resolveAgent(userId);
      if (!agent) { res.json({ success: true, contracts: [] }); return; }
      const ids = await resolveManagedCustomerIds(agent.id, tenantId);
      if (ids.length === 0) { res.json({ success: true, contracts: [] }); return; }
      where = { customer: { tenantId, id: { in: ids } } };
    } else {
      where = { customer: { tenantId } };
    }

    const contracts = await prisma.contract.findMany({
      where,
      include: {
        customer: { select: { id: true, companyName: true } },
        supportTypeMaster: { select: { id: true, name: true, code: true, color: true } },
        slaPolicyMaster: { select: { id: true, name: true, code: true, color: true } },
        shifts: { include: { shift: true } },
        holidayCalendars: { include: { holidayCalendar: { select: { id: true, name: true, country: true, year: true } } } },
        _count: { select: { records: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, contracts });
  } catch (err) { next(err); }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = req.user!.role, tenantId = req.user!.tenantId, userId = req.user!.sub;
    const customerId = req.user!.customerId;

    const contract = await prisma.contract.findFirst({
      where: { id: req.params.id, customer: { tenantId } },
      include: {
        customer: { select: { id: true, companyName: true, timezone: true } },
        supportTypeMaster: true, slaPolicyMaster: true,
        shifts: { include: { shift: true } },
        holidayCalendars: { include: { holidayCalendar: { include: { dates: true } } } },
      },
    });
    if (!contract) { res.status(404).json({ success: false, error: 'Contract not found' }); return; }

    if (role === 'COMPANY_ADMIN' && customerId && contract.customerId !== customerId) {
      res.status(403).json({ success: false, error: 'Access denied' }); return;
    } else if (role === 'PROJECT_MANAGER') {
      const agent = await resolveAgent(userId);
      if (!agent) { res.status(403).json({ success: false, error: 'Access denied' }); return; }
      const ids = await resolveManagedCustomerIds(agent.id, tenantId);
      if (!ids.includes(contract.customerId)) { res.status(403).json({ success: false, error: 'Access denied' }); return; }
    }

    res.json({ success: true, contract });
  } catch (err) { next(err); }
});

router.post('/', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { customerId, contractNumber, supportTypeMasterId, slaPolicyMasterId, startDate, endDate, autoRenewal, renewalNoticeDays, billingAmount, currency, billingFrequency, paymentTerms, notes, shiftIds, holidayCalendarIds } = req.body;
    if (!customerId || !contractNumber || !startDate || !endDate) {
      res.status(400).json({ success: false, error: 'customerId, contractNumber, startDate, endDate required' }); return;
    }
    const contract = await prisma.contract.create({
      data: {
        customerId, contractNumber,
        supportTypeMasterId: supportTypeMasterId || undefined, slaPolicyMasterId: slaPolicyMasterId || undefined,
        startDate: new Date(startDate), endDate: new Date(endDate),
        autoRenewal: autoRenewal ?? false, renewalNoticeDays: renewalNoticeDays ?? 60,
        billingAmount: parseFloat(billingAmount) || 0, currency: currency || 'USD',
        billingFrequency: billingFrequency || 'Monthly', paymentTerms: paymentTerms || 'Net 30',
        notes: notes || undefined,
        shifts: shiftIds?.length ? { create: shiftIds.map((id: string) => ({ shiftId: id })) } : undefined,
        holidayCalendars: holidayCalendarIds?.length ? { create: holidayCalendarIds.map((id: string) => ({ holidayCalendarId: id })) } : undefined,
      },
    });
    await auditLog({ ...auditFromRequest(req), action: 'CREATE', entityType: 'Contract', entityId: contract.id, newValues: { contractNumber } });
    res.status(201).json({ success: true, contract });
  } catch (err) { next(err); }
});

router.patch('/:id', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const old = await prisma.contract.findFirst({
      where: { id: req.params.id, customer: { tenantId: req.user!.tenantId } },
      include: { shifts: true },
    });
    if (!old) { res.status(404).json({ success: false, error: 'Contract not found' }); return; }

    const allowed = ['supportTypeMasterId', 'slaPolicyMasterId', 'startDate', 'endDate', 'autoRenewal', 'renewalNoticeDays', 'billingAmount', 'currency', 'billingFrequency', 'paymentTerms', 'notes'];
    const data: Record<string, unknown> = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        if (['startDate', 'endDate'].includes(k)) data[k] = new Date(req.body[k]);
        else if (['billingAmount', 'renewalNoticeDays'].includes(k)) data[k] = Number(req.body[k]);
        else if (k === 'autoRenewal') data[k] = Boolean(req.body[k]);
        else data[k] = req.body[k] || null;
      }
    }

    await prisma.contract.updateMany({ where: { id: req.params.id, customer: { tenantId: req.user!.tenantId } }, data });

    // Update shifts if provided
    if (req.body.shiftIds !== undefined) {
      await prisma.contractShift.deleteMany({ where: { contractId: req.params.id } });
      if (req.body.shiftIds.length > 0) {
        await prisma.contractShift.createMany({
          data: req.body.shiftIds.map((shiftId: string) => ({ contractId: req.params.id, shiftId })),
          skipDuplicates: true,
        });
      }
    }

    await auditLog({ ...auditFromRequest(req), action: 'UPDATE', entityType: 'Contract', entityId: req.params.id, oldValues: { supportTypeMasterId: old.supportTypeMasterId, slaPolicyMasterId: old.slaPolicyMasterId, startDate: old.startDate, endDate: old.endDate, billingAmount: old.billingAmount, notes: old.notes }, newValues: data });

    const updated = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { select: { id: true, companyName: true } },
        supportTypeMaster: true,
        slaPolicyMaster: true,
        shifts: { include: { shift: true } },
        holidayCalendars: { include: { holidayCalendar: true } },
      },
    });
    res.json({ success: true, contract: updated });
  } catch (err) { next(err); }
});

// GET /contracts/:id/changelog — audit trail for a contract
router.get('/:id/changelog', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'Contract', entityId: req.params.id, tenantId: req.user!.tenantId },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, logs });
  } catch (err) { next(err); }
});

export default router;
