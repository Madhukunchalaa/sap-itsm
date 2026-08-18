import { z } from 'zod';

export const createReportSubscriptionSchema = z.object({
  body: z.object({
    email: z.string().email(),
    name: z.string().max(200).optional(),
    customerId: z.string().uuid().optional(), // omitted = Tenant Overall
    plant: z.string().max(200).optional(),    // omitted/empty = Customer Overall (requires customerId)
    dailyEnabled: z.boolean().optional(),
    weeklyEnabled: z.boolean().optional(),
    monthlyEnabled: z.boolean().optional(),
  }),
});

export const updateReportSubscriptionSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    email: z.string().email().optional(),
    name: z.string().max(200).nullable().optional(),
    customerId: z.string().uuid().nullable().optional(),
    plant: z.string().max(200).optional(),
    dailyEnabled: z.boolean().optional(),
    weeklyEnabled: z.boolean().optional(),
    monthlyEnabled: z.boolean().optional(),
    isActive: z.boolean().optional(),
  }),
});
