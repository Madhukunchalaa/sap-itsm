import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { createPlantHeadEmailSchema, updatePlantHeadEmailSchema } from '../validators/plantHeadEmail.validators';
import {
  listPlantHeadEmails, createPlantHeadEmail, updatePlantHeadEmail, deletePlantHeadEmail,
} from '../../services/plantHeadEmail.service';

const router = Router();
router.use(verifyJWT, enforceTenantScope, enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_MANAGER'));

// GET /plant-head-emails — list all plant → head-email entries for the tenant
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await listPlantHeadEmails(req.user!.tenantId);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// POST /plant-head-emails — add a head email for a plant
router.post('/', validate(createPlantHeadEmailSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await createPlantHeadEmail(req.user!.tenantId, req.body);
    res.status(201).json({ success: true, data: row });
  } catch (err: any) {
    if (err.code === 'P2002') {
      res.status(409).json({ success: false, error: 'This email is already configured for this plant' });
      return;
    }
    next(err);
  }
});

// PATCH /plant-head-emails/:id
router.patch('/:id', validate(updatePlantHeadEmailSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await updatePlantHeadEmail(req.user!.tenantId, req.params.id, req.body);
    res.json({ success: true, data: row });
  } catch (err) { next(err); }
});

// DELETE /plant-head-emails/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deletePlantHeadEmail(req.user!.tenantId, req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
