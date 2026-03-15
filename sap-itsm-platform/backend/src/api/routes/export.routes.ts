import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/AppError';

const router = Router();

// All export endpoints require SUPER_ADMIN
router.use(verifyJWT, (req: Request, _res: Response, next: NextFunction) => {
  if (req.user!.role !== 'SUPER_ADMIN') {
    return next(new AppError('Forbidden', 403, 'FORBIDDEN'));
  }
  next();
});

/**
 * GET /api/v1/export
 * Returns all production data as JSON.
 * Optional query params:
 *   ?tenantId=<uuid>  — filter to a specific tenant (defaults to the SUPER_ADMIN's own tenant)
 *   ?table=users|records|customers|agents|contracts|...  — single table only
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req.query.tenantId as string) || req.user!.tenantId;
    const table    = req.query.table as string | undefined;

    // ── helpers ──────────────────────────────────────────────
    const where = { tenantId };

    const fetchers: Record<string, () => Promise<any>> = {
      tenants: () => prisma.tenant.findMany({ where: { id: tenantId } }),

      users: () => prisma.user.findMany({
        where,
        select: {
          id: true, email: true, firstName: true, lastName: true,
          role: true, status: true, tenantId: true, customerId: true,
          lastLoginAt: true, createdAt: true, updatedAt: true,
        },
      }),

      customers: () => prisma.customer.findMany({
        where,
        include: {
          projectManagerAgent: { select: { id: true, user: { select: { email: true, firstName: true, lastName: true } } } },
        },
      }),

      agents: () => prisma.agent.findMany({
        where: { tenantId },
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true, role: true } },
          specializations: true,
        },
      }),

      records: () => prisma.iTSMRecord.findMany({
        where,
        include: {
          customer: { select: { id: true, companyName: true } },
          assignedAgent: { include: { user: { select: { email: true, firstName: true, lastName: true } } } },
          createdBy: { select: { id: true, email: true, firstName: true, lastName: true } },
          slaTracking: true,
          comments: { orderBy: { createdAt: 'asc' } },
          timeEntries: true,
        },
        orderBy: { createdAt: 'desc' },
      }),

      contracts: () => prisma.contract.findMany({
        where,
        include: {
          customer: { select: { id: true, companyName: true } },
          supportType: true,
          slaPolicy: true,
          shifts: { include: { shift: true } },
          holidayCalendars: { include: { holidayCalendar: true } },
        },
      }),

      sla_policies: () => prisma.sLAPolicyMaster.findMany({ where }),

      shifts: () => prisma.shift.findMany({ where }),

      holidays: () => prisma.holidayCalendar.findMany({
        where,
        include: { dates: true },
      }),

      cmdb: () => prisma.configurationItem.findMany({ where }),

      support_types: () => prisma.supportTypeMaster.findMany({ where }),

      audit_logs: () => prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),

      email_logs: () => prisma.emailLog.findMany({
        where: { record: { tenantId } },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),

      notification_rules: () => prisma.notificationRule.findMany({ where }),

      assignment_rules: () => prisma.assignmentRule.findMany({ where }),
    };

    // ── single table ─────────────────────────────────────────
    if (table) {
      if (!fetchers[table]) {
        throw new AppError(`Unknown table "${table}". Valid: ${Object.keys(fetchers).join(', ')}`, 400, 'UNKNOWN_TABLE');
      }
      const data = await fetchers[table]();
      return res.json({ success: true, table, tenantId, count: data.length, data });
    }

    // ── full export ───────────────────────────────────────────
    const results: Record<string, any> = {};
    for (const [key, fn] of Object.entries(fetchers)) {
      try {
        results[key] = await fn();
      } catch (err: any) {
        results[key] = { error: err.message };
      }
    }

    const summary: Record<string, number> = {};
    for (const [key, val] of Object.entries(results)) {
      summary[key] = Array.isArray(val) ? val.length : -1;
    }

    res.json({
      success: true,
      exportedAt: new Date().toISOString(),
      tenantId,
      summary,
      data: results,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
