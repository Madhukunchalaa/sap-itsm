import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceTenantScope } from '../middleware/auth.middleware';
import { resolveAgent, resolveManagedCustomerIds } from './scopeHelpers';
import { listStatusChanges, exportStatusHistoryExcel, StatusHistoryFilters } from '../../services/statusHistory.service';

const router = Router();
router.use(verifyJWT, enforceTenantScope);

type Scope = Pick<StatusHistoryFilters, 'customerId' | 'customerIdIn' | 'plant'>;

// Same role-scoping shape as ticket listing/dashboard — a compliance report
// should never surface tickets a role couldn't otherwise see.
async function resolveScope(req: Request): Promise<Scope | null> {
  const role = req.user!.role;
  const q = req.query as any;

  switch (role) {
    case 'SUPER_ADMIN':
      return { ...(q.customerId && { customerId: q.customerId }), ...(q.plant && { plant: q.plant }) };

    case 'COMPANY_ADMIN':
      if (!req.user!.customerId) return null;
      return { customerId: req.user!.customerId, ...(q.plant && { plant: q.plant }) };

    case 'PROJECT_MANAGER': {
      const agent = await resolveAgent(req.user!.sub);
      if (!agent) return null;
      const ids = await resolveManagedCustomerIds(agent.id, req.user!.tenantId);
      if (ids.length === 0) return null;
      if (q.customerId && ids.includes(q.customerId)) {
        return { customerId: q.customerId, ...(q.plant && { plant: q.plant }) };
      }
      return { customerIdIn: ids, ...(q.plant && { plant: q.plant }) };
    }

    case 'PLANT_MANAGER':
      if (!req.user!.customerId || !req.user!.plant) return null;
      return { customerId: req.user!.customerId, plant: req.user!.plant };

    default:
      return null; // AGENT / USER: not a compliance/audit-facing role
  }
}

function parseDateFilters(q: any) {
  return {
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
    recordId: q.recordId || undefined,
  };
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await resolveScope(req);
    if (!scope) { res.json({ success: true, data: [], total: 0, page: 1, limit: 30 }); return; }
    const q = req.query as any;
    const result = await listStatusChanges(req.user!.tenantId, {
      ...scope,
      ...parseDateFilters(q),
      page: q.page ? parseInt(q.page, 10) : 1,
      limit: q.limit ? parseInt(q.limit, 10) : 30,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

router.get('/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await resolveScope(req);
    if (!scope) { res.status(403).json({ success: false, error: 'No accessible data for this account' }); return; }
    const q = req.query as any;
    const scopeLabel = scope.plant
      ? `${scope.plant}`
      : scope.customerId
        ? 'Customer'
        : scope.customerIdIn
          ? 'Managed Customers'
          : 'All';
    const buffer = await exportStatusHistoryExcel(req.user!.tenantId, { ...scope, ...parseDateFilters(q) }, scopeLabel);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="status-history-${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (err) { next(err); }
});

export default router;
