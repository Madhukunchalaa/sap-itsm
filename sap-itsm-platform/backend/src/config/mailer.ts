import nodemailer, { Transporter } from 'nodemailer';
import { logger } from './logger';

let transporter: Transporter | null = null;

function createTransporter(): Transporter {
  const host   = process.env.SMTP_HOST     || 'smtp.gmail.com';
  const port   = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE === 'true';
  const user   = process.env.SMTP_USER     || '';
  const pass   = process.env.SMTP_PASS     || '';

  if (!user || !pass) {
    logger.warn('[mailer] SMTP_USER or SMTP_PASS not configured — emails will not be sent');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

export function getMailer(): Transporter {
  if (!transporter) {
    transporter = createTransporter();
  }
  return transporter;
}

export const FROM_ADDRESS =
  `"${process.env.SMTP_FROM_NAME || 'Service Desk'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'noreply@example.com'}>`;

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ messageId: string }> {
  const mailer = getMailer();
  const info = await mailer.sendMail({
    from: FROM_ADDRESS,
    to: options.to,
    subject: options.subject,
    html: options.html,
  });
  return { messageId: info.messageId };
}
