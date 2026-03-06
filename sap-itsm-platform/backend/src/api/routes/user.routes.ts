import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { paginate, buildPaginatedResult } from '../../utils/pagination';
import { auditLog, auditFromRequest } from '../../utils/audit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware';
import { bcryptRounds } from '../../config/constants';

const router = Router();
router.use(verifyJWT, enforceTenantScope);

const createUserSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    role: z.enum(['SUPER_ADMIN', 'COMPANY_ADMIN', 'USER', 'AGENT', 'PROJECT_MANAGER']),
  }),
});

// GET /users — COMPANY_ADMIN sees only their customer's USERs
router.get('/', enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page  = Number(req.query.page)  || 1;
    const limit = Number(req.query.limit) || 20;
    const { skip, take } = paginate(page, limit);
    const isCompanyAdmin = req.user!.role === 'COMPANY_ADMIN';

    // COMPANY_ADMIN: find their customer via adminUserId
    let companyAdminCustomerId: string | null = null;
    if (isCompanyAdmin) {
      const customer = await prisma.customer.findFirst({
        where: { adminUserId: req.user!.sub },
        select: { id: true },
      });
      companyAdminCustomerId = customer?.id || null;
    }

    const where: any = {
      tenantId: req.user!.tenantId,
      // Always exclude AGENT/PM — managed via Agents page
      ...(req.query.role && !isCompanyAdmin
        ? { role: req.query.role as any }
        : isCompanyAdmin
          ? { role: 'USER', customerId: companyAdminCustomerId }
          : { role: { notIn: ['AGENT', 'PROJECT_MANAGER'] } }
      ),
      ...(req.query.status && { status: req.query.status as any }),
      ...(req.query.search && {
        OR: [
          { firstName: { contains: req.query.search as string, mode: 'insensitive' as any } },
          { lastName:  { contains: req.query.search as string, mode: 'insensitive' as any } },
          { email:     { contains: req.query.search as string, mode: 'insensitive' as any } },
        ],
      }),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where, skip, take,
        select: {
          id: true, email: true, firstName: true, lastName: true,
          role: true, status: true, lastLoginAt: true, createdAt: true,
          customerId: true,
          customer: { select: { id: true, companyName: true } },
          agent: { select: { id: true, level: true, status: true } },
          _count: { select: { createdRecords: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ success: true, ...buildPaginatedResult(users, total, page, limit) });
  } catch (err) { next(err); }
});

// POST /users
router.post('/', enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'), validate(createUserSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, firstName, lastName, role, customerId } = req.body;

    // Domain validation: if customer has allowedDomains, validate email domain
    const resolvedCustomerId = customerId || req.user!.customerId;
    if (resolvedCustomerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: resolvedCustomerId },
        select: { allowedDomains: true, companyName: true },
      });
      if (customer && customer.allowedDomains.length > 0) {
        const emailDomain = email.toLowerCase().trim().split('@')[1];
        if (!customer.allowedDomains.some((d: string) => d.toLowerCase() === emailDomain)) {
          res.status(400).json({
            success: false,
            error: `Email domain "${emailDomain}" is not allowed for ${customer.companyName}. Allowed domains: ${customer.allowedDomains.join(', ')}`,
          });
          return;
        }
      }
    }

    const passwordHash = await bcrypt.hash(password, bcryptRounds);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash, firstName, lastName, role,
        tenantId:   req.user!.tenantId,
        status:     'ACTIVE',
        customerId: customerId || undefined,
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, status: true, createdAt: true },
    });

    await auditLog({ ...auditFromRequest(req), action: 'CREATE', entityType: 'User', entityId: user.id, newValues: { email, role } });
    res.status(201).json({ success: true, user });
  } catch (err) { next(err); }
});

// GET /users/:id
router.get('/:id', enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findFirst({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, status: true, lastLoginAt: true, createdAt: true, customerId: true,
        customer: { select: { id: true, companyName: true } },
      },
    });
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }
    res.json({ success: true, user });
  } catch (err) { next(err); }
});

// PATCH /users/:id
router.patch('/:id', enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = ['firstName', 'lastName', 'email', 'role', 'status', 'customerId'];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    // Normalize email
    if (data.email) data.email = (data.email as string).toLowerCase().trim();
    if (req.body.password) {
      (data as any).passwordHash = await bcrypt.hash(req.body.password, bcryptRounds);
    }
    await prisma.user.updateMany({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
      data: data as any,
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// DELETE /users/:id
router.delete('/:id', enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.user.updateMany({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
      data: { status: 'INACTIVE' },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
