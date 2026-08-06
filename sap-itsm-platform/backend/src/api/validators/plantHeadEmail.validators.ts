import { z } from 'zod';

export const createPlantHeadEmailSchema = z.object({
  body: z.object({
    plant: z.string().min(1).max(200),
    email: z.string().email(),
    name: z.string().max(200).optional(),
  }),
});

export const updatePlantHeadEmailSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    plant: z.string().min(1).max(200).optional(),
    email: z.string().email().optional(),
    name: z.string().max(200).nullable().optional(),
    isActive: z.boolean().optional(),
  }),
});
