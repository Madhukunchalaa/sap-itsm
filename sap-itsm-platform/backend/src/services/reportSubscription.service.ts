import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';

export interface Subscriber {
  email: string;
  customerId: string | null;
  plant: string; // '' = no plant scope (Tenant or Customer Overall)
}

export async function listReportSubscriptions(tenantId: string) {
  return prisma.reportSubscription.findMany({
    where: { tenantId },
    include: { customer: { select: { id: true, companyName: true } } },
    orderBy: [{ email: 'asc' }, { plant: 'asc' }],
  });
}

// Plant, if set, must belong to the given customer — and a plant scope
// requires a customer (a plant can't be "tenant-wide").
async function assertValidScope(tenantId: string, customerId?: string | null, plant?: string) {
  if (plant && !customerId) {
    throw new AppError('A Plant scope requires a Customer to be selected', 400, 'VALIDATION');
  }
  if (customerId) {
    const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!customer) throw new AppError('Customer not found', 404, 'NOT_FOUND');
  }
  if (customerId && plant) {
    const plantRow = await prisma.plant.findFirst({ where: { tenantId, customerId, name: plant } });
    if (!plantRow) throw new AppError('That plant does not belong to the selected customer', 400, 'VALIDATION');
  }
}

// Postgres doesn't enforce uniqueness across NULL customerId via the DB
// constraint, so Tenant Overall / Customer Overall duplicates are caught here.
async function assertNoDuplicate(tenantId: string, email: string, customerId: string | null, plant: string, excludeId?: string) {
  const existing = await prisma.reportSubscription.findFirst({
    where: { tenantId, email, customerId, plant, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (existing) throw new AppError('This email is already subscribed at this scope', 409, 'DUPLICATE_ENTRY');
}

export async function createReportSubscription(
  tenantId: string,
  data: {
    email: string; name?: string; customerId?: string; plant?: string;
    dailyEnabled?: boolean; weeklyEnabled?: boolean; monthlyEnabled?: boolean;
  }
) {
  const email = data.email.trim().toLowerCase();
  const customerId = data.customerId || null;
  const plant = data.plant?.trim() || '';

  await assertValidScope(tenantId, customerId, plant);
  await assertNoDuplicate(tenantId, email, customerId, plant);

  return prisma.reportSubscription.create({
    data: {
      tenantId, email, customerId, plant,
      name: data.name?.trim() || null,
      dailyEnabled: !!data.dailyEnabled,
      weeklyEnabled: !!data.weeklyEnabled,
      monthlyEnabled: !!data.monthlyEnabled,
    },
  });
}

export async function updateReportSubscription(
  tenantId: string,
  id: string,
  data: Partial<{
    email: string; name: string | null; customerId: string | null; plant: string;
    dailyEnabled: boolean; weeklyEnabled: boolean; monthlyEnabled: boolean; isActive: boolean;
  }>
) {
  const existing = await prisma.reportSubscription.findFirst({ where: { id, tenantId } });
  if (!existing) throw new AppError('Report subscription not found', 404, 'NOT_FOUND');

  const nextCustomerId = data.customerId !== undefined ? data.customerId : existing.customerId;
  const nextPlant = data.plant !== undefined ? (data.plant?.trim() || '') : existing.plant;
  const nextEmail = data.email !== undefined ? data.email.trim().toLowerCase() : existing.email;

  if (data.customerId !== undefined || data.plant !== undefined) {
    await assertValidScope(tenantId, nextCustomerId, nextPlant);
  }
  if (data.email !== undefined || data.customerId !== undefined || data.plant !== undefined) {
    await assertNoDuplicate(tenantId, nextEmail, nextCustomerId, nextPlant, id);
  }

  return prisma.reportSubscription.update({
    where: { id },
    data: {
      ...(data.email !== undefined && { email: nextEmail }),
      ...(data.name !== undefined && { name: data.name?.trim() || null }),
      ...(data.customerId !== undefined && { customerId: nextCustomerId }),
      ...(data.plant !== undefined && { plant: nextPlant }),
      ...(data.dailyEnabled !== undefined && { dailyEnabled: data.dailyEnabled }),
      ...(data.weeklyEnabled !== undefined && { weeklyEnabled: data.weeklyEnabled }),
      ...(data.monthlyEnabled !== undefined && { monthlyEnabled: data.monthlyEnabled }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  });
}

export async function deleteReportSubscription(tenantId: string, id: string) {
  const existing = await prisma.reportSubscription.findFirst({ where: { id, tenantId } });
  if (!existing) throw new AppError('Report subscription not found', 404, 'NOT_FOUND');
  await prisma.reportSubscription.delete({ where: { id } });
}

// Used by the daily/weekly/monthly digest jobs.
export async function getSubscribers(
  tenantId: string, cadence: 'daily' | 'weekly' | 'monthly'
): Promise<Subscriber[]> {
  const field = cadence === 'daily' ? 'dailyEnabled' : cadence === 'weekly' ? 'weeklyEnabled' : 'monthlyEnabled';
  const rows = await prisma.reportSubscription.findMany({
    where: { tenantId, isActive: true, [field]: true },
    select: { email: true, customerId: true, plant: true },
  });
  return rows.map((r) => ({ email: r.email, customerId: r.customerId, plant: r.plant || '' }));
}

// Buckets subscribers into the three scope tiers, ready for a digest job to
// generate one report per bucket instead of one per subscriber.
export function groupSubscribers(subs: Subscriber[]): {
  tenantWide: string[];
  byCustomer: Map<string, string[]>;               // customerId -> emails (Customer Overall)
  byPlant: Map<string, { customerId: string; plant: string; emails: string[] }>; // `${customerId}::${plant}` -> ...
} {
  const tenantWide: string[] = [];
  const byCustomer = new Map<string, string[]>();
  const byPlant = new Map<string, { customerId: string; plant: string; emails: string[] }>();

  for (const s of subs) {
    if (!s.customerId) {
      tenantWide.push(s.email);
    } else if (!s.plant) {
      const arr = byCustomer.get(s.customerId) || [];
      arr.push(s.email);
      byCustomer.set(s.customerId, arr);
    } else {
      const key = `${s.customerId}::${s.plant}`;
      const entry = byPlant.get(key) || { customerId: s.customerId, plant: s.plant, emails: [] };
      entry.emails.push(s.email);
      byPlant.set(key, entry);
    }
  }
  return { tenantWide, byCustomer, byPlant };
}
