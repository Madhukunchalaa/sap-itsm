import cron from 'node-cron';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { sendEmail } from '../config/mailer';
import { generateDailyStatusReport, renderDailyStatusHtml } from '../services/report.service';

/**
 * Daily Status Digest — runs every day at 08:00 IST.
 * For each active tenant, generates the daily status report and emails it.
 */
export function initDailyStatusJob() {
  if (process.env.DIGEST_ENABLED === 'false') {
    logger.info('Daily status job disabled via DIGEST_ENABLED=false');
    return;
  }
  logger.info('Initializing daily status report job (08:00 IST)...');

  cron.schedule('0 8 * * *', async () => {
    logger.info('Generating daily status reports...');
    try {
      const tenants = await prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true },
      });

      for (const tenant of tenants) {
        try {
          const report = await generateDailyStatusReport(tenant.id);

          const admins = await prisma.user.findMany({
            where: { tenantId: tenant.id, role: 'SUPER_ADMIN', status: 'ACTIVE' },
            select: { email: true },
          });
          const extra = (process.env.DIGEST_EMAILS || '')
            .split(',')
            .map(e => e.trim())
            .filter(Boolean);
          const recipients = [...new Set([...admins.map(a => a.email), ...extra])];
          
          if (recipients.length === 0) continue;

          const html = renderDailyStatusHtml(tenant.name, report);
          const subject = `📅 Daily Status Report — ${tenant.name}`;

          for (const to of recipients) {
            try {
              await sendEmail({ to, subject, html });
            } catch (err) {
              logger.error(`[DailyStatus] Failed to send to ${to}:`, err);
            }
          }
          logger.info(`[DailyStatus] Sent report for ${tenant.name} to ${recipients.length} recipient(s)`);
        } catch (err) {
          logger.error(`[DailyStatus] Failed for tenant ${tenant.name}:`, err);
        }
      }
    } catch (err) {
      logger.error('[DailyStatus] Daily status run failed:', err);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });
}

// Manual trigger for testing
export async function triggerDailyStatusManually() {
  const tenants = await prisma.tenant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true },
  });

  for (const tenant of tenants) {
    const report = await generateDailyStatusReport(tenant.id);

    const admins = await prisma.user.findMany({
      where: { tenantId: tenant.id, role: 'SUPER_ADMIN', status: 'ACTIVE' },
      select: { email: true },
    });
    const extra = (process.env.DIGEST_EMAILS || '')
      .split(',')
      .map(e => e.trim())
      .filter(Boolean);
    const recipients = [...new Set([...admins.map(a => a.email), ...extra])];
    
    if (recipients.length === 0) continue;

    const html = renderDailyStatusHtml(tenant.name, report);
    const subject = `📅 [TEST] Daily Status Report — ${tenant.name}`;

    for (const to of recipients) {
      await sendEmail({ to, subject, html });
    }
  }
}
