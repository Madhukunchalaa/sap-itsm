import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/database';
import { jwtConfig } from '../../config/constants';
import { AppError } from '../../utils/AppError';
import { UserRole } from '@prisma/client';

export interface JWTPayload {
  sub: string;       // userId
  tenantId: string;
  role: UserRole;
  email: string;
  customerId?: string | null;   // set for COMPANY_ADMIN and USER — re-fetched from DB
  customerIds?: string[];       // all assigned customer IDs for multi-customer access
  sapModuleId?: string | null;  // SAP module restriction
  canRunSapAnalysis?: boolean;  // "Perform AI Analysis" access — re-fetched from DB
  plant?: string | null;        // PLANT_MANAGER restriction — view-only, scoped to one plant
  iat?: number;
  exp?: number;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

/**
 * Verify JWT access token and attach user to request.
 * IMPORTANT: customerId and customerIds are re-fetched from DB on every request
 * to prevent stale values if a user's company assignment changes.
 */
export const verifyJWT = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('No token provided', 401, 'UNAUTHORIZED');
    }

    const token = authHeader.split(' ')[1];
    const payload = jwt.verify(token, jwtConfig.accessSecret) as JWTPayload;

    // Verify user still exists and is active — also fetch fresh customerId and assigned customerUsers
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        status: true,
        tenantId: true,
        role: true,
        customerId: true,
        sapModuleId: true,
        canRunSapAnalysis: true,
        plant: true,
        customerUsers: { select: { customerId: true } },
      },
    });

    if (!user) {
      throw new AppError('User not found', 401, 'UNAUTHORIZED');
    }
    if (user.status === 'INACTIVE' || user.status === 'LOCKED') {
      throw new AppError('Account is disabled', 401, 'ACCOUNT_DISABLED');
    }

    const assignedIds = user.customerUsers.map(cu => cu.customerId);
    const allCustomerIds = Array.from(new Set([user.customerId, ...assignedIds].filter(Boolean) as string[]));

    // Attach payload with fresh customerId/customerIds/canRunSapAnalysis from DB (not stale JWT)
    req.user = {
      ...payload,
      customerId: user.customerId ?? (allCustomerIds[0] || null),
      customerIds: allCustomerIds,
      sapModuleId: user.sapModuleId ?? null,
      canRunSapAnalysis: user.canRunSapAnalysis,
      plant: user.plant ?? null,
    };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError('Invalid token', 401, 'INVALID_TOKEN'));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new AppError('Token expired', 401, 'TOKEN_EXPIRED'));
    } else {
      next(error);
    }
  }
};

/**
 * Role-based access control middleware factory.
 */
export const enforceRole = (...allowedRoles: UserRole[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(
          `Access denied. Required roles: ${allowedRoles.join(', ')}`,
          403,
          'FORBIDDEN'
        )
      );
    }
    next();
  };
};

/**
 * Enforce tenant scope on all queries.
 * Super admins can specify X-Tenant-ID header; others are locked to their tenant.
 */
export const enforceTenantScope = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'));
  }

  // Super admins can operate across tenants via header
  if (req.user.role === 'SUPER_ADMIN' && req.headers['x-tenant-id']) {
    req.user.tenantId = req.headers['x-tenant-id'] as string;
  }

  next();
};

/**
 * Optional auth — attach user if token present, but don't fail if not.
 */
export const optionalJWT = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const payload = jwt.verify(token, jwtConfig.accessSecret) as JWTPayload;
      req.user = payload;
    }
  } catch {
    // silently ignore invalid tokens for optional auth
  }
  next();
};
