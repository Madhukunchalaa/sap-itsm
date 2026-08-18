import { z } from 'zod';

export const createPlantSchema = z.object({
  body: z.object({
    customerId: z.string().uuid(),
    name: z.string().min(1).max(200),
    code: z.string().max(50).optional(),
  }),
});

export const updatePlantSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    name: z.string().min(1).max(200).optional(),
    code: z.string().max(50).nullable().optional(),
    isActive: z.boolean().optional(),
  }),
});
