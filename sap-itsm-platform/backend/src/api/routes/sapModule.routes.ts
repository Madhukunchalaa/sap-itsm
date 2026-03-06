import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyJWT, enforceTenantScope, enforceRole } from '../middleware/auth.middleware';

const prisma = new PrismaClient();
const router = Router();
router.use(verifyJWT, enforceTenantScope);

// ══════════════════════════════════════════════════════════════
// SAP MODULES
// ══════════════════════════════════════════════════════════════

// GET /sap-modules — list all modules (any authenticated user)
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const modules = await prisma.sAPModuleMaster.findMany({
      where: { tenantId: req.user!.tenantId },
      include: { subModules: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: modules });
  } catch (err) { next(err); }
});

// GET /sap-modules/active — only active modules with active submodules (for ticket forms)
router.get('/active', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const modules = await prisma.sAPModuleMaster.findMany({
      where: { tenantId: req.user!.tenantId, isActive: true },
      include: { subModules: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: modules });
  } catch (err) { next(err); }
});

// POST /sap-modules — create module (SUPER_ADMIN only)
// PATCH /sap-modules/sub-modules/:id — MUST be before /:id routes
router.patch('/sub-modules/:id',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, description, sortOrder, isActive } = req.body;
      const data: any = {};
      if (name !== undefined) data.name = name;
      if (description !== undefined) data.description = description;
      if (sortOrder !== undefined) data.sortOrder = sortOrder;
      if (isActive !== undefined) data.isActive = isActive;

      const sub = await prisma.sAPSubModuleMaster.updateMany({
        where: { id: req.params.id, tenantId: req.user!.tenantId },
        data,
      });
      if (sub.count === 0) {
        res.status(404).json({ success: false, error: 'Sub-module not found' });
        return;
      }
      const updated = await prisma.sAPSubModuleMaster.findUnique({ where: { id: req.params.id } });
      res.json({ success: true, data: updated });
    } catch (err) { next(err); }
  }
);

// DELETE /sap-modules/sub-modules/:id — MUST be before /:id routes
router.delete('/sub-modules/:id',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const count = await prisma.iTSMRecord.count({ where: { sapSubModuleId: req.params.id } });
      if (count > 0) {
        res.status(400).json({ success: false, error: `Cannot delete: ${count} tickets use this sub-module. Deactivate it instead.` });
        return;
      }
      await prisma.sAPSubModuleMaster.deleteMany({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
      res.json({ success: true });
    } catch (err) { next(err); }
  }
);

router.post('/',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code, name, description, sortOrder } = req.body;
      if (!code || !name) {
        res.status(400).json({ success: false, error: 'Code and name are required' });
        return;
      }
      const module = await prisma.sAPModuleMaster.create({
        data: {
          tenantId: req.user!.tenantId,
          code: code.toUpperCase(),
          name, description: description || null,
          sortOrder: sortOrder || 0,
        },
        include: { subModules: true },
      });
      res.status(201).json({ success: true, data: module });
    } catch (err: any) {
      if (err.code === 'P2002') {
        res.status(409).json({ success: false, error: `Module code "${req.body.code}" already exists` });
        return;
      }
      next(err);
    }
  }
);

// PATCH /sap-modules/:id — update module
router.patch('/:id',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, description, sortOrder, isActive } = req.body;
      const data: any = {};
      if (name !== undefined) data.name = name;
      if (description !== undefined) data.description = description;
      if (sortOrder !== undefined) data.sortOrder = sortOrder;
      if (isActive !== undefined) data.isActive = isActive;

      const module = await prisma.sAPModuleMaster.updateMany({
        where: { id: req.params.id, tenantId: req.user!.tenantId },
        data,
      });
      if (module.count === 0) {
        res.status(404).json({ success: false, error: 'Module not found' });
        return;
      }
      const updated = await prisma.sAPModuleMaster.findUnique({
        where: { id: req.params.id },
        include: { subModules: { orderBy: { sortOrder: 'asc' } } },
      });
      res.json({ success: true, data: updated });
    } catch (err) { next(err); }
  }
);

// DELETE /sap-modules/:id
router.delete('/:id',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check if any records use this module
      const count = await prisma.iTSMRecord.count({ where: { sapModuleId: req.params.id } });
      if (count > 0) {
        res.status(400).json({ success: false, error: `Cannot delete: ${count} tickets use this module. Deactivate it instead.` });
        return;
      }
      await prisma.sAPSubModuleMaster.deleteMany({ where: { moduleId: req.params.id, tenantId: req.user!.tenantId } });
      await prisma.sAPModuleMaster.deleteMany({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
      res.json({ success: true });
    } catch (err) { next(err); }
  }
);

// ══════════════════════════════════════════════════════════════
// SAP SUB-MODULES
// ══════════════════════════════════════════════════════════════

// POST /sap-modules/:moduleId/sub-modules
router.post('/:moduleId/sub-modules',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code, name, description, sortOrder } = req.body;
      if (!code || !name) {
        res.status(400).json({ success: false, error: 'Code and name are required' });
        return;
      }
      const sub = await prisma.sAPSubModuleMaster.create({
        data: {
          tenantId: req.user!.tenantId,
          moduleId: req.params.moduleId,
          code: code.toUpperCase(),
          name, description: description || null,
          sortOrder: sortOrder || 0,
        },
      });
      res.status(201).json({ success: true, data: sub });
    } catch (err: any) {
      if (err.code === 'P2002') {
        res.status(409).json({ success: false, error: `Sub-module code "${req.body.code}" already exists for this module` });
        return;
      }
      next(err);
    }
  }
);

// ── Seed default SAP modules ─────────────────────────────────
router.post('/seed',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user!.tenantId;
      const defaults = [
        { code: 'MM', name: 'Materials Management', subs: [
          { code: 'INV', name: 'Inventory Management' },
          { code: 'PROC', name: 'Procurement' },
          { code: 'PO', name: 'Purchase Orders' },
          { code: 'PR', name: 'Purchase Requisitions' },
          { code: 'VM', name: 'Vendor Management' },
          { code: 'IM', name: 'Invoice Management' },
        ]},
        { code: 'FI', name: 'Financial Accounting', subs: [
          { code: 'GL', name: 'General Ledger' },
          { code: 'AR', name: 'Accounts Receivable' },
          { code: 'AP', name: 'Accounts Payable' },
          { code: 'AA', name: 'Asset Accounting' },
          { code: 'BL', name: 'Bank Ledger' },
        ]},
        { code: 'CO', name: 'Controlling', subs: [
          { code: 'CCA', name: 'Cost Center Accounting' },
          { code: 'PC', name: 'Product Costing' },
          { code: 'PA', name: 'Profitability Analysis' },
          { code: 'IO', name: 'Internal Orders' },
        ]},
        { code: 'SD', name: 'Sales & Distribution', subs: [
          { code: 'SO', name: 'Sales Orders' },
          { code: 'DL', name: 'Delivery' },
          { code: 'BIL', name: 'Billing' },
          { code: 'PR', name: 'Pricing' },
          { code: 'CRM', name: 'Customer Master' },
        ]},
        { code: 'PP', name: 'Production Planning', subs: [
          { code: 'MRP', name: 'Material Requirements Planning' },
          { code: 'SFC', name: 'Shop Floor Control' },
          { code: 'BOM', name: 'Bill of Materials' },
          { code: 'RTG', name: 'Routing' },
          { code: 'DM', name: 'Demand Management' },
        ]},
        { code: 'PM', name: 'Plant Maintenance', subs: [
          { code: 'PM-WO', name: 'Work Orders' },
          { code: 'PM-EQ', name: 'Equipment Management' },
          { code: 'PM-CB', name: 'Calibration' },
          { code: 'PM-SM', name: 'Service Management' },
        ]},
        { code: 'QM', name: 'Quality Management', subs: [
          { code: 'QI', name: 'Quality Inspection' },
          { code: 'QN', name: 'Quality Notifications' },
          { code: 'QC', name: 'Quality Certificates' },
        ]},
        { code: 'HR', name: 'Human Resources (HCM)', subs: [
          { code: 'PA', name: 'Personnel Administration' },
          { code: 'PY', name: 'Payroll' },
          { code: 'TM', name: 'Time Management' },
          { code: 'OM', name: 'Organizational Management' },
        ]},
        { code: 'WM', name: 'Warehouse Management', subs: [
          { code: 'WM-ST', name: 'Storage' },
          { code: 'WM-GR', name: 'Goods Receipt' },
          { code: 'WM-GI', name: 'Goods Issue' },
          { code: 'WM-PI', name: 'Physical Inventory' },
        ]},
        { code: 'BASIS', name: 'SAP Basis / Technology', subs: [
          { code: 'AUTH', name: 'Authorization & Roles' },
          { code: 'PERF', name: 'Performance Tuning' },
          { code: 'TRNS', name: 'Transport Management' },
          { code: 'UPGR', name: 'Upgrades & Patches' },
          { code: 'CONN', name: 'Connectivity / RFC / IDoc' },
        ]},
        { code: 'ABAP', name: 'ABAP Development', subs: [
          { code: 'RPT', name: 'Reports' },
          { code: 'ENH', name: 'Enhancements / BADIs' },
          { code: 'FORM', name: 'Forms (Smartforms/Adobe)' },
          { code: 'WF', name: 'Workflow' },
          { code: 'INTF', name: 'Interfaces' },
        ]},
      ];

      let moduleCount = 0, subCount = 0;
      for (let i = 0; i < defaults.length; i++) {
        const d = defaults[i];
        let mod = await prisma.sAPModuleMaster.findUnique({
          where: { tenantId_code: { tenantId, code: d.code } },
        });
        if (!mod) {
          mod = await prisma.sAPModuleMaster.create({
            data: { tenantId, code: d.code, name: d.name, sortOrder: (i + 1) * 10 },
          });
          moduleCount++;
        }
        for (let j = 0; j < d.subs.length; j++) {
          const s = d.subs[j];
          const existing = await prisma.sAPSubModuleMaster.findUnique({
            where: { tenantId_moduleId_code: { tenantId, moduleId: mod.id, code: s.code } },
          });
          if (!existing) {
            await prisma.sAPSubModuleMaster.create({
              data: { tenantId, moduleId: mod.id, code: s.code, name: s.name, sortOrder: (j + 1) * 10 },
            });
            subCount++;
          }
        }
      }

      res.json({ success: true, message: `Seeded ${moduleCount} modules, ${subCount} sub-modules` });
    } catch (err) { next(err); }
  }
);

export default router;
