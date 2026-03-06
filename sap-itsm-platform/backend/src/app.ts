import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';
import { errorHandler } from './api/middleware/error.middleware';
import { notFoundHandler } from './api/middleware/notFound.middleware';
import { requestLogger } from './api/middleware/requestLogger.middleware';

// Routes
import authRoutes from './api/routes/auth.routes';
import userRoutes from './api/routes/user.routes';
import agentRoutes from './api/routes/agent.routes';
import customerRoutes from './api/routes/customer.routes';
import contractRoutes from './api/routes/contract.routes';
import recordRoutes from './api/routes/record.routes';
import cmdbRoutes from './api/routes/cmdb.routes';
import shiftRoutes from './api/routes/shift.routes';
import holidayRoutes, { emailLogRouter } from './api/routes/holiday.routes';
import auditRoutes from './api/routes/audit.routes';
import dashboardRoutes from './api/routes/dashboard.routes';
import reportRoutes from './api/routes/report.routes';
import supportTypeRoutes from './api/routes/supportTypeMaster.routes';
import notificationRuleRoutes from './services/notifications/notification.routes';
import notificationInboxRoutes from './services/notifications/inbox.routes';
import sapModuleRoutes from './api/routes/sapModule.routes';
import assignmentRuleRoutes from './api/routes/assignmentRule.routes';

const app = express();

// ── Security ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: true,
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: (origin, callback) => {
    const allowed = (process.env.CORS_ORIGINS || '*').split(',').map(o => o.trim());
    if (allowed.includes('*')) {
      callback(null, origin || true);
    } else if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
}));

// ── Rate Limiting ─────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
}));

app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' },
}));

// ── Body Parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

// ── Logging ───────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}
app.use(requestLogger);

// ── Health Check ──────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'sap-itsm-backend',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    build: 'v34-smart-assign-20260306',
  });
});

// ── API Routes ────────────────────────────────────────────────
const API = '/api/v1';
app.use(`${API}/auth`, authRoutes);
app.use(`${API}/users`, userRoutes);
app.use(`${API}/agents`, agentRoutes);
app.use(`${API}/customers`, customerRoutes);
app.use(`${API}/contracts`, contractRoutes);
app.use(`${API}/support-types`, supportTypeRoutes);
app.use(`${API}/records`, recordRoutes);
app.use(`${API}/cmdb`, cmdbRoutes);
app.use(`${API}/shifts`, shiftRoutes);
app.use(`${API}/holidays`, holidayRoutes);
app.use(`${API}/email-logs`, emailLogRouter);
app.use(`${API}/audit`, auditRoutes);
app.use(`${API}/dashboard`, dashboardRoutes);
app.use(`${API}/reports`, reportRoutes);
app.use(`${API}/notification-rules`, notificationRuleRoutes);
app.use(`${API}/notifications/inbox`, notificationInboxRoutes);
app.use(`${API}/sap-modules`, sapModuleRoutes);
app.use(`${API}/assignment-rules`, assignmentRuleRoutes);

// ── Admin Endpoints (before error handlers!) ──────────────────
app.post('/admin/fix-record-customers', async (_req, res) => {
  try {
    const { prisma } = await import('./config/database');
    const result = await prisma.$executeRaw`
      UPDATE itsm_records r
      SET customer_id = u.customer_id
      FROM users u
      WHERE r.created_by = u.id
      AND r.customer_id IS NULL
      AND u.customer_id IS NOT NULL`;
    res.json({ success: true, message: `Fixed ${result} records` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Seed notification rules for all tenants
app.post('/admin/seed-notification-rules', async (_req, res) => {
  try {
    const { prisma } = await import('./config/database');
    const { seedDefaultNotificationRules, seedEmailTemplates } = await import('./services/notifications/notification.service');
    const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
    const results: any[] = [];
    for (const t of tenants) {
      const ruleCount = await seedDefaultNotificationRules(t.id);
      const tplCount = await seedEmailTemplates(t.id);
      results.push({ tenant: t.name, rulesSeeded: ruleCount, templatesSeeded: tplCount });
    }
    res.json({ success: true, results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/seed', async (_req, res) => {
  if (process.env.SEED_ON_BOOT !== 'true') {
    return res.status(403).json({ error: 'Seed not enabled' });
  }
  try {
    const { seedDatabase } = await import('./seed');
    await seedDatabase();
    res.json({ success: true, message: 'Database seeded' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Error Handling (must be LAST) ─────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
