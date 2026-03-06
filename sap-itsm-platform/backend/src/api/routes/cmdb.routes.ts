import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { paginate, buildPaginatedResult } from '../../utils/pagination';
import { resolveAgent, resolveManagedCustomerIds } from './scopeHelpers';
import { auditLog, auditFromRequest } from '../../utils/audit';

const router = Router();
router.use(verifyJWT, enforceTenantScope);
router.use(enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_MANAGER'));

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page) || 1, limit = Number(req.query.limit) || 100;
    const { skip, take } = paginate(page, limit);
    const role = req.user!.role, tenantId = req.user!.tenantId, userId = req.user!.sub;

    const where: any = {
      tenantId,
      ...(req.query.ciType && { ciType: req.query.ciType }),
      ...(req.query.status && { status: req.query.status }),
      ...(req.query.customerId && { customerId: req.query.customerId }),
      ...(req.query.search && { name: { contains: req.query.search as string, mode: 'insensitive' } }),
    };

    // COMPANY_ADMIN: only their customer's CIs
    if (role === 'COMPANY_ADMIN' && req.user!.customerId) {
      where.customerId = req.user!.customerId;
    }

    // PROJECT_MANAGER: CIs of managed customers
    if (role === 'PROJECT_MANAGER') {
      const agent = await resolveAgent(userId);
      if (!agent) { res.json({ success: true, ...buildPaginatedResult([], 0, page, limit) }); return; }
      const ids = await resolveManagedCustomerIds(agent.id, tenantId);
      if (ids.length > 0) where.customerId = { in: ids };
    }

    const [items, total] = await Promise.all([
      prisma.configurationItem.findMany({
        where, skip, take,
        include: { customer: { select: { id: true, companyName: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.configurationItem.count({ where }),
    ]);
    res.json({ success: true, ...buildPaginatedResult(items, total, page, limit) });
  } catch (err) { next(err); }
});

router.post('/', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { customerId, ...rest } = req.body;
    const ci = await prisma.configurationItem.create({
      data: { ...rest, tenantId: req.user!.tenantId, customerId: customerId || null },
      include: { customer: { select: { id: true, companyName: true } } },
    });
    await auditLog({ ...auditFromRequest(req), action: 'CREATE', entityType: 'ConfigurationItem', entityId: ci.id, newValues: { name: ci.name, ciType: ci.ciType, customerId } });
    res.status(201).json({ success: true, ci });
  } catch (err) { next(err); }
});

router.patch('/:id', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = ['name', 'ciType', 'environment', 'sid', 'hostname', 'version', 'status', 'customerId', 'metadata'];
    const old = await prisma.configurationItem.findFirst({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k] === '' ? null : req.body[k];
    await prisma.configurationItem.updateMany({ where: { id: req.params.id, tenantId: req.user!.tenantId }, data });
    await auditLog({ ...auditFromRequest(req), action: 'UPDATE', entityType: 'ConfigurationItem', entityId: req.params.id, oldValues: old, newValues: data });
    const updated = await prisma.configurationItem.findUnique({ where: { id: req.params.id }, include: { customer: { select: { id: true, companyName: true } } } });
    res.json({ success: true, ci: updated });
  } catch (err) { next(err); }
});

router.delete('/:id', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const count = await prisma.iTSMRecord.count({ where: { ciId: req.params.id } });
    if (count > 0) {
      await prisma.configurationItem.updateMany({ where: { id: req.params.id, tenantId: req.user!.tenantId }, data: { status: 'DECOMMISSIONED' } });
      await auditLog({ ...auditFromRequest(req), action: 'UPDATE', entityType: 'ConfigurationItem', entityId: req.params.id, newValues: { status: 'DECOMMISSIONED' } });
    } else {
      await prisma.configurationItem.deleteMany({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
      await auditLog({ ...auditFromRequest(req), action: 'DELETE', entityType: 'ConfigurationItem', entityId: req.params.id });
    }
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /cmdb/seed — seed default SAP environments
router.post('/seed', enforceRole('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const defaults = [
      // ECC Systems
      { ciType: 'SYSTEM', name: 'SAP ECC Development', environment: 'DEV', sid: 'ED1', hostname: 'sapecc-dev', version: 'EHP8' },
      { ciType: 'SYSTEM', name: 'SAP ECC Quality', environment: 'QAS', sid: 'EQ1', hostname: 'sapecc-qas', version: 'EHP8' },
      { ciType: 'SYSTEM', name: 'SAP ECC Production', environment: 'PRD', sid: 'EP1', hostname: 'sapecc-prd', version: 'EHP8' },
      // S/4HANA Systems
      { ciType: 'SYSTEM', name: 'SAP S/4HANA Development', environment: 'DEV', sid: 'S4D', hostname: 's4hana-dev', version: 'S/4HANA 2023' },
      { ciType: 'SYSTEM', name: 'SAP S/4HANA Quality', environment: 'QAS', sid: 'S4Q', hostname: 's4hana-qas', version: 'S/4HANA 2023' },
      { ciType: 'SYSTEM', name: 'SAP S/4HANA Production', environment: 'PRD', sid: 'S4P', hostname: 's4hana-prd', version: 'S/4HANA 2023' },
      // BW/BI
      { ciType: 'SYSTEM', name: 'SAP BW/4HANA Development', environment: 'DEV', sid: 'BD1', hostname: 'bw4-dev', version: 'BW/4HANA 2.0' },
      { ciType: 'SYSTEM', name: 'SAP BW/4HANA Production', environment: 'PRD', sid: 'BP1', hostname: 'bw4-prd', version: 'BW/4HANA 2.0' },
      // Solution Manager
      { ciType: 'SYSTEM', name: 'SAP Solution Manager', environment: 'PRD', sid: 'SM1', hostname: 'solman-prd', version: 'SolMan 7.2' },
      // GRC
      { ciType: 'SYSTEM', name: 'SAP GRC', environment: 'PRD', sid: 'GR1', hostname: 'grc-prd', version: 'GRC 12.0' },
      // BTP
      { ciType: 'BTP_INSTANCE', name: 'SAP BTP Dev Subaccount', environment: 'DEV', sid: 'BTP-DEV', hostname: 'btp-dev.cfapps.eu10.hana.ondemand.com' },
      { ciType: 'BTP_INSTANCE', name: 'SAP BTP Production Subaccount', environment: 'PRD', sid: 'BTP-PRD', hostname: 'btp-prd.cfapps.eu10.hana.ondemand.com' },
      // Databases
      { ciType: 'DATABASE', name: 'HANA DB — ECC Production', environment: 'PRD', sid: 'HDB', hostname: 'hana-ecc-prd', version: 'HANA 2.0 SPS07' },
      { ciType: 'DATABASE', name: 'HANA DB — S/4HANA Production', environment: 'PRD', sid: 'HDB', hostname: 'hana-s4-prd', version: 'HANA 2.0 SPS07' },
      // Interfaces
      { ciType: 'INTERFACE', name: 'SAP PI/PO', environment: 'PRD', sid: 'PI1', hostname: 'pipo-prd', version: 'PI 7.5' },
      { ciType: 'INTERFACE', name: 'SAP CPI (Integration Suite)', environment: 'PRD', sid: 'CPI', hostname: 'cpi.it-cpi.cfapps.eu10.hana.ondemand.com' },
      // Fiori
      { ciType: 'SERVER', name: 'SAP Fiori Frontend Server', environment: 'PRD', sid: 'FES', hostname: 'fiori-prd', version: 'SAP UI5 1.120' },
      // SAP Router
      { ciType: 'NETWORK', name: 'SAP Router', environment: 'PRD', hostname: 'saprouter-prd' },
      // Portal
      { ciType: 'APPLICATION', name: 'SAP Enterprise Portal', environment: 'PRD', sid: 'EP1', hostname: 'portal-prd', version: 'EP 7.5' },
      // Sandbox
      { ciType: 'SYSTEM', name: 'SAP Sandbox', environment: 'SBX', sid: 'SBX', hostname: 'sap-sandbox', version: 'S/4HANA 2023' },
    ];

    let count = 0;
    for (const ci of defaults) {
      const existing = await prisma.configurationItem.findFirst({
        where: { tenantId, name: ci.name },
      });
      if (!existing) {
        await prisma.configurationItem.create({
          data: { tenantId, ...ci, status: 'ACTIVE' } as any,
        });
        count++;
      }
    }

    res.json({ success: true, message: `Seeded ${count} SAP configuration items` });
  } catch (err) { next(err); }
});

export default router;
