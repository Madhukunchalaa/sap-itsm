import cron from 'node-cron';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { sendRawEmail } from '../services/email.service';
import { generateOverallReport, renderDigestHtml } from '../services/report.service';
import { getSubscribers, groupSubscribers } from '../services/reportSubscription.service';

/**
 * Monthly service-desk digest — 1st of the month, 08:00 IST. Same shape and
 * three scope tiers as Weekly, with period='month' (volumes vs. previous
 * month, SLA compliance, agent performance, hotspots).
 */
async function sendScoped(recipients: string[], subject: string, html: string) {
  for (const to of recipients) {
    try { await sendRawEmail({ to, subject, html }); }
    catch (err) { logger.error(`[MonthlyDigest] Failed to send to ${to}:`, err); }
  }
}

async function runMonthlyDigest() {
  const tenants = await prisma.tenant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true },
  });

  for (const tenant of tenants) {
    try {
      const subs = await getSubscribers(tenant.id, 'monthly');
      const { tenantWide, byCustomer, byPlant } = groupSubscribers(subs);

      // ── Tenant Overall ─────────────────────────────────────
      if (tenantWide.length > 0) {
        const report = await generateOverallReport(tenant.id, 'month');
        if (report.volumes.created > 0 || report.volumes.resolved > 0) {
          const html = renderDigestHtml(tenant.name, report);
          await sendScoped(tenantWide, `📈 Monthly Service Desk Report — ${tenant.name}`, html);
          logger.info(`[MonthlyDigest] Sent Tenant Overall monthly for ${tenant.name} to ${tenantWide.length} recipient(s)`);
        }
      }

      // ── Customer Overall ───────────────────────────────────
      for (const [customerId, emails] of byCustomer) {
        try {
          const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { companyName: true } });
          if (!customer) continue;
          const report = await generateOverallReport(tenant.id, 'month', [customerId]);
          if (report.volumes.created === 0 && report.volumes.resolved === 0) continue;
          const html = renderDigestHtml(`${tenant.name} — ${customer.companyName}`, report);
          await sendScoped(emails, `📈 Monthly Service Desk Report — ${customer.companyName} (${tenant.name})`, html);
          logger.info(`[MonthlyDigest] Sent Customer Overall monthly (${customer.companyName}) for ${tenant.name} to ${emails.length} recipient(s)`);
        } catch (err) {
          logger.error(`[MonthlyDigest] Customer Overall monthly failed for customer ${customerId} (tenant ${tenant.name}):`, err);
        }
      }

      // ── Plant Status ───────────────────────────────────────
      for (const [, { customerId, plant, emails }] of byPlant) {
        try {
          const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { companyName: true } });
          if (!customer) continue;
          const report = await generateOverallReport(tenant.id, 'month', [customerId], plant);
          if (report.volumes.created === 0 && report.volumes.resolved === 0) continue;
          const html = renderDigestHtml(`${tenant.name} — ${customer.companyName} / ${plant}`, report);
          await sendScoped(emails, `📈 Monthly Service Desk Report — ${plant} (${customer.companyName})`, html);
          logger.info(`[MonthlyDigest] Sent Plant Status monthly (${plant}) for ${tenant.name} to ${emails.length} recipient(s)`);
        } catch (err) {
          logger.error(`[MonthlyDigest] Plant Status monthly failed for ${plant} (tenant ${tenant.name}):`, err);
        }
      }
    } catch (err) {
      logger.error(`[MonthlyDigest] Monthly run failed for ${tenant.name}:`, err);
    }
  }
}

export function initMonthlyDigestJob() {
  if (process.env.DIGEST_ENABLED === 'false') {
    logger.info('Monthly digest job disabled via DIGEST_ENABLED=false');
    return;
  }
  logger.info('Initializing monthly report digest job (1st of month, 08:00 IST)...');

  cron.schedule('0 8 1 * *', async () => {
    logger.info('Generating monthly report digests...');
    try {
      await runMonthlyDigest();
    } catch (err) {
      logger.error('[MonthlyDigest] Monthly digest run failed:', err);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });
}

// Manual trigger for testing
export async function triggerMonthlyDigestManually() {
  await runMonthlyDigest();
}
