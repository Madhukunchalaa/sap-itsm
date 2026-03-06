import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../config/database';
import { jwtConfig, bcryptRounds } from '../config/constants';
import { AppError } from '../utils/AppError';
import { auditLog } from '../utils/audit';
import { JWTPayload } from '../api/middleware/auth.middleware';
import { UserRole } from '@prisma/client';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
  tenantId?: string;
}

function generateTokens(payload: JWTPayload): AuthTokens {
  const accessToken = jwt.sign(payload, jwtConfig.accessSecret, {
    expiresIn: jwtConfig.accessExpiry as any,
  });
  const refreshToken = jwt.sign({ sub: payload.sub }, jwtConfig.refreshSecret, {
    expiresIn: jwtConfig.refreshExpiry as any,
  });
  return { accessToken, refreshToken, expiresIn: 900 }; // 15 min
}

export async function loginUser(
  email: string,
  password: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ tokens: AuthTokens; user: object }> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: { tenant: { select: { id: true, name: true, status: true } } },
  });

  if (!user) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  if (user.status === 'LOCKED') {
    throw new AppError('Account is locked. Please contact support.', 401, 'ACCOUNT_LOCKED');
  }
  if (user.status === 'INACTIVE') {
    throw new AppError('Account is inactive.', 401, 'ACCOUNT_INACTIVE');
  }
  if (user.tenant.status === 'SUSPENDED') {
    throw new AppError('Your organization account is suspended.', 401, 'TENANT_SUSPENDED');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  const payload: JWTPayload = {
    sub: user.id,
    tenantId: user.tenantId,
    role: user.role,
    email: user.email,
  };

  const tokens = generateTokens(payload);
  const refreshExpiry = new Date();
  refreshExpiry.setDate(refreshExpiry.getDate() + 7);

  // Store refresh token
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: tokens.refreshToken,
      expiresAt: refreshExpiry,
    },
  });

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await auditLog({
    tenantId: user.tenantId,
    userId: user.id,
    action: 'LOGIN',
    entityType: 'User',
    entityId: user.id,
    ipAddress,
    userAgent,
  });

  const { passwordHash: _, ...safeUser } = user;
  return { tokens, user: safeUser };
}

export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  let payload: { sub: string };
  try {
    payload = jwt.verify(refreshToken, jwtConfig.refreshSecret) as { sub: string };
  } catch {
    throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: { user: true },
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new AppError('Refresh token expired or revoked', 401, 'REFRESH_TOKEN_EXPIRED');
  }

  // Revoke old token (token rotation)
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const user = stored.user;
  const newPayload: JWTPayload = {
    sub: user.id,
    tenantId: user.tenantId,
    role: user.role,
    email: user.email,
  };

  const tokens = generateTokens(newPayload);
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 7);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: tokens.refreshToken,
      expiresAt: expiry,
    },
  });

  return tokens;
}

export async function registerUser(input: RegisterInput): Promise<object> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase().trim() },
  });
  if (existing) {
    throw new AppError('Email already in use', 409, 'EMAIL_EXISTS');
  }

  const passwordHash = await bcrypt.hash(input.password, bcryptRounds);

  const user = await prisma.user.create({
    data: {
      email: input.email.toLowerCase().trim(),
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role || 'USER',
      tenantId: input.tenantId!,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      tenantId: true,
      createdAt: true,
    },
  });

  await auditLog({
    tenantId: user.tenantId,
    userId: user.id,
    action: 'CREATE',
    entityType: 'User',
    entityId: user.id,
    newValues: { email: user.email, role: user.role },
  });

  return user;
}

export async function logoutUser(refreshToken: string, userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { token: refreshToken, userId },
    data: { revokedAt: new Date() },
  });

  await auditLog({
    userId,
    action: 'LOGOUT',
    entityType: 'User',
    entityId: userId,
  });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw new AppError('Current password is incorrect', 400, 'INVALID_PASSWORD');

  const passwordHash = await bcrypt.hash(newPassword, bcryptRounds);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  // Revoke all refresh tokens (force re-login)
  await prisma.refreshToken.updateMany({
    where: { userId },
    data: { revokedAt: new Date() },
  });

  await auditLog({
    userId,
    action: 'UPDATE',
    entityType: 'User',
    entityId: userId,
    metadata: { action: 'password_change' },
  });
}
