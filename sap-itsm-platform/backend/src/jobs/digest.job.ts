import cron from 'node-cron';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { sendRawEmail } from '../services/email.service';
import { generateOverallReport, renderDigestHtml } from '../services/report.service';

/**
 * Weekly service-desk digest — every Monday 08:00 IST.
 * For each active tenant: generate the overall report and email it
 * to SUPER_ADMIN users (plus DIGEST_EMAILS env override if set).
 * Set DIGEST_ENABLED=false to turn off.
 */
export function initDigestJob() {
  if (process.env.DIGEST_ENABLED === 'false') {
    logger.info('Weekly digest job disabled via DIGEST_ENABLED=false');
    return;
  }
  logger.info('Initializing weekly report digest job (Mondays 08:00 IST)...');

  cron.schedule('0 8 * * 1', async () => {
    logger.info('Generating weekly report digests...');
    try {
      const tenants = await prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true },
      });

      for (const tenant of tenants) {
        try {
          const report = await generateOverallReport(tenant.id, 'week');
          // Skip empty weeks — no noise for inactive tenants
          if (report.volumes.created === 0 && report.volumes.resolved === 0) continue;

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

          const html = renderDigestHtml(tenant.name, report);
          const subject = `📊 Weekly Service Desk Report — ${tenant.name}`;

          for (const to of recipients) {
            try {
              await sendRawEmail({ to, subject, html });
            } catch (err) {
              logger.error(`[Digest] Failed to send to ${to}:`, err);
            }
          }
          logger.info(`[Digest] Sent weekly report for ${tenant.name} to ${recipients.length} recipient(s)`);
        } catch (err) {
          logger.error(`[Digest] Failed for tenant ${tenant.name}:`, err);
        }
      }
    } catch (err) {
      logger.error('[Digest] Weekly digest run failed:', err);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });
}
