import https from 'https';

export const FROM_ADDRESS = `"${process.env.SMTP_FROM_NAME || 'Service Desk'}" <${process.env.SMTP_FROM_EMAIL || 'noreply@example.com'}>`;

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ messageId: string }> {
  const apiKey = process.env.BREVO_API_KEY || '';
  if (!apiKey) throw new Error('BREVO_API_KEY is not set');

  const fromName = process.env.SMTP_FROM_NAME || 'Service Desk';
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'noreply@example.com';

  const body = JSON.stringify({
    sender: { name: fromName, email: fromEmail },
    to: [{ email: options.to }],
    subject: options.subject,
    htmlContent: options.html,
  });

  console.log(`[mailer] sendMail via Brevo HTTP API → to=${options.to} subject="${options.subject}"`);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          const parsed = JSON.parse(data);
          console.log(`[mailer] ✓ sendMail SUCCESS messageId=${parsed.messageId}`);
          resolve({ messageId: parsed.messageId || '' });
        } else {
          console.log(`[mailer] ✗ sendMail FAILED status=${res.statusCode} body=${data}`);
          reject(new Error(`Brevo API error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      console.log(`[mailer] ✗ sendMail FAILED: ${err.message}`);
      reject(err);
    });

    req.setTimeout(15000, () => {
      req.destroy(new Error('Request timeout'));
    });

    req.write(body);
    req.end();
  });
}
