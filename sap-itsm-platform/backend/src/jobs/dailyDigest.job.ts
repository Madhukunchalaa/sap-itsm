import cron from 'node-cron';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { sendRawEmail } from '../services/email.service';
import { generateDailyStatusReport, renderDailyStatusHtml } from '../services/report.service';
import { getStatusCounts, generateStatusExcel } from '../services/statusReport.service';
import { getSubscribers, groupSubscribers } from '../services/reportSubscription.service';

/**
 * Daily Status digest — every day 08:00 IST. Three scope tiers, driven by
 * each Report Subscription's customer/plant fields:
 *   - Tenant Overall  (no customer):        tenant-wide summary, no attachment
 *   - Customer Overall (customer, no plant): that customer's summary + Excel
 *     across all its plants
 *   - Plant Status    (customer + plant):   that plant's summary + Excel
 */
function renderScopedStatusHtml(
  scopeLabel: string, counts: Record<string, number>, total: number
): string {
  const rows = Object.entries(counts)
    .map(([label, count]) =>
      `<tr><td style="padding:6px 10px; background:#f5f5f5;"><b>${label}</b></td><td style="padding:6px 10px;">${count}</td></tr>`
    )
    .join('');

  return `
    <div style="font-family: Arial, sans-serif; max-width: 640px;">
      <h2 style="color: #1a73e8;">📊 ${scopeLabel} — Daily Status Report</h2>
      <p>Ticket status summary as of ${new Date().toLocaleDateString()}.</p>
      <table style="width:100%; border-collapse: collapse; margin: 12px 0; border: 1px solid #ddd;">
        <tr style="background:#f1f3f4; color:#333;">
          <th style="padding:6px 10px; text-align:left;">Status</th>
          <th style="padding:6px 10px; text-align:left;">Count</th>
        </tr>
        ${rows}
        <tr><td style="padding:6px 10px;"><b>Total</b></td><td style="padding:6px 10px;"><b>${total}</b></td></tr>
      </table>
      <p style="color:#555;">See the attached Excel for the full ticket-level list (Tickets sheet) and a color-coded summary (Summary sheet).</p>
      <p style="color:#999; font-size:12px; margin-top:16px;">Generated automatically by the ITSM reporting engine.</p>
    </div>
  `;
}

async function sendScoped(recipients: string[], subject: string, html: string, attachments?: any[]) {
  for (const to of recipients) {
    try { await sendRawEmail({ to, subject, html, attachments }); }
    catch (err) { logger.error(`[DailyDigest] Failed to send to ${to}:`, err); }
  }
}

async function runDailyDigest() {
  const tenants = await prisma.tenant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true },
  });

  for (const tenant of tenants) {
    try {
      const subs = await getSubscribers(tenant.id, 'daily');
      const { tenantWide, byCustomer, byPlant } = groupSubscribers(subs);

      // ── Tenant Overall ─────────────────────────────────────
      if (tenantWide.length > 0) {
        const report = await generateDailyStatusReport(tenant.id);
        const html = renderDailyStatusHtml(tenant.name, report);
        await sendScoped(tenantWide, `📅 Daily Status Report — ${tenant.name}`, html);
        logger.info(`[DailyDigest] Sent Tenant Overall for ${tenant.name} to ${tenantWide.length} recipient(s)`);
      }

      // ── Customer Overall ───────────────────────────────────
      for (const [customerId, emails] of byCustomer) {
        try {
          const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { companyName: true } });
          if (!customer) continue;
          const scopeLabel = `${tenant.name} — ${customer.companyName}`;

          const [{ counts, total }, excelBuffer] = await Promise.all([
            getStatusCounts(tenant.id, { customerId }),
            generateStatusExcel(tenant.id, { customerId }, scopeLabel),
          ]);
          const html = renderScopedStatusHtml(scopeLabel, counts, total);
          const attachments = [{
            filename: `Status-Report-${customer.companyName.replace(/[^a-z0-9]+/gi, '-')}-${new Date().toISOString().split('T')[0]}.xlsx`,
            content: excelBuffer,
          }];
          await sendScoped(emails, `📅 Daily Status Report — ${customer.companyName} (${tenant.name})`, html, attachments);
          logger.info(`[DailyDigest] Sent Customer Overall (${customer.companyName}) for ${tenant.name} to ${emails.length} recipient(s)`);
        } catch (err) {
          logger.error(`[DailyDigest] Customer Overall failed for customer ${customerId} (tenant ${tenant.name}):`, err);
        }
      }

      // ── Plant Status ───────────────────────────────────────
      for (const [, { customerId, plant, emails }] of byPlant) {
        try {
          const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { companyName: true } });
          if (!customer) continue;
          const scopeLabel = `${tenant.name} — ${customer.companyName} / ${plant}`;

          const [{ counts, total }, excelBuffer] = await Promise.all([
            getStatusCounts(tenant.id, { customerId, plant }),
            generateStatusExcel(tenant.id, { customerId, plant }, scopeLabel),
          ]);
          const html = renderScopedStatusHtml(scopeLabel, counts, total);
          const attachments = [{
            filename: `Status-Report-${plant.replace(/[^a-z0-9]+/gi, '-')}-${new Date().toISOString().split('T')[0]}.xlsx`,
            content: excelBuffer,
          }];
          await sendScoped(emails, `📅 Daily Status Report — ${plant} (${customer.companyName})`, html, attachments);
          logger.info(`[DailyDigest] Sent Plant Status (${plant}) for ${tenant.name} to ${emails.length} recipient(s)`);
        } catch (err) {
          logger.error(`[DailyDigest] Plant Status failed for ${plant} (tenant ${tenant.name}):`, err);
        }
      }
    } catch (err) {
      logger.error(`[DailyDigest] Run failed for ${tenant.name}:`, err);
    }
  }
}

export function initDailyDigestJob() {
  if (process.env.DAILY_STATUS_ENABLED === 'false') {
    logger.info('Daily digest job disabled via DAILY_STATUS_ENABLED=false');
    return;
  }
  logger.info('Initializing daily status digest job (08:00 IST)...');

  cron.schedule('0 8 * * *', async () => {
    logger.info('Generating daily status digests...');
    try {
      await runDailyDigest();
    } catch (err) {
      logger.error('[DailyDigest] Daily run failed:', err);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });
}

// Manual trigger for testing
export async function triggerDailyDigestManually() {
  await runDailyDigest();
}
