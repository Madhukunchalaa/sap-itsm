import nodemailer, { Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

function createTransporter(): Transporter {
  const host   = process.env.SMTP_HOST     || 'smtp.gmail.com';
  const port   = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE === 'true';
  const user   = process.env.SMTP_USER     || '';
  const pass   = process.env.SMTP_PASS     || '';

  if (!user || !pass) {
    console.log('[mailer] WARNING: SMTP_USER or SMTP_PASS not configured — emails will not be sent');
  }

  console.log(`[mailer] Creating transporter: host=${host} port=${port} secure=${secure} user=${user}`);

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000,   // 10s to establish connection
    greetingTimeout: 10000,     // 10s for server greeting
    socketTimeout: 15000,       // 15s idle socket timeout
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
  console.log(`[mailer] sendMail → to=${options.to} subject="${options.subject}"`);
  try {
    const info = await mailer.sendMail({
      from: FROM_ADDRESS,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    console.log(`[mailer] ✓ sendMail SUCCESS messageId=${info.messageId}`);
    return { messageId: info.messageId };
  } catch (err: any) {
    console.log(`[mailer] ✗ sendMail FAILED: ${err?.message || err}`);
    throw err;
  }
}
