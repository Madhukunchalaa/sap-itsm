import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';

export async function listPlantHeadEmails(tenantId: string) {
  return prisma.plantHeadEmail.findMany({
    where: { tenantId },
    orderBy: [{ plant: 'asc' }, { email: 'asc' }],
  });
}

export async function createPlantHeadEmail(
  tenantId: string,
  data: { plant: string; email: string; name?: string }
) {
  return prisma.plantHeadEmail.create({
    data: {
      tenantId,
      plant: data.plant.trim(),
      email: data.email.trim().toLowerCase(),
      name: data.name?.trim() || null,
    },
  });
}

export async function updatePlantHeadEmail(
  tenantId: string,
  id: string,
  data: Partial<{ plant: string; email: string; name: string | null; isActive: boolean }>
) {
  const existing = await prisma.plantHeadEmail.findFirst({ where: { id, tenantId } });
  if (!existing) throw new AppError('Plant head email not found', 404, 'NOT_FOUND');

  return prisma.plantHeadEmail.update({
    where: { id },
    data: {
      ...(data.plant !== undefined && { plant: data.plant.trim() }),
      ...(data.email !== undefined && { email: data.email.trim().toLowerCase() }),
      ...(data.name !== undefined && { name: data.name?.trim() || null }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  });
}

export async function deletePlantHeadEmail(tenantId: string, id: string) {
  const existing = await prisma.plantHeadEmail.findFirst({ where: { id, tenantId } });
  if (!existing) throw new AppError('Plant head email not found', 404, 'NOT_FOUND');
  await prisma.plantHeadEmail.delete({ where: { id } });
}

// Used by the daily plant status job.
export async function getActiveHeadEmailsForPlant(tenantId: string, plant: string): Promise<string[]> {
  const rows = await prisma.plantHeadEmail.findMany({
    where: { tenantId, plant, isActive: true },
    select: { email: true },
  });
  return rows.map((r) => r.email);
}

export async function getDistinctPlants(tenantId: string): Promise<string[]> {
  const rows = await prisma.plantHeadEmail.findMany({
    where: { tenantId, isActive: true },
    select: { plant: true },
    distinct: ['plant'],
  });
  return rows.map((r) => r.plant);
}
