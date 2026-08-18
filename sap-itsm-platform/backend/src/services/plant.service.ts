import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';

// Flat, tenant-wide list — used by admin-scoped filters (Records filter,
// Dashboard plant filter, Report Subscriptions) that aren't tied to one customer.
export async function listPlants(tenantId: string, activeOnly = false) {
  return prisma.plant.findMany({
    where: { tenantId, ...(activeOnly ? { isActive: true } : {}) },
    include: { customer: { select: { id: true, companyName: true } } },
    orderBy: [{ customer: { companyName: 'asc' } }, { name: 'asc' }],
  });
}

// Scoped to one customer — used by the ticket create/edit Plant dropdown.
export async function listPlantsByCustomer(tenantId: string, customerId: string) {
  return prisma.plant.findMany({
    where: { tenantId, customerId, isActive: true },
    orderBy: { name: 'asc' },
  });
}

export async function createPlant(
  tenantId: string, data: { customerId: string; name: string; code?: string }
) {
  const customer = await prisma.customer.findFirst({ where: { id: data.customerId, tenantId } });
  if (!customer) throw new AppError('Customer not found', 404, 'NOT_FOUND');

  return prisma.plant.create({
    data: { tenantId, customerId: data.customerId, name: data.name.trim(), code: data.code?.trim() || null },
  });
}

export async function updatePlant(
  tenantId: string, id: string, data: Partial<{ name: string; code: string | null; isActive: boolean }>
) {
  const existing = await prisma.plant.findFirst({ where: { id, tenantId } });
  if (!existing) throw new AppError('Plant not found', 404, 'NOT_FOUND');

  return prisma.plant.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.code !== undefined && { code: data.code?.trim() || null }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  });
}

export async function deletePlant(tenantId: string, id: string) {
  const existing = await prisma.plant.findFirst({ where: { id, tenantId } });
  if (!existing) throw new AppError('Plant not found', 404, 'NOT_FOUND');

  const ticketCount = await prisma.iTSMRecord.count({ where: { tenantId, plant: existing.name } });
  if (ticketCount > 0) {
    throw new AppError(`Cannot delete: ${ticketCount} ticket(s) use this plant. Deactivate it instead.`, 400, 'IN_USE');
  }
  await prisma.plant.delete({ where: { id } });
}
