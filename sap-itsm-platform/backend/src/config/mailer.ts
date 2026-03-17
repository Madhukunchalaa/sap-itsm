import { Resend } from 'resend';

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY || '';
    if (!apiKey) {
      console.log('[mailer] WARNING: RESEND_API_KEY not set — emails will not be sent');
    }
    console.log(`[mailer] Initializing Resend client (key set: ${!!apiKey})`);
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

export const FROM_ADDRESS =
  `${process.env.SMTP_FROM_NAME || 'Service Desk'} <${process.env.SMTP_FROM_EMAIL || 'onboarding@resend.dev'}>`;

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ messageId: string }> {
  const client = getResend();
  console.log(`[mailer] sendMail → to=${options.to} subject="${options.subject}"`);
  try {
    const { data, error } = await client.emails.send({
      from: FROM_ADDRESS,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    if (error) {
      console.log(`[mailer] ✗ sendMail FAILED: ${error.message}`);
      throw new Error(error.message);
    }
    console.log(`[mailer] ✓ sendMail SUCCESS id=${data?.id}`);
    return { messageId: data?.id || '' };
  } catch (err: any) {
    console.log(`[mailer] ✗ sendMail FAILED: ${err?.message || err}`);
    throw err;
  }
}
