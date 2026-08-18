import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { createReportSubscriptionSchema, updateReportSubscriptionSchema } from '../validators/reportSubscription.validators';
import {
  listReportSubscriptions, createReportSubscription, updateReportSubscription, deleteReportSubscription,
} from '../../services/reportSubscription.service';

const router = Router();
router.use(verifyJWT, enforceTenantScope, enforceRole('SUPER_ADMIN', 'PROJECT_MANAGER'));

// GET /report-subscriptions — list all Daily/Weekly/Monthly recipients for the tenant
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await listReportSubscriptions(req.user!.tenantId);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// POST /report-subscriptions — add a recipient
router.post('/', validate(createReportSubscriptionSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await createReportSubscription(req.user!.tenantId, req.body);
    res.status(201).json({ success: true, data: row });
  } catch (err: any) {
    if (err.code === 'P2002') {
      res.status(409).json({ success: false, error: 'This email is already subscribed' });
      return;
    }
    next(err);
  }
});

// PATCH /report-subscriptions/:id
router.patch('/:id', validate(updateReportSubscriptionSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await updateReportSubscription(req.user!.tenantId, req.params.id, req.body);
    res.json({ success: true, data: row });
  } catch (err) { next(err); }
});

// DELETE /report-subscriptions/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteReportSubscription(req.user!.tenantId, req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
