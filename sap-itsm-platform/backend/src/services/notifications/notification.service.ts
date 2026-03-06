import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import Handlebars from 'handlebars';

// ── Event Types ───────────────────────────────────────────────
export const NOTIFICATION_EVENTS = [
  'TICKET_CREATED', 'ASSIGNED', 'COMMENT_AGENT', 'COMMENT_USER',
  'STATUS_CHANGED', 'PRIORITY_ESCALATED_P1', 'PRIORITY_DOWNGRADED_P1',
  'PRIORITY_CHANGED', 'SLA_WARNING', 'SLA_BREACH',
] as const;

export type NotificationEvent = typeof NOTIFICATION_EVENTS[number];

export const RECIPIENT_ROLES = [
  'CREATOR', 'ASSIGNED_AGENT', 'COMPANY_ADMIN', 'PROJECT_MANAGER', 'SUPER_ADMIN',
] as const;

export type RecipientRole = typeof RECIPIENT_ROLES[number];

export const RECIPIENT_TYPES = ['PRIMARY', 'SECONDARY', 'ESCALATION'] as const;
export type RecipientType = typeof RECIPIENT_TYPES[number];

export interface RecipientEntry {
  role: string;
  recipientType: string;      // PRIMARY, SECONDARY, ESCALATION
}

export const RECIPIENT_TYPE_LABELS: Record<string, string> = {
  PRIMARY: 'Primary',
  SECONDARY: 'Secondary (FYI)',
  ESCALATION: 'Escalation',
};

export const EVENT_LABELS: Record<string, string> = {
  TICKET_CREATED: 'Ticket Created',
  ASSIGNED: 'Agent Assigned',
  COMMENT_AGENT: 'Agent Comment',
  COMMENT_USER: 'Customer Comment',
  STATUS_CHANGED: 'Status Changed',
  PRIORITY_ESCALATED_P1: 'Priority Escalated to P1',
  PRIORITY_DOWNGRADED_P1: 'Priority Downgraded from P1',
  PRIORITY_CHANGED: 'Priority Changed',
  SLA_WARNING: 'SLA Warning (80%)',
  SLA_BREACH: 'SLA Breached',
};

export const RECIPIENT_LABELS: Record<string, string> = {
  CREATOR: 'Ticket Creator',
  ASSIGNED_AGENT: 'Assigned Agent',
  COMPANY_ADMIN: 'Company Admin',
  PROJECT_MANAGER: 'Project Manager',
  SUPER_ADMIN: 'Super Admin',
};

// ── Default Email Templates (used for seeding) ───────────────
export const DEFAULT_EMAIL_TEMPLATES: Array<{
  templateKey: string; label: string; description: string;
  subjectTemplate: string; bodyTemplate: string;
}> = [
  {
    templateKey: 'RECORD_CREATED',
    label: 'Ticket Created',
    description: 'Sent when a new ticket is created',
    subjectTemplate: '[{{priority}}] New {{recordType}} Created: {{recordNumber}}',
    bodyTemplate: `<div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color: #1a73e8;">New {{recordType}} Created</h2>
      <table style="width:100%; border-collapse: collapse;">
        <tr><td style="padding:8px; background:#f5f5f5;"><b>Record #</b></td><td style="padding:8px;">{{recordNumber}}</td></tr>
        <tr><td style="padding:8px; background:#f5f5f5;"><b>Title</b></td><td style="padding:8px;">{{title}}</td></tr>
        <tr><td style="padding:8px; background:#f5f5f5;"><b>Priority</b></td><td style="padding:8px;">{{priority}}</td></tr>
        <tr><td style="padding:8px; background:#f5f5f5;"><b>Status</b></td><td style="padding:8px;">{{status}}</td></tr>
        <tr><td style="padding:8px; background:#f5f5f5;"><b>Customer</b></td><td style="padding:8px;">{{customer}}</td></tr>
      </table>
      <p style="margin-top:16px;">{{description}}</p>
      <a href="{{portalUrl}}/records/{{recordId}}" style="display:inline-block;margin-top:16px;background:#1a73e8;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;">View Ticket</a>
    </div>`,
  },
  {
    templateKey: 'STATUS_CHANGED',
    label: 'Status Changed',
    description: 'Sent when ticket status is updated',
    subjectTemplate: '{{recordNumber}} — Status Changed to {{newStatus}}',
    bodyTemplate: `<div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2>Status Update: {{recordNumber}}</h2>
      <p>The status of <b>{{title}}</b> has been changed.</p>
      <p><b>From:</b> {{oldStatus}} → <b>To:</b> {{newStatus}}</p>
      <a href="{{portalUrl}}/records/{{recordId}}" style="display:inline-block;margin-top:16px;background:#1a73e8;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;">View Ticket</a>
    </div>`,
  },
  {
    templateKey: 'RECORD_ASSIGNED',
    label: 'Ticket Assigned',
    description: 'Sent when a ticket is assigned to an agent',
    subjectTemplate: 'Ticket Assigned to You: {{recordNumber}}',
    bodyTemplate: `<div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2>You have been assigned a ticket</h2>
      <p>Hello {{recipientName}},</p>
      <p>Ticket <b>{{recordNumber}}</b> — {{title}} has been assigned to you.</p>
      <p><b>Priority:</b> {{priority}}</p>
      <a href="{{portalUrl}}/records/{{recordId}}" style="display:inline-block;margin-top:16px;background:#1a73e8;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;">View Ticket</a>
    </div>`,
  },
  {
    templateKey: 'COMMENT_ADDED',
    label: 'New Comment',
    description: 'Sent when a public comment is posted',
    subjectTemplate: 'New Comment on {{recordNumber}}',
    bodyTemplate: `<div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2>New Comment on {{recordNumber}}</h2>
      <p>A comment was added to <b>{{title}}</b> by {{authorName}}:</p>
      <blockquote style="border-left:3px solid #ccc;padding-left:16px;color:#555;">{{commentText}}</blockquote>
      <a href="{{portalUrl}}/records/{{recordId}}" style="display:inline-block;margin-top:16px;background:#1a73e8;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;">View Ticket</a>
    </div>`,
  },
  {
    templateKey: 'SLA_WARNING',
    label: 'SLA Warning',
    description: 'Sent when SLA is at 80% threshold',
    subjectTemplate: '⚠️ SLA Warning: {{recordNumber}} — {{slaType}} approaching deadline',
    bodyTemplate: `<div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color: #f57c00;">⚠️ SLA Warning — {{slaType}}</h2>
      <p>Ticket <b>{{recordNumber}}</b> is approaching its {{slaType}} SLA deadline.</p>
      <p><b>Priority:</b> {{priority}} | <b>Customer:</b> {{customer}}</p>
      <a href="{{portalUrl}}/records/{{recordId}}" style="display:inline-block;margin-top:16px;background:#f57c00;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;">Act Now</a>
    </div>`,
  },
  {
    templateKey: 'SLA_BREACH',
    label: 'SLA Breach',
    description: 'Sent when SLA deadline is exceeded',
    subjectTemplate: '🚨 SLA BREACHED: {{recordNumber}} — {{slaType}} exceeded',
    bodyTemplate: `<div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color: #d32f2f;">🚨 SLA Breach — {{slaType}} Exceeded</h2>
      <p>Ticket <b>{{recordNumber}}</b> has breached its {{slaType}} SLA.</p>
      <p><b>Priority:</b> {{priority}} | <b>Customer:</b> {{customer}}</p>
      <a href="{{portalUrl}}/records/{{recordId}}" style="display:inline-block;margin-top:16px;background:#d32f2f;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;">Escalate Now</a>
    </div>`,
  },
  // ── FYI / Escalation variants (for PM, Company Admin, Super Admin) ──
  {
    templateKey: 'RECORD_CREATED_FYI',
    label: 'Ticket Created (FYI)',
    description: 'Visibility notification for managers when a ticket is created',
    subjectTemplate: '[{{priority}}] New {{recordType}} Raised: {{recordNumber}}',
    bodyTemplate: `<div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color: #1a73e8;">{{priority}} {{recordType}} Raised</h2>
      <p>A new {{priority}} ticket has been raised for <b>{{customer}}</b>.</p>
      <table style="width:100%; border-collapse: collapse;">
        <tr><td style="padding:8px; background:#f5f5f5;"><b>Record #</b></td><td style="padding:8px;">{{recordNumber}}</td></tr>
        <tr><td style="padding:8px; background:#f5f5f5;"><b>Title</b></td><td style="padding:8px;">{{title}}</td></tr>
        <tr><td style="padding:8px; background:#f5f5f5;"><b>Priority</b></td><td style="padding:8px;">{{priority}}</td></tr>
        <tr><td style="padding:8px; background:#f5f5f5;"><b>Customer</b></td><td style="padding:8px;">{{customer}}</td></tr>
      </table>
      <a href="{{portalUrl}}/records/{{recordId}}" style="display:inline-block;margin-top:16px;background:#1a73e8;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;">View Ticket</a>
    </div>`,
  },
  {
    templateKey: 'RECORD_ASSIGNED_FYI',
    label: 'Ticket Assigned (FYI)',
    description: 'Visibility notification for managers when a ticket is assigned',
    subjectTemplate: '[{{priority}}] {{recordNumber}} Assigned to {{assignedAgentName}}',
    bodyTemplate: `<div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2>Ticket Assigned: {{recordNumber}}</h2>
      <p>Ticket <b>{{recordNumber}}</b> — {{title}} has been assigned to <b>{{assignedAgentName}}</b>.</p>
      <table style="width:100%; border-collapse: collapse;">
        <tr><td style="padding:8px; background:#f5f5f5;"><b>Priority</b></td><td style="padding:8px;">{{priority}}</td></tr>
        <tr><td style="padding:8px; background:#f5f5f5;"><b>Customer</b></td><td style="padding:8px;">{{customer}}</td></tr>
        <tr><td style="padding:8px; background:#f5f5f5;"><b>Assigned To</b></td><td style="padding:8px;">{{assignedAgentName}}</td></tr>
      </table>
      <a href="{{portalUrl}}/records/{{recordId}}" style="display:inline-block;margin-top:16px;background:#1a73e8;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;">View Ticket</a>
    </div>`,
  },
  {
    templateKey: 'STATUS_CHANGED_FYI',
    label: 'Status Changed (FYI)',
    description: 'Visibility notification for managers on status changes',
    subjectTemplate: '[{{priority}}] {{recordNumber}} Status → {{newStatus}}',
    bodyTemplate: `<div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2>Status Update: {{recordNumber}}</h2>
      <p>Ticket <b>{{recordNumber}}</b> — {{title}} status has changed.</p>
      <p><b>From:</b> {{oldStatus}} → <b>To:</b> {{newStatus}}</p>
      <p><b>Priority:</b> {{priority}} | <b>Customer:</b> {{customer}}</p>
      <a href="{{portalUrl}}/records/{{recordId}}" style="display:inline-block;margin-top:16px;background:#1a73e8;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;">View Ticket</a>
    </div>`,
  },
  {
    templateKey: 'COMMENT_ADDED_FYI',
    label: 'New Comment (FYI)',
    description: 'Visibility notification for managers on comments',
    subjectTemplate: '[{{priority}}] Comment on {{recordNumber}}',
    bodyTemplate: `<div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2>Comment on {{recordNumber}}</h2>
      <p>A comment was added to <b>{{title}}</b> ({{priority}}) by {{authorName}}.</p>
      <blockquote style="border-left:3px solid #ccc;padding-left:16px;color:#555;">{{commentText}}</blockquote>
      <p><b>Customer:</b> {{customer}}</p>
      <a href="{{portalUrl}}/records/{{recordId}}" style="display:inline-block;margin-top:16px;background:#1a73e8;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;">View Ticket</a>
    </div>`,
  },
];

// ── Load template from DB (falls back to hardcoded) ───────────
async function getEmailTemplate(tenantId: string, templateKey: string): Promise<{ subject: string; html: string } | null> {
  const dbTemplate = await prisma.emailTemplate.findUnique({
    where: { tenantId_templateKey: { tenantId, templateKey } },
  });
  if (dbTemplate && dbTemplate.isActive) {
    return { subject: dbTemplate.subjectTemplate, html: dbTemplate.bodyTemplate };
  }
  // Fallback to hardcoded defaults
  const fallback = DEFAULT_EMAIL_TEMPLATES.find(t => t.templateKey === templateKey);
  if (fallback) {
    return { subject: fallback.subjectTemplate, html: fallback.bodyTemplate };
  }
  return null;
}

// ── Seed email templates into DB ──────────────────────────────
export async function seedEmailTemplates(tenantId: string): Promise<number> {
  let count = 0;
  for (const tpl of DEFAULT_EMAIL_TEMPLATES) {
    const existing = await prisma.emailTemplate.findUnique({
      where: { tenantId_templateKey: { tenantId, templateKey: tpl.templateKey } },
    });
    if (!existing) {
      await prisma.emailTemplate.create({
        data: {
          tenantId,
          templateKey: tpl.templateKey,
          label: tpl.label,
          description: tpl.description,
          subjectTemplate: tpl.subjectTemplate,
          bodyTemplate: tpl.bodyTemplate,
          isActive: true,
        },
      });
      count++;
    }
  }
  logger.info(`Seeded ${count} email templates for tenant ${tenantId}`);
  return count;
}

// ── In-App Notification Titles ────────────────────────────────
function generateNotificationTitle(event: string, vars: Record<string, any>): string {
  const titles: Record<string, string> = {
    TICKET_CREATED: `New ${vars.recordType || 'ticket'}: ${vars.recordNumber}`,
    ASSIGNED: `${vars.recordNumber} assigned to you`,
    COMMENT_AGENT: `Agent commented on ${vars.recordNumber}`,
    COMMENT_USER: `Customer commented on ${vars.recordNumber}`,
    STATUS_CHANGED: `${vars.recordNumber} → ${vars.newStatus || 'updated'}`,
    SLA_WARNING: `⚠️ SLA warning: ${vars.recordNumber}`,
    SLA_BREACH: `🚨 SLA breached: ${vars.recordNumber}`,
    PRIORITY_ESCALATED_P1: `${vars.recordNumber} escalated to P1`,
    PRIORITY_DOWNGRADED_P1: `${vars.recordNumber} downgraded from P1`,
    PRIORITY_CHANGED: `${vars.recordNumber} priority changed`,
  };
  return titles[event] || `Notification: ${vars.recordNumber || event}`;
}

function generateNotificationBody(event: string, vars: Record<string, any>): string {
  const bodies: Record<string, string> = {
    TICKET_CREATED: `${vars.title} — Priority: ${vars.priority}`,
    ASSIGNED: `${vars.title} — Priority: ${vars.priority}`,
    COMMENT_AGENT: `${vars.authorName}: ${(vars.commentText || '').slice(0, 100)}`,
    COMMENT_USER: `${vars.authorName}: ${(vars.commentText || '').slice(0, 100)}`,
    STATUS_CHANGED: `${vars.title} changed from ${vars.oldStatus} to ${vars.newStatus}`,
    SLA_WARNING: `${vars.title} — ${vars.slaType} SLA at 80%`,
    SLA_BREACH: `${vars.title} — ${vars.slaType} SLA exceeded`,
    PRIORITY_ESCALATED_P1: `${vars.title} escalated to P1`,
    PRIORITY_DOWNGRADED_P1: `${vars.title} downgraded from P1`,
    PRIORITY_CHANGED: `${vars.title} priority changed to ${vars.priority}`,
  };
  return bodies[event] || vars.title || '';
}

// ── Core: resolve recipients with role context ────────────────
export interface ResolvedRecipient {
  userId: string;
  role: string;  // the NotificationRule role that resolved this user: CREATOR, ASSIGNED_AGENT, etc.
}

export async function resolveRecipients(
  roles: string[],
  record: { createdById: string; assignedAgentId: string | null; customerId: string | null },
  tenantId: string,
  triggeredByUserId: string,
): Promise<ResolvedRecipient[]> {
  const recipients: Map<string, string> = new Map(); // userId → first role that matched

  for (const role of roles) {
    switch (role) {
      case 'CREATOR':
        if (!recipients.has(record.createdById)) recipients.set(record.createdById, 'CREATOR');
        break;
      case 'ASSIGNED_AGENT':
        if (record.assignedAgentId) {
          const agent = await prisma.agent.findUnique({
            where: { id: record.assignedAgentId }, select: { userId: true },
          });
          if (agent && !recipients.has(agent.userId)) recipients.set(agent.userId, 'ASSIGNED_AGENT');
        }
        break;
      case 'COMPANY_ADMIN':
        if (record.customerId) {
          const cust = await prisma.customer.findUnique({
            where: { id: record.customerId }, select: { adminUserId: true },
          });
          if (cust?.adminUserId && !recipients.has(cust.adminUserId)) recipients.set(cust.adminUserId, 'COMPANY_ADMIN');
        }
        break;
      case 'PROJECT_MANAGER':
        if (record.customerId) {
          const cust = await prisma.customer.findUnique({
            where: { id: record.customerId },
            include: { projectManager: { select: { userId: true } } },
          });
          if (cust?.projectManager?.userId && !recipients.has(cust.projectManager.userId)) {
            recipients.set(cust.projectManager.userId, 'PROJECT_MANAGER');
          }
        }
        break;
      case 'SUPER_ADMIN': {
        const admins = await prisma.user.findMany({
          where: { tenantId, role: 'SUPER_ADMIN', status: 'ACTIVE' }, select: { id: true },
        });
        for (const a of admins) {
          if (!recipients.has(a.id)) recipients.set(a.id, 'SUPER_ADMIN');
        }
        break;
      }
    }
  }

  // Don't notify the person who triggered the event
  recipients.delete(triggeredByUserId);

  return Array.from(recipients.entries()).map(([userId, role]) => ({ userId, role }));
}

// Legacy wrapper for preview endpoint
export async function resolveRecipientUserIds(
  roles: string[], record: any, tenantId: string, triggeredByUserId: string,
): Promise<string[]> {
  const resolved = await resolveRecipients(roles, record, tenantId, triggeredByUserId);
  return resolved.map(r => r.userId);
}

// ── Core: find matching rules ─────────────────────────────────
export async function findMatchingRules(
  tenantId: string, event: string, priority: string | null,
  customerId: string | null, toStatus?: string | null,
) {
  const customerRules = customerId
    ? await prisma.notificationRule.findMany({
        where: { tenantId, customerId, event, isActive: true },
      })
    : [];

  const defaultRules = await prisma.notificationRule.findMany({
    where: { tenantId, customerId: null, event, isActive: true },
  });

  // Customer rules override defaults
  const rules = customerRules.length > 0 ? customerRules : defaultRules;

  return rules.filter(r => {
    if (r.priority && r.priority !== priority) return false;
    if (r.statusFilter && r.statusFilter !== toStatus) return false;
    return true;
  });
}

// ══════════════════════════════════════════════════════════════
// THE MAIN FUNCTION: notify()
// ══════════════════════════════════════════════════════════════

export interface NotifyInput {
  event: string;
  recordId: string;
  tenantId: string;
  triggeredBy: string;        // userId who triggered, or 'system'
  payload?: {
    oldStatus?: string;
    newStatus?: string;
    commentId?: string;
    commentText?: string;
    authorName?: string;
    agentId?: string;
    slaType?: string;
    fromPriority?: string;
    toPriority?: string;
  };
}

export async function notify(input: NotifyInput): Promise<{
  rulesMatched: number;
  recipientsNotified: number;
  emailsQueued: number;
  inAppCreated: number;
}> {
  const { event, recordId, tenantId, triggeredBy, payload = {} } = input;

  const stats = { rulesMatched: 0, recipientsNotified: 0, emailsQueued: 0, inAppCreated: 0 };

  try {
    // 1. Load record
    const record = await prisma.iTSMRecord.findFirst({
      where: { id: recordId, tenantId },
      include: {
        customer: { select: { companyName: true } },
        assignedAgent: { include: { user: { select: { email: true, firstName: true, lastName: true } } } },
        createdBy: { select: { email: true, firstName: true, lastName: true } },
      },
    });
    if (!record) {
      logger.warn(`[notify] Record ${recordId} not found`);
      return stats;
    }

    // 2. Find matching rules
    const rules = await findMatchingRules(
      tenantId, event, record.priority, record.customerId, payload.newStatus,
    );
    stats.rulesMatched = rules.length;

    if (rules.length === 0) {
      logger.debug(`[notify] No rules matched for ${event} on ${record.recordNumber}`);
      return stats;
    }

    // 3. Collect all recipient entries and template IDs from rules
    const allRecipientEntries: RecipientEntry[] = [];
    let emailEnabled = false;
    let inAppEnabled = false;
    // Collect template IDs per type from all matching rules
    let primaryTemplateId: string | null = null;
    let secondaryTemplateId: string | null = null;
    let escalationTemplateId: string | null = null;

    for (const rule of rules) {
      const entries = (rule.recipients as any as RecipientEntry[]) || [];
      for (const entry of entries) {
        if (!allRecipientEntries.find(e => e.role === entry.role)) {
          allRecipientEntries.push(entry);
        }
      }
      if (rule.emailEnabled) emailEnabled = true;
      if (rule.inAppEnabled) inAppEnabled = true;
      if (rule.primaryTemplateId && !primaryTemplateId) primaryTemplateId = rule.primaryTemplateId;
      if (rule.secondaryTemplateId && !secondaryTemplateId) secondaryTemplateId = rule.secondaryTemplateId;
      if (rule.escalationTemplateId && !escalationTemplateId) escalationTemplateId = rule.escalationTemplateId;
    }

    // 4. Resolve each recipient to userId with their role context
    const resolvedRecipients = await resolveRecipients(
      allRecipientEntries.map(e => e.role),
      { createdById: record.createdById, assignedAgentId: record.assignedAgentId, customerId: record.customerId },
      tenantId,
      triggeredBy,
    );
    stats.recipientsNotified = resolvedRecipients.length;

    if (resolvedRecipients.length === 0) {
      logger.debug(`[notify] No recipients resolved for ${event} on ${record.recordNumber}`);
      return stats;
    }

    // 5. Build template variables
    const portalUrl = process.env.PORTAL_URL || (process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',')[0].trim() : 'http://localhost:3000');
    const assignedAgentName = record.assignedAgent
      ? `${record.assignedAgent.user.firstName} ${record.assignedAgent.user.lastName}` : 'Unassigned';
    const vars: Record<string, any> = {
      recordId: record.id,
      recordNumber: record.recordNumber,
      recordType: record.recordType,
      title: record.title,
      description: record.description,
      priority: record.priority,
      status: record.status,
      customer: record.customer?.companyName || '',
      assignedAgentName,
      portalUrl,
      ...payload,
    };

    // 6. Resolve recipient user details
    const userIds = resolvedRecipients.map(r => r.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, firstName: true, lastName: true },
    });

    // 7. Load templates by ID (only load what's needed)
    const templateCache: Record<string, { subject: string; html: string }> = {};
    for (const tplId of [primaryTemplateId, secondaryTemplateId, escalationTemplateId]) {
      if (tplId && !templateCache[tplId]) {
        const dbTpl = await prisma.emailTemplate.findUnique({ where: { id: tplId } });
        if (dbTpl) templateCache[tplId] = { subject: dbTpl.subjectTemplate, html: dbTpl.bodyTemplate };
      }
    }

    // 8. For each recipient: determine template by type, create in-app + queue email
    for (const resolved of resolvedRecipients) {
      const user = users.find(u => u.id === resolved.userId);
      if (!user) continue;

      const recipientVars = { ...vars, recipientName: `${user.firstName} ${user.lastName}` };
      const entry = allRecipientEntries.find(e => e.role === resolved.role);
      const recipientType = entry?.recipientType || 'PRIMARY';

      // Resolve template ID based on recipient type
      const templateId = recipientType === 'PRIMARY' ? primaryTemplateId
        : recipientType === 'SECONDARY' ? secondaryTemplateId
        : escalationTemplateId;

      const template = templateId ? templateCache[templateId] : null;
      const templateKey = templateId || recipientType;

      // In-app notification
      if (inAppEnabled) {
        try {
          await prisma.notification.create({
            data: {
              tenantId,
              userId: user.id,
              recordId,
              event,
              title: generateNotificationTitle(event, recipientVars),
              body: generateNotificationBody(event, recipientVars),
            },
          });
          stats.inAppCreated++;
        } catch (err) {
          logger.error(`[notify] Failed to create in-app notification for ${user.email}:`, err);
        }
      }

      // Email: generate and queue (QUEUED status — not sent yet)
      if (emailEnabled && template) {
        try {
          const subjectTpl = Handlebars.compile(template.subject);
          const bodyTpl = Handlebars.compile(template.html);
          const subject = subjectTpl(recipientVars);
          const html = bodyTpl(recipientVars);

          await prisma.emailLog.create({
            data: {
              recordId,
              templateKey,
              subject,
              recipient: user.email,
              body: html,
              status: 'QUEUED',
            },
          });
          stats.emailsQueued++;
        } catch (err) {
          logger.error(`[notify] Failed to queue email for ${user.email}:`, err);
        }
      }
    }

    logger.info(
      `[notify] ${event} on ${record.recordNumber}: ${stats.rulesMatched} rules, ` +
      `${stats.recipientsNotified} recipients, ${stats.emailsQueued} emails queued, ${stats.inAppCreated} in-app`
    );
  } catch (err) {
    logger.error(`[notify] Error processing ${event} for record ${recordId}:`, err);
  }

  return stats;
}

// ── Seed default rules ────────────────────────────────────────
export async function seedDefaultNotificationRules(tenantId: string): Promise<number> {
  // Get default template IDs for this tenant
  const templates = await prisma.emailTemplate.findMany({
    where: { tenantId }, select: { id: true, templateKey: true },
  });
  const tplMap = new Map(templates.map(t => [t.templateKey, t.id]));

  const defaults: Array<{
    event: string; priority: string | null; statusFilter: string | null;
    recipients: RecipientEntry[];
    primaryTemplateKey?: string; secondaryTemplateKey?: string; escalationTemplateKey?: string;
  }> = [
    { event: 'TICKET_CREATED', priority: null, statusFilter: null,
      recipients: [{ role: 'CREATOR', recipientType: 'PRIMARY' }],
      primaryTemplateKey: 'RECORD_CREATED' },
    { event: 'TICKET_CREATED', priority: 'P1', statusFilter: null,
      recipients: [{ role: 'COMPANY_ADMIN', recipientType: 'ESCALATION' }],
      escalationTemplateKey: 'RECORD_CREATED_FYI' },
    { event: 'ASSIGNED', priority: null, statusFilter: null,
      recipients: [
        { role: 'ASSIGNED_AGENT', recipientType: 'PRIMARY' },
        { role: 'CREATOR', recipientType: 'SECONDARY' },
      ],
      primaryTemplateKey: 'RECORD_ASSIGNED', secondaryTemplateKey: 'RECORD_ASSIGNED_FYI' },
    { event: 'ASSIGNED', priority: 'P1', statusFilter: null,
      recipients: [{ role: 'COMPANY_ADMIN', recipientType: 'ESCALATION' }],
      escalationTemplateKey: 'RECORD_ASSIGNED_FYI' },
    { event: 'COMMENT_AGENT', priority: null, statusFilter: null,
      recipients: [{ role: 'CREATOR', recipientType: 'PRIMARY' }],
      primaryTemplateKey: 'COMMENT_ADDED' },
    { event: 'COMMENT_AGENT', priority: 'P1', statusFilter: null,
      recipients: [{ role: 'COMPANY_ADMIN', recipientType: 'ESCALATION' }],
      escalationTemplateKey: 'COMMENT_ADDED_FYI' },
    { event: 'COMMENT_USER', priority: null, statusFilter: null,
      recipients: [{ role: 'ASSIGNED_AGENT', recipientType: 'PRIMARY' }],
      primaryTemplateKey: 'COMMENT_ADDED' },
    { event: 'STATUS_CHANGED', priority: null, statusFilter: 'PENDING',
      recipients: [{ role: 'CREATOR', recipientType: 'PRIMARY' }],
      primaryTemplateKey: 'STATUS_CHANGED' },
    { event: 'STATUS_CHANGED', priority: null, statusFilter: 'RESOLVED',
      recipients: [{ role: 'CREATOR', recipientType: 'PRIMARY' }],
      primaryTemplateKey: 'STATUS_CHANGED' },
    { event: 'STATUS_CHANGED', priority: null, statusFilter: 'CLOSED',
      recipients: [{ role: 'CREATOR', recipientType: 'PRIMARY' }],
      primaryTemplateKey: 'STATUS_CHANGED' },
    { event: 'STATUS_CHANGED', priority: null, statusFilter: 'OPEN',
      recipients: [{ role: 'ASSIGNED_AGENT', recipientType: 'PRIMARY' }],
      primaryTemplateKey: 'STATUS_CHANGED' },
    { event: 'STATUS_CHANGED', priority: 'P1', statusFilter: null,
      recipients: [
        { role: 'PROJECT_MANAGER', recipientType: 'ESCALATION' },
        { role: 'COMPANY_ADMIN', recipientType: 'ESCALATION' },
      ],
      escalationTemplateKey: 'STATUS_CHANGED_FYI' },
    { event: 'PRIORITY_ESCALATED_P1', priority: null, statusFilter: null,
      recipients: [
        { role: 'ASSIGNED_AGENT', recipientType: 'PRIMARY' },
        { role: 'PROJECT_MANAGER', recipientType: 'ESCALATION' },
        { role: 'COMPANY_ADMIN', recipientType: 'ESCALATION' },
      ],
      primaryTemplateKey: 'STATUS_CHANGED', escalationTemplateKey: 'STATUS_CHANGED_FYI' },
    { event: 'SLA_WARNING', priority: null, statusFilter: null,
      recipients: [{ role: 'ASSIGNED_AGENT', recipientType: 'PRIMARY' }],
      primaryTemplateKey: 'SLA_WARNING' },
    { event: 'SLA_WARNING', priority: 'P1', statusFilter: null,
      recipients: [{ role: 'PROJECT_MANAGER', recipientType: 'ESCALATION' }],
      escalationTemplateKey: 'SLA_WARNING' },
    { event: 'SLA_BREACH', priority: null, statusFilter: null,
      recipients: [
        { role: 'ASSIGNED_AGENT', recipientType: 'PRIMARY' },
        { role: 'CREATOR', recipientType: 'SECONDARY' },
      ],
      primaryTemplateKey: 'SLA_BREACH', secondaryTemplateKey: 'SLA_BREACH' },
    { event: 'SLA_BREACH', priority: 'P1', statusFilter: null,
      recipients: [
        { role: 'COMPANY_ADMIN', recipientType: 'ESCALATION' },
        { role: 'PROJECT_MANAGER', recipientType: 'ESCALATION' },
        { role: 'SUPER_ADMIN', recipientType: 'ESCALATION' },
      ],
      escalationTemplateKey: 'SLA_BREACH' },
  ];

  let count = 0;
  for (const rule of defaults) {
    const existing = await prisma.notificationRule.findFirst({
      where: { tenantId, customerId: null, event: rule.event, priority: rule.priority, statusFilter: rule.statusFilter },
    });
    if (!existing) {
      await prisma.notificationRule.create({
        data: {
          tenantId, customerId: null,
          event: rule.event, priority: rule.priority, statusFilter: rule.statusFilter,
          recipients: rule.recipients as any,
          primaryTemplateId: rule.primaryTemplateKey ? tplMap.get(rule.primaryTemplateKey) || null : null,
          secondaryTemplateId: rule.secondaryTemplateKey ? tplMap.get(rule.secondaryTemplateKey) || null : null,
          escalationTemplateId: rule.escalationTemplateKey ? tplMap.get(rule.escalationTemplateKey) || null : null,
          emailEnabled: true, inAppEnabled: true, isActive: true,
        },
      });
      count++;
    }
  }
  logger.info(`Seeded ${count} default notification rules for tenant ${tenantId}`);
  return count;
}
