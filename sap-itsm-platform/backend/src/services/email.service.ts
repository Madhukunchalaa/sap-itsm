import nodemailer, { Transporter } from 'nodemailer';
import Handlebars from 'handlebars';
import { prisma } from '../config/database';
import { logger } from '../config/logger';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });

  return transporter;
}

// ── Email Templates ───────────────────────────────────────────

const TEMPLATES: Record<string, { subject: string; html: string }> = {
  RECORD_CREATED: {
    subject: '[{{priority}}] New {{recordType}} Created: {{recordNumber}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: #1a73e8;">New {{recordType}} Created</h2>
        <table style="width:100%; border-collapse: collapse;">
          <tr><td style="padding:8px; background:#f5f5f5;"><b>Record #</b></td><td>{{recordNumber}}</td></tr>
          <tr><td style="padding:8px; background:#f5f5f5;"><b>Title</b></td><td>{{title}}</td></tr>
          <tr><td style="padding:8px; background:#f5f5f5;"><b>Priority</b></td><td>{{priority}}</td></tr>
          <tr><td style="padding:8px; background:#f5f5f5;"><b>Status</b></td><td>{{status}}</td></tr>
          {{#if slaResponseDeadline}}<tr><td style="padding:8px; background:#f5f5f5;"><b>Response SLA</b></td><td>{{slaResponseDeadline}}</td></tr>{{/if}}
          {{#if slaResolutionDeadline}}<tr><td style="padding:8px; background:#f5f5f5;"><b>Resolution SLA</b></td><td>{{slaResolutionDeadline}}</td></tr>{{/if}}
        </table>
        <p>{{description}}</p>
        <a href="{{portalUrl}}/records/{{recordId}}" style="background:#1a73e8; color:white; padding:10px 20px; text-decoration:none; border-radius:4px;">View Ticket</a>
      </div>
    `,
  },
  STATUS_CHANGED: {
    subject: '{{recordNumber}} — Status Changed to {{newStatus}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2>Status Update: {{recordNumber}}</h2>
        <p>The status of <b>{{title}}</b> has been changed.</p>
        <p><b>From:</b> {{oldStatus}} → <b>To:</b> {{newStatus}}</p>
        <a href="{{portalUrl}}/records/{{recordId}}" style="background:#1a73e8; color:white; padding:10px 20px; text-decoration:none; border-radius:4px;">View Ticket</a>
      </div>
    `,
  },
  RECORD_ASSIGNED: {
    subject: 'Ticket Assigned to You: {{recordNumber}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2>You have been assigned a ticket</h2>
        <p>Hello {{agentName}},</p>
        <p>Ticket <b>{{recordNumber}}</b> — {{title}} has been assigned to you.</p>
        <p><b>Priority:</b> {{priority}}</p>
        {{#if slaResolutionDeadline}}<p><b>Resolution due:</b> {{slaResolutionDeadline}}</p>{{/if}}
        <a href="{{portalUrl}}/records/{{recordId}}" style="background:#1a73e8; color:white; padding:10px 20px; text-decoration:none; border-radius:4px;">View Ticket</a>
      </div>
    `,
  },
  COMMENT_ADDED: {
    subject: 'New Comment on {{recordNumber}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2>New Comment Added</h2>
        <p>A comment was added to <b>{{recordNumber}}</b> by {{authorName}}:</p>
        <blockquote style="border-left: 3px solid #ccc; padding-left: 16px; color: #555;">{{commentText}}</blockquote>
        <a href="{{portalUrl}}/records/{{recordId}}" style="background:#1a73e8; color:white; padding:10px 20px; text-decoration:none; border-radius:4px;">View Ticket</a>
      </div>
    `,
  },
  SLA_WARNING_RESPONSE: {
    subject: '⚠️ SLA WARNING: Response SLA at 80% — {{recordNumber}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: #f57c00;">⚠️ SLA Warning — Response Time</h2>
        <p>Ticket <b>{{recordNumber}}</b> is approaching its response SLA deadline.</p>
        <p><b>Deadline:</b> {{deadline}}</p>
        <p><b>Priority:</b> {{priority}}</p>
        <a href="{{portalUrl}}/records/{{recordId}}" style="background:#f57c00; color:white; padding:10px 20px; text-decoration:none; border-radius:4px;">Act Now</a>
      </div>
    `,
  },
  SLA_WARNING_RESOLUTION: {
    subject: '⚠️ SLA WARNING: Resolution SLA at 80% — {{recordNumber}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: #f57c00;">⚠️ SLA Warning — Resolution Time</h2>
        <p>Ticket <b>{{recordNumber}}</b> is approaching its resolution SLA deadline.</p>
        <p><b>Deadline:</b> {{deadline}}</p>
        <a href="{{portalUrl}}/records/{{recordId}}" style="background:#f57c00; color:white; padding:10px 20px; text-decoration:none; border-radius:4px;">Act Now</a>
      </div>
    `,
  },
  SLA_BREACH_RESPONSE: {
    subject: '🚨 SLA BREACHED: Response SLA Exceeded — {{recordNumber}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: #d32f2f;">🚨 SLA Breach — Response Time Exceeded</h2>
        <p>Ticket <b>{{recordNumber}}</b> has breached its response SLA.</p>
        <p><b>Priority:</b> {{priority}} | <b>Customer:</b> {{customer}}</p>
        <a href="{{portalUrl}}/records/{{recordId}}" style="background:#d32f2f; color:white; padding:10px 20px; text-decoration:none; border-radius:4px;">Escalate Now</a>
      </div>
    `,
  },
  SLA_BREACH_RESOLUTION: {
    subject: '🚨 SLA BREACHED: Resolution SLA Exceeded — {{recordNumber}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: #d32f2f;">🚨 SLA Breach — Resolution Time Exceeded</h2>
        <p>Ticket <b>{{recordNumber}}</b> has breached its resolution SLA.</p>
        <p><b>Priority:</b> {{priority}} | <b>Customer:</b> {{customer}}</p>
        <a href="{{portalUrl}}/records/{{recordId}}" style="background:#d32f2f; color:white; padding:10px 20px; text-decoration:none; border-radius:4px;">Escalate Now</a>
      </div>
    `,
  },
};

export interface SendEmailParams {
  templateKey: string;
  recipient: string;
  cc?: string[];
  variables: Record<string, unknown>;
  recordId?: string;
}

export async function sendEmail(params: SendEmailParams): Promise<void> {
  const template = TEMPLATES[params.templateKey];
  if (!template) {
    logger.warn(`Unknown email template: ${params.templateKey}`);
    return;
  }

  const subjectTpl = Handlebars.compile(template.subject);
  const bodyTpl = Handlebars.compile(template.html);

  const vars = { ...params.variables, portalUrl: process.env.PORTAL_URL || 'http://localhost:3000' };
  const subject = subjectTpl(vars);
  const html = bodyTpl(vars);

  // Log to DB first
  const log = await prisma.emailLog.create({
    data: {
      recordId: params.recordId,
      templateKey: params.templateKey,
      subject,
      recipient: params.recipient,
      cc: params.cc || [],
      body: html,
      status: 'PENDING',
    },
  });

  try {
    await getTransporter().sendMail({
      from: `"${process.env.SMTP_FROM_NAME || 'SAP ITSM'}" <${process.env.SMTP_FROM_EMAIL}>`,
      to: params.recipient,
      cc: params.cc?.join(', '),
      subject,
      html,
    });

    await prisma.emailLog.update({
      where: { id: log.id },
      data: { status: 'SENT', sentAt: new Date() },
    });
  } catch (err: any) {
    logger.error(`Email send failed for ${params.templateKey} to ${params.recipient}:`, err);
    await prisma.emailLog.update({
      where: { id: log.id },
      data: { status: 'FAILED', error: err.message, retryCount: { increment: 1 } },
    });
    throw err; // Let BullMQ handle retry
  }
}

/**
 * Process an email event job - fetch record data and send.
 */
export async function processEmailEvent(job: {
  name: string;
  data: {
    recordId: string;
    event: string;
    tenantId: string;
    agentId?: string;
    commentId?: string;
    oldStatus?: string;
    newStatus?: string;
    slaType?: string;
    deadline?: Date;
  };
}): Promise<void> {
  const { recordId, event, tenantId, agentId, oldStatus, newStatus, slaType, deadline } = job.data;

  const record = await prisma.iTSMRecord.findFirst({
    where: { id: recordId, tenantId },
    include: {
      customer: true,
      assignedAgent: {
        include: { user: { select: { email: true, firstName: true, lastName: true } } },
      },
      createdBy: { select: { email: true, firstName: true, lastName: true } },
      slaTracking: true,
    },
  });

  if (!record) {
    logger.warn(`Email job: record ${recordId} not found`);
    return;
  }

  const baseVars = {
    recordId: record.id,
    recordNumber: record.recordNumber,
    recordType: record.recordType,
    title: record.title,
    priority: record.priority,
    status: record.status,
    customer: record.customer?.companyName,
    slaResponseDeadline: record.slaTracking?.responseDeadline?.toLocaleString(),
    slaResolutionDeadline: record.slaTracking?.resolutionDeadline?.toLocaleString(),
  };

  const recipients: Array<{ email: string; extraVars?: object }> = [];

  switch (event) {
    case 'RECORD_CREATED':
      recipients.push({ email: record.createdBy.email });
      if (record.assignedAgent) {
        recipients.push({
          email: record.assignedAgent.user.email,
          extraVars: { agentName: `${record.assignedAgent.user.firstName}` },
        });
      }
      for (const r of recipients) {
        await sendEmail({ templateKey: 'RECORD_CREATED', recipient: r.email, variables: { ...baseVars, ...r.extraVars }, recordId });
      }
      break;

    case 'STATUS_CHANGED':
      if (record.createdBy.email) {
        await sendEmail({ templateKey: 'STATUS_CHANGED', recipient: record.createdBy.email, variables: { ...baseVars, oldStatus, newStatus }, recordId });
      }
      break;

    case 'RECORD_ASSIGNED':
      if (record.assignedAgent?.user.email) {
        await sendEmail({
          templateKey: 'RECORD_ASSIGNED',
          recipient: record.assignedAgent.user.email,
          variables: {
            ...baseVars,
            agentName: `${record.assignedAgent.user.firstName} ${record.assignedAgent.user.lastName}`,
          },
          recordId,
        });
      }
      break;

    case 'SLA_WARNING_RESPONSE':
    case 'SLA_WARNING_RESOLUTION':
      if (record.assignedAgent?.user.email) {
        await sendEmail({
          templateKey: event,
          recipient: record.assignedAgent.user.email,
          variables: { ...baseVars, deadline: deadline ? new Date(deadline).toLocaleString() : '' },
          recordId,
        });
      }
      break;

    case 'SLA_BREACH_RESPONSE':
    case 'SLA_BREACH_RESOLUTION':
      const breachRecipients = [record.createdBy.email];
      if (record.assignedAgent?.user.email) breachRecipients.push(record.assignedAgent.user.email);
      for (const email of breachRecipients) {
        await sendEmail({ templateKey: event, recipient: email, variables: baseVars, recordId });
      }
      break;
  }
}
