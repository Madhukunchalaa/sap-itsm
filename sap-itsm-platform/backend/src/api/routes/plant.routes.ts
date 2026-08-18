import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { createPlantSchema, updatePlantSchema } from '../validators/plant.validators';
import { listPlants, listPlantsByCustomer, createPlant, updatePlant, deletePlant } from '../../services/plant.service';

const router = Router();
router.use(verifyJWT, enforceTenantScope);

// GET /plants — flat tenant-wide list (any authenticated user; ?activeOnly=true for filters)
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await listPlants(req.user!.tenantId, req.query.activeOnly === 'true');
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /plants/by-customer/:customerId — scoped list for ticket forms
router.get('/by-customer/:customerId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await listPlantsByCustomer(req.user!.tenantId, req.params.customerId);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// POST /plants — create (Super Admin / Project Manager only)
router.post('/', enforceRole('SUPER_ADMIN', 'PROJECT_MANAGER'), validate(createPlantSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const row = await createPlant(req.user!.tenantId, req.body);
      res.status(201).json({ success: true, data: row });
    } catch (err: any) {
      if (err.code === 'P2002') {
        res.status(409).json({ success: false, error: 'A plant with this name already exists for this customer' });
        return;
      }
      next(err);
    }
  }
);

// PATCH /plants/:id
router.patch('/:id', enforceRole('SUPER_ADMIN', 'PROJECT_MANAGER'), validate(updatePlantSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const row = await updatePlant(req.user!.tenantId, req.params.id, req.body);
      res.json({ success: true, data: row });
    } catch (err) { next(err); }
  }
);

// DELETE /plants/:id
router.delete('/:id', enforceRole('SUPER_ADMIN', 'PROJECT_MANAGER'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deletePlant(req.user!.tenantId, req.params.id);
      res.json({ success: true });
    } catch (err) { next(err); }
  }
);

export default router;
