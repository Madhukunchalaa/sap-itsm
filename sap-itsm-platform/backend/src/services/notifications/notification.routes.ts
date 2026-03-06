import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceRole, enforceTenantScope } from '../../api/middleware/auth.middleware';
import { prisma } from '../../config/database';
import {
  NOTIFICATION_EVENTS,
  RECIPIENT_ROLES,
  RECIPIENT_TYPES,
  EVENT_LABELS,
  RECIPIENT_LABELS,
  RECIPIENT_TYPE_LABELS,
  seedDefaultNotificationRules,
  seedEmailTemplates,
  DEFAULT_EMAIL_TEMPLATES,
  findMatchingRules,
  resolveRecipientUserIds,
} from './notification.service';

const router = Router();
router.use(verifyJWT, enforceTenantScope);

// ── POST /notification-rules/templates ─────────────────────────
// SUPER_ADMIN only: create new email template
router.post('/templates',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { templateKey, label, description, subjectTemplate, bodyTemplate } = req.body;
      if (!templateKey || !label || !subjectTemplate || !bodyTemplate) {
        res.status(400).json({ success: false, error: 'templateKey, label, subjectTemplate, and bodyTemplate are required' });
        return;
      }

      // Check duplicate
      const existing = await prisma.emailTemplate.findUnique({
        where: { tenantId_templateKey: { tenantId: req.user!.tenantId, templateKey } },
      });
      if (existing) {
        res.status(409).json({ success: false, error: `Template with key "${templateKey}" already exists` });
        return;
      }

      const template = await prisma.emailTemplate.create({
        data: {
          tenantId: req.user!.tenantId,
          templateKey,
          label,
          description: description || '',
          subjectTemplate,
          bodyTemplate,
          isActive: true,
        },
      });

      res.status(201).json({ success: true, template });
    } catch (err) { next(err); }
  }
);

// ── GET /notification-rules/templates ─────────────────────────
// Returns all email templates from DB
router.get('/templates',
  enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const templates = await prisma.emailTemplate.findMany({
        where: { tenantId: req.user!.tenantId },
        orderBy: { templateKey: 'asc' },
      });
      res.json({ success: true, templates });
    } catch (err) { next(err); }
  }
);

// ── PATCH /notification-rules/templates/:id ───────────────────
// SUPER_ADMIN only: update template subject/body
router.patch('/templates/:id',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { subjectTemplate, bodyTemplate, isActive } = req.body;
      const data: Record<string, unknown> = {};
      if (subjectTemplate !== undefined) data.subjectTemplate = subjectTemplate;
      if (bodyTemplate !== undefined) data.bodyTemplate = bodyTemplate;
      if (isActive !== undefined) data.isActive = isActive;

      const updated = await prisma.emailTemplate.updateMany({
        where: { id: req.params.id, tenantId: req.user!.tenantId },
        data: data as any,
      });

      if (updated.count === 0) {
        res.status(404).json({ success: false, error: 'Template not found' });
        return;
      }

      const template = await prisma.emailTemplate.findUnique({ where: { id: req.params.id } });
      res.json({ success: true, template });
    } catch (err) { next(err); }
  }
);

// ── POST /notification-rules/templates/:id/preview ────────────
// Render template with sample data
router.post('/templates/:id/preview',
  enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const Handlebars = await import('handlebars');
      const template = await prisma.emailTemplate.findFirst({
        where: { id: req.params.id, tenantId: req.user!.tenantId },
      });
      if (!template) {
        res.status(404).json({ success: false, error: 'Template not found' });
        return;
      }

      const sampleVars: Record<string, any> = {
        recordId: 'sample-id', recordNumber: 'INC-0042', recordType: 'INCIDENT',
        title: 'VPN connection timeout for remote users',
        description: 'Users in Anpara office are experiencing intermittent VPN drops during peak hours.',
        priority: 'P1', status: 'OPEN', customer: 'Anpara Thermal Power',
        recipientName: 'Rajesh Kumar', authorName: 'Priya Sharma',
        assignedAgentName: 'Amit Verma',
        commentText: 'We have identified the root cause. The VPN concentrator was running at 95% capacity.',
        oldStatus: 'OPEN', newStatus: 'IN_PROGRESS', slaType: 'Response',
        portalUrl: process.env.PORTAL_URL || (process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',')[0].trim() : 'https://app.example.com'),
      };

      const subjectRendered = Handlebars.compile(template.subjectTemplate)(sampleVars);
      const bodyRendered = Handlebars.compile(template.bodyTemplate)(sampleVars);

      res.json({ success: true, subjectRendered, bodyRendered });
    } catch (err) { next(err); }
  }
);

// ── POST /notification-rules/templates/reset/:id ──────────────
// SUPER_ADMIN only: reset template to default
router.post('/templates/reset/:id',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const template = await prisma.emailTemplate.findFirst({
        where: { id: req.params.id, tenantId: req.user!.tenantId },
      });
      if (!template) {
        res.status(404).json({ success: false, error: 'Template not found' });
        return;
      }

      const defaultTpl = DEFAULT_EMAIL_TEMPLATES.find(t => t.templateKey === template.templateKey);
      if (!defaultTpl) {
        res.status(400).json({ success: false, error: 'No default found for this template' });
        return;
      }

      const updated = await prisma.emailTemplate.update({
        where: { id: template.id },
        data: {
          subjectTemplate: defaultTpl.subjectTemplate,
          bodyTemplate: defaultTpl.bodyTemplate,
        },
      });

      res.json({ success: true, template: updated });
    } catch (err) { next(err); }
  }
);


// Returns available events, recipient roles, and labels for the UI
router.get('/metadata',
  enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  async (req: Request, res: Response) => {
    // Also return available email templates for the dropdown
    const templates = await prisma.emailTemplate.findMany({
      where: { tenantId: req.user!.tenantId, isActive: true },
      select: { id: true, templateKey: true, label: true },
      orderBy: { label: 'asc' },
    });

    res.json({
      success: true,
      events: NOTIFICATION_EVENTS.map(e => ({ value: e, label: EVENT_LABELS[e] || e })),
      recipientRoles: RECIPIENT_ROLES.map(r => ({ value: r, label: RECIPIENT_LABELS[r] || r })),
      recipientTypes: RECIPIENT_TYPES.map(t => ({ value: t, label: RECIPIENT_TYPE_LABELS[t] || t })),
      emailTemplates: templates,
      priorities: [
        { value: '', label: 'Any Priority' },
        { value: 'P1', label: 'P1 - Critical' },
        { value: 'P2', label: 'P2 - High' },
        { value: 'P3', label: 'P3 - Medium' },
        { value: 'P4', label: 'P4 - Low' },
      ],
      statusFilters: [
        { value: '', label: 'Any Status' },
        { value: 'NEW', label: 'New' },
        { value: 'OPEN', label: 'Open / Reopened' },
        { value: 'IN_PROGRESS', label: 'In Progress' },
        { value: 'PENDING', label: 'Pending / Waiting for Customer' },
        { value: 'RESOLVED', label: 'Resolved' },
        { value: 'CLOSED', label: 'Closed' },
        { value: 'CANCELLED', label: 'Cancelled' },
      ],
    });
  }
);

// ── GET /notification-rules ───────────────────────────────────
// SUPER_ADMIN: all rules (default + per-customer)
// COMPANY_ADMIN: default rules + their customer's overrides (read-only)
router.get('/',
  enforceRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user!.tenantId;
      const role = req.user!.role;
      const filterCustomerId = req.query.customerId as string | undefined;

      let where: any = { tenantId };

      if (role === 'COMPANY_ADMIN') {
        // Company admin sees defaults + their own customer overrides
        const custId = req.user!.customerId;
        if (!custId) {
          // Fallback: check if they're set as adminUser on a customer
          const customer = await prisma.customer.findFirst({
            where: { adminUserId: req.user!.sub },
            select: { id: true },
          });
          where.OR = [
            { customerId: null },
            ...(customer ? [{ customerId: customer.id }] : []),
          ];
        } else {
          where.OR = [
            { customerId: null },
            { customerId: custId },
          ];
        }
      } else if (filterCustomerId) {
        // Super admin filtering by customer
        where.OR = [
          { customerId: null },
          { customerId: filterCustomerId },
        ];
      }

      const rules = await prisma.notificationRule.findMany({
        where,
        include: {
          customer: { select: { id: true, companyName: true } },
          primaryTemplate: { select: { id: true, templateKey: true, label: true } },
          secondaryTemplate: { select: { id: true, templateKey: true, label: true } },
          escalationTemplate: { select: { id: true, templateKey: true, label: true } },
        },
        orderBy: [
          { event: 'asc' },
          { priority: 'asc' },
          { customerId: 'asc' },
        ],
      });

      // Group by event for easier UI rendering
      const grouped: Record<string, any[]> = {};
      for (const rule of rules) {
        if (!grouped[rule.event]) grouped[rule.event] = [];
        grouped[rule.event].push({
          ...rule,
          eventLabel: EVENT_LABELS[rule.event] || rule.event,
          recipientLabels: (rule.recipients as any[]).map((r: any) => {
            const role = typeof r === 'string' ? r : r.role;
            return RECIPIENT_LABELS[role] || role;
          }),
          isDefault: !rule.customerId,
        });
      }

      res.json({ success: true, rules, grouped });
    } catch (err) { next(err); }
  }
);

// ── POST /notification-rules ──────────────────────────────────
// SUPER_ADMIN only: create a new rule
router.post('/',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { event, priority, statusFilter, recipients, customerId,
        primaryTemplateId, secondaryTemplateId, escalationTemplateId,
        emailEnabled, inAppEnabled } = req.body;

      if (!NOTIFICATION_EVENTS.includes(event)) {
        res.status(400).json({ success: false, error: `Invalid event: ${event}` });
        return;
      }

      // Validate recipients (now JSON array of {role, recipientType})
      const recipientEntries = (recipients || []).map((r: any) => {
        const entry = typeof r === 'string' ? { role: r, recipientType: 'PRIMARY' } : r;
        if (!RECIPIENT_ROLES.includes(entry.role)) {
          throw new Error(`Invalid recipient role: ${entry.role}`);
        }
        return { role: entry.role, recipientType: entry.recipientType || 'PRIMARY' };
      });

      const rule = await prisma.notificationRule.create({
        data: {
          tenantId: req.user!.tenantId,
          customerId: customerId || null,
          event,
          priority: priority || null,
          statusFilter: statusFilter || null,
          recipients: recipientEntries,
          primaryTemplateId: primaryTemplateId || null,
          secondaryTemplateId: secondaryTemplateId || null,
          escalationTemplateId: escalationTemplateId || null,
          emailEnabled: emailEnabled !== false,
          inAppEnabled: inAppEnabled !== false,
          isActive: true,
        },
        include: {
          customer: { select: { id: true, companyName: true } },
          primaryTemplate: { select: { id: true, templateKey: true, label: true } },
          secondaryTemplate: { select: { id: true, templateKey: true, label: true } },
          escalationTemplate: { select: { id: true, templateKey: true, label: true } },
        },
      });

      res.status(201).json({ success: true, rule });
    } catch (err) { next(err); }
  }
);

// ── PATCH /notification-rules/:id ─────────────────────────────
// SUPER_ADMIN only: update a rule
router.patch('/:id',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const allowed = ['event', 'priority', 'statusFilter', 'recipients', 'customerId',
        'primaryTemplateId', 'secondaryTemplateId', 'escalationTemplateId',
        'emailEnabled', 'inAppEnabled', 'isActive'];
      const data: Record<string, unknown> = {};
      for (const k of allowed) {
        if (req.body[k] !== undefined) {
          if (['priority', 'statusFilter', 'customerId', 'primaryTemplateId', 'secondaryTemplateId', 'escalationTemplateId'].includes(k) && req.body[k] === '') {
            data[k] = null;
          } else if (k === 'recipients' && Array.isArray(req.body[k])) {
            data[k] = req.body[k].map((r: any) =>
              typeof r === 'string' ? { role: r, recipientType: 'PRIMARY' } : { role: r.role, recipientType: r.recipientType || 'PRIMARY' }
            );
          } else {
            data[k] = req.body[k];
          }
        }
      }

      const rule = await prisma.notificationRule.updateMany({
        where: { id: req.params.id, tenantId: req.user!.tenantId },
        data: data as any,
      });

      if (rule.count === 0) {
        res.status(404).json({ success: false, error: 'Rule not found' });
        return;
      }

      const updated = await prisma.notificationRule.findUnique({
        where: { id: req.params.id },
        include: {
          customer: { select: { id: true, companyName: true } },
          primaryTemplate: { select: { id: true, templateKey: true, label: true } },
          secondaryTemplate: { select: { id: true, templateKey: true, label: true } },
          escalationTemplate: { select: { id: true, templateKey: true, label: true } },
        },
      });

      res.json({ success: true, rule: updated });
    } catch (err) { next(err); }
  }
);

// ── DELETE /notification-rules/:id ────────────────────────────
// SUPER_ADMIN only
router.delete('/:id',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await prisma.notificationRule.deleteMany({
        where: { id: req.params.id, tenantId: req.user!.tenantId },
      });

      if (deleted.count === 0) {
        res.status(404).json({ success: false, error: 'Rule not found' });
        return;
      }

      res.json({ success: true });
    } catch (err) { next(err); }
  }
);

// ── POST /notification-rules/seed ─────────────────────────────
// SUPER_ADMIN only: seed default rules for the tenant
router.post('/seed',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const count = await seedDefaultNotificationRules(req.user!.tenantId);
      // Also seed email templates
      const { seedEmailTemplates } = await import('./notification.service');
      const tplCount = await seedEmailTemplates(req.user!.tenantId);
      res.json({ success: true, message: `Seeded ${count} rules and ${tplCount} email templates` });
    } catch (err) { next(err); }
  }
);

// ── POST /notification-rules/preview ──────────────────────────
// SUPER_ADMIN only: preview who would be notified for a given event + record
router.post('/preview',
  enforceRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { event, recordId, priority, customerId, toStatus } = req.body;
      const tenantId = req.user!.tenantId;

      // Find matching rules
      const rules = await findMatchingRules(
        tenantId,
        event,
        priority || null,
        customerId || null,
        toStatus || null,
      );

      // Collect all recipient roles
      const allRoles = new Set<string>();
      for (const r of rules) {
        for (const role of (r.recipients as any[])) allRoles.add(typeof role === 'string' ? role : role.role);
      }

      // If a recordId is provided, resolve actual users
      let resolvedUsers: any[] = [];
      if (recordId) {
        const record = await prisma.iTSMRecord.findFirst({
          where: { id: recordId, tenantId },
          select: { createdById: true, assignedAgentId: true, customerId: true },
        });
        if (record) {
          const userIds = await resolveRecipientUserIds(
            Array.from(allRoles),
            record,
            tenantId,
            'preview', // no one to exclude in preview
          );
          resolvedUsers = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, firstName: true, lastName: true, email: true, role: true },
          });
        }
      }

      res.json({
        success: true,
        matchedRules: rules.map(r => ({
          id: r.id,
          event: r.event,
          priority: r.priority,
          statusFilter: r.statusFilter,
          recipients: r.recipients,
          recipientLabels: (r.recipients as any[]).map((role: any) => {
            const rv = typeof role === 'string' ? role : role.role;
            return RECIPIENT_LABELS[rv] || rv;
          }),
        })),
        recipientRoles: Array.from(allRoles),
        resolvedUsers,
      });
    } catch (err) { next(err); }
  }
);

export default router;
