import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validate.middleware';
import { verifyJWT, enforceTenantScope } from '../middleware/auth.middleware';
import {
  loginSchema,
  registerSchema,
  refreshTokenSchema,
  changePasswordSchema,
} from '../validators/auth.validators';
import {
  loginUser,
  registerUser,
  refreshTokens,
  logoutUser,
  changePassword,
} from '../../services/auth.service';

const router = Router();

// POST /auth/login
router.post('/login', validate(loginSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const result = await loginUser(email, password, req.ip, req.headers['user-agent']);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// POST /auth/register
router.post('/register', validate(registerSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await registerUser({ ...req.body, tenantId: req.body.tenantId });
    res.status(201).json({ success: true, user });
  } catch (err) {
    next(err);
  }
});

// POST /auth/refresh
router.post('/refresh', validate(refreshTokenSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tokens = await refreshTokens(req.body.refreshToken);
    res.json({ success: true, ...tokens });
  } catch (err) {
    next(err);
  }
});

// POST /auth/logout
router.post('/logout', verifyJWT, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await logoutUser(req.body.refreshToken, req.user!.sub);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// GET /auth/me
router.get('/me', verifyJWT, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prisma } = await import('../../config/database');
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        tenantId: true,
        customerId: true,
        lastLoginAt: true,
        createdAt: true,
        agent: { select: { id: true, level: true, specialization: true, status: true } },
        customer: { select: { id: true, companyName: true } },
        tenant: { select: { id: true, name: true, timezone: true } },
      },
    });
    // Also return the resolved customerId from middleware for debugging
    res.json({ success: true, user, _middleware: { customerId: req.user!.customerId ?? null, role: req.user!.role } });
  } catch (err) {
    next(err);
  }
});

// GET /auth/debug-scope — shows exactly what scoping resolves for the logged-in user
router.get('/debug-scope', verifyJWT, enforceTenantScope, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prisma } = await import('../../config/database');
    const role       = req.user!.role;
    const userId     = req.user!.sub;
    const tenantId   = req.user!.tenantId;
    const customerId = req.user!.customerId ?? null;

    const debug: any = {
      user: { id: userId, role, tenantId, customerId },
      scope: {},
    };

    if (role === 'COMPANY_ADMIN') {
      debug.scope.type = 'COMPANY_ADMIN → filters by customerId';
      debug.scope.customerId = customerId;
      if (customerId) {
        const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, companyName: true } });
        debug.scope.customer = customer;
        const recordCount = await prisma.iTSMRecord.count({ where: { tenantId, customerId } });
        debug.scope.recordCount = recordCount;
      } else {
        debug.scope.problem = 'customerId is NULL — user is not linked to any customer. Fix: set user.customerId in the database.';
      }
    } else if (role === 'USER') {
      debug.scope.type = 'USER → filters by customerId + createdById';
      debug.scope.customerId = customerId;
      debug.scope.createdById = userId;
      if (customerId) {
        const recordCount = await prisma.iTSMRecord.count({ where: { tenantId, customerId, createdById: userId } });
        debug.scope.recordCount = recordCount;
      } else {
        debug.scope.problem = 'customerId is NULL — user is not linked to any customer.';
      }
    } else if (role === 'AGENT') {
      const agent = await prisma.agent.findUnique({ where: { userId } });
      debug.scope.type = 'AGENT → filters by assignedAgentId';
      debug.scope.agent = agent ? { id: agent.id, agentType: (agent as any).agentType } : null;
      if (agent) {
        const recordCount = await prisma.iTSMRecord.count({ where: { tenantId, assignedAgentId: agent.id } });
        debug.scope.recordCount = recordCount;
      } else {
        debug.scope.problem = 'No Agent record found for this user. Fix: create an Agent record linked to this userId.';
      }
    } else if (role === 'PROJECT_MANAGER') {
      const agent = await prisma.agent.findUnique({ where: { userId } });
      debug.scope.type = 'PROJECT_MANAGER → filters by Customer.projectManagerAgentId';
      debug.scope.agent = agent ? { id: agent.id, agentType: (agent as any).agentType } : null;
      if (agent) {
        const managedCustomers = await prisma.customer.findMany({
          where: { projectManagerAgentId: agent.id, tenantId },
          select: { id: true, companyName: true },
        });
        debug.scope.managedCustomers = managedCustomers;
        const validIds = managedCustomers.map(c => c.id);
        debug.scope.managedCustomerIds = validIds;
        if (validIds.length > 0) {
          const recordCount = await prisma.iTSMRecord.count({ where: { tenantId, customerId: { in: validIds } } });
          debug.scope.recordCount = recordCount;
        } else {
          debug.scope.problem = 'No customers have projectManagerAgentId pointing to this agent. Fix: set Customer.projectManagerAgentId = this agent ID for each managed company.';
        }
      } else {
        debug.scope.problem = 'No Agent record found for this PM user. Fix: create an Agent record (agentType=PROJECT_MANAGER) linked to this userId.';
      }
    } else if (role === 'SUPER_ADMIN') {
      debug.scope.type = 'SUPER_ADMIN → sees all records in tenant';
      const recordCount = await prisma.iTSMRecord.count({ where: { tenantId } });
      debug.scope.recordCount = recordCount;
    }

    res.json({ success: true, debug });
  } catch (err) {
    next(err);
  }
});

// POST /auth/change-password
router.post('/change-password', verifyJWT, validate(changePasswordSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await changePassword(req.user!.sub, req.body.currentPassword, req.body.newPassword);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
