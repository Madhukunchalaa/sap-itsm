import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { verifyJWT, enforceRole, enforceTenantScope } from '../middleware/auth.middleware';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/AppError';
import { resolveAgent, resolveManagedCustomerIds } from './scopeHelpers';
import {
  buildStatusDeckData, generateStatusDeck, statusDeckFileName, StatusDeckData,
  buildConsolidatedDeckData, generateConsolidatedDeck, consolidatedDeckFileName,
} from '../../services/statusDeck.service';
import {
  buildMonthlyReviewData, generateMonthlyReview, monthlyReviewFileName,
} from '../../services/monthlyReview.service';

// Weekly / Monthly status deck (.pptx) and the monthly module review (.docx) —
// manager level only: Project Managers (limited to the customers they manage)
// and Super Admins.
const router = Router();
router.use(verifyJWT, enforceTenantScope, enforceRole('SUPER_ADMIN', 'PROJECT_MANAGER'));

const querySchema = z.object({
  period: z.enum(['weekly', 'monthly']).default('weekly'),
  customerId: z.string().uuid(),
  plant: z.string().trim().max(100).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
});

// null = every customer in the tenant (Super Admin); otherwise the managed ids.
async function allowedCustomerIds(req: Request): Promise<string[] | null> {
  if (req.user!.role === 'SUPER_ADMIN') return null;
  const agent = await resolveAgent(req.user!.sub);
  return agent ? resolveManagedCustomerIds(agent.id, req.user!.tenantId) : [];
}

function parseRequest(req: Request) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 400, 'VALIDATION_ERROR');
  }
  const q = parsed.data;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const asOf = q.date ? new Date(`${q.date}T00:00:00`) : today;
  if (Number.isNaN(asOf.getTime())) throw new AppError('Invalid date.', 400, 'VALIDATION_ERROR');
  if (asOf > today) throw new AppError('Report date cannot be in the future.', 400, 'VALIDATION_ERROR');
  return { period: q.period, customerId: q.customerId, plant: q.plant || undefined, asOf };
}

async function assertCustomerAllowed(req: Request, customerId: string) {
  const allowed = await allowedCustomerIds(req);
  if (allowed && !allowed.includes(customerId)) {
    throw new AppError('You do not manage this customer.', 403, 'FORBIDDEN');
  }
}

// GET /status-decks/customers — customers the caller may generate a report for
router.get('/customers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = await allowedCustomerIds(req);
    const rows = await prisma.customer.findMany({
      where: { tenantId: req.user!.tenantId, ...(allowed ? { id: { in: allowed } } : {}) },
      select: { id: true, companyName: true },
      orderBy: { companyName: 'asc' },
    });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// No plant selected = the consolidated all-plants deck; a plant = the single-plant deck.
const summarize = (d: StatusDeckData) => ({
  current: d.current,
  previous: d.previous,
  openTickets: d.openTickets.length,
  uatTickets: d.uatTickets.length,
  awaitingHoldTickets: d.awaitingHoldTickets.length,
});

// GET /status-decks/preview — the numbers and ticket counts that would go in the deck
router.get('/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const opts = parseRequest(req);
    await assertCustomerAllowed(req, opts.customerId);
    if (!opts.plant) {
      const data = await buildConsolidatedDeckData(req.user!.tenantId, opts);
      res.json({
        success: true,
        data: {
          mode: 'consolidated',
          fileName: consolidatedDeckFileName(data),
          current: data.current,
          previous: data.previous,
          previousAsOf: data.previousAsOf,
          plants: data.plants.map((p) => ({ label: p.label, ...summarize(p.data) })),
        },
      });
      return;
    }
    const data = await buildStatusDeckData(req.user!.tenantId, opts);
    res.json({
      success: true,
      data: { mode: 'plant', fileName: statusDeckFileName(data), previousAsOf: data.previousAsOf, ...summarize(data) },
    });
  } catch (err) { next(err); }
});

// GET /status-decks/download — the editable .pptx
router.get('/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const opts = parseRequest(req);
    await assertCustomerAllowed(req, opts.customerId);
    let file: Buffer;
    let fileName: string;
    if (!opts.plant) {
      const data = await buildConsolidatedDeckData(req.user!.tenantId, opts);
      file = await generateConsolidatedDeck(data);
      fileName = consolidatedDeckFileName(data);
    } else {
      const data = await buildStatusDeckData(req.user!.tenantId, opts);
      file = await generateStatusDeck(data);
      fileName = statusDeckFileName(data);
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(file);
  } catch (err) { next(err); }
});

// ── Monthly module review (.docx) ───────────────────────────────────────────

const monthlyQuerySchema = z.object({
  customerId: z.string().uuid(),
  plant: z.string().trim().max(100).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
  modules: z.string().max(200).optional(), // comma-separated module ids; omitted = all
});

function parseMonthlyRequest(req: Request) {
  const parsed = monthlyQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 400, 'VALIDATION_ERROR');
  }
  const modules = (parsed.data.modules || '').split(',').map((m) => m.trim()).filter(Boolean);
  return { customerId: parsed.data.customerId, plant: parsed.data.plant || undefined, month: parsed.data.month, modules };
}

// GET /status-decks/monthly-review/preview — per-module numbers that go in the document
router.get('/monthly-review/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const opts = parseMonthlyRequest(req);
    await assertCustomerAllowed(req, opts.customerId);
    const data = await buildMonthlyReviewData(req.user!.tenantId, { ...opts, modules: undefined });
    res.json({
      success: true,
      data: {
        fileName: monthlyReviewFileName(data),
        asOf: data.asOf,
        modules: data.modules.map((m) => ({
          id: m.id,
          title: m.title,
          carry: m.summary.carry,
          newCount: m.summary.newCount,
          closed: m.summary.carryClosed + m.summary.newClosed,
          open: (m.summary.carry - m.summary.carryClosed) + (m.summary.newCount - m.summary.newClosed),
          highOpen: m.highOpen.length,
        })),
      },
    });
  } catch (err) { next(err); }
});

// GET /status-decks/monthly-review/download — the editable .docx
router.get('/monthly-review/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const opts = parseMonthlyRequest(req);
    await assertCustomerAllowed(req, opts.customerId);
    const data = await buildMonthlyReviewData(req.user!.tenantId, opts);
    const file = await generateMonthlyReview(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${monthlyReviewFileName(data)}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(file);
  } catch (err) { next(err); }
});

export default router;
