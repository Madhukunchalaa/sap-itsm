import cron from 'node-cron';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { sendEmail } from '../config/mailer';
import { getActiveHeadEmailsForPlant, getDistinctPlants } from '../services/plantHeadEmail.service';
import { getPlantStatusCounts, generatePlantStatusExcel } from '../services/plantStatusReport.service';

/**
 * Daily Plant Status Digest — runs every day at 08:00 IST.
 * For each active tenant and each plant that has configured head emails,
 * sends a status-count summary (Open/In Progress, Awaiting Customer, In UAT,
 * Hold, Resolved/Closed) with a ticket-level Excel attachment to that
 * plant's configured heads.
 */
function renderPlantStatusHtml(
  tenantName: string, plant: string, counts: Record<string, number>, total: number
): string {
  const rows = Object.entries(counts)
    .map(([label, count]) =>
      `<tr><td style="padding:6px 10px; background:#f5f5f5;"><b>${label}</b></td><td style="padding:6px 10px;">${count}</td></tr>`
    )
    .join('');

  return `
    <div style="font-family: Arial, sans-serif; max-width: 640px;">
      <h2 style="color: #1a73e8;">📊 ${tenantName} — ${plant} — Daily Status Report</h2>
      <p>Ticket status summary for plant <b>${plant}</b> as of ${new Date().toLocaleDateString()}.</p>
      <table style="width:100%; border-collapse: collapse; margin: 12px 0; border: 1px solid #ddd;">
        <tr style="background:#f1f3f4; color:#333;">
          <th style="padding:6px 10px; text-align:left;">Status</th>
          <th style="padding:6px 10px; text-align:left;">Count</th>
        </tr>
        ${rows}
        <tr><td style="padding:6px 10px;"><b>Total</b></td><td style="padding:6px 10px;"><b>${total}</b></td></tr>
      </table>
      <p style="color:#555;">See the attached Excel for the full ticket-level list.</p>
      <p style="color:#999; font-size:12px; margin-top:16px;">Generated automatically by the ITSM reporting engine.</p>
    </div>
  `;
}

async function runPlantStatusReports() {
  const tenants = await prisma.tenant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true },
  });

  for (const tenant of tenants) {
    try {
      const plants = await getDistinctPlants(tenant.id);

      for (const plant of plants) {
        try {
          const recipients = await getActiveHeadEmailsForPlant(tenant.id, plant);
          if (recipients.length === 0) continue;

          const [{ counts, total }, excelBuffer] = await Promise.all([
            getPlantStatusCounts(tenant.id, plant),
            generatePlantStatusExcel(tenant.id, plant),
          ]);

          const html = renderPlantStatusHtml(tenant.name, plant, counts, total);
          const subject = `📅 Daily Status Report — ${plant} (${tenant.name})`;
          const attachments = [{
            name: `Status-Report-${plant.replace(/[^a-z0-9]+/gi, '-')}-${new Date().toISOString().split('T')[0]}.xlsx`,
            contentBase64: excelBuffer.toString('base64'),
          }];

          for (const to of recipients) {
            try {
              await sendEmail({ to, subject, html, attachments });
            } catch (err) {
              logger.error(`[PlantStatus] Failed to send to ${to}:`, err);
            }
          }
          logger.info(`[PlantStatus] Sent report for ${tenant.name} / ${plant} to ${recipients.length} recipient(s)`);
        } catch (err) {
          logger.error(`[PlantStatus] Failed for plant ${plant} (tenant ${tenant.name}):`, err);
        }
      }
    } catch (err) {
      logger.error(`[PlantStatus] Failed for tenant ${tenant.name}:`, err);
    }
  }
}

export function initDailyStatusJob() {
  if (process.env.DIGEST_ENABLED === 'false') {
    logger.info('Daily status job disabled via DIGEST_ENABLED=false');
    return;
  }
  logger.info('Initializing daily plant status report job (08:00 IST)...');

  cron.schedule('0 8 * * *', async () => {
    logger.info('Generating daily plant status reports...');
    try {
      await runPlantStatusReports();
    } catch (err) {
      logger.error('[PlantStatus] Daily status run failed:', err);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });
}

// Manual trigger for testing
export async function triggerDailyStatusManually() {
  await runPlantStatusReports();
}
