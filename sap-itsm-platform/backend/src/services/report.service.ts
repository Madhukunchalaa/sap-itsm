import { Prisma, RecordStatus } from '@prisma/client';
import { prisma } from '../config/database';

// ─────────────────────────────────────────────────────────────
// Report Service — overall service-desk report
//
// Pure SQL aggregation + a template-based narrative. No LLM, no
// API key. Used by GET /reports/overall, the chat assistant's
// get_overall_report tool, and the scheduled weekly digest.
// ─────────────────────────────────────────────────────────────

const OPEN_STATUSES: RecordStatus[] = [
  'NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'AWAITING_CUSTOMER', 'WITH_SAP', 'REOPEN',
];

export type ReportPeriod = 'week' | 'month';

export interface OverallReport {
  period: { label: string; from: string; to: string };
  volumes: {
    created: number;
    createdPreviousPeriod: number;
    deltaPct: number | null;
    resolved: number;
    openBacklog: number;
    byType: Array<{ key: string; count: number }>;
    byPriority: Array<{ key: string; count: number }>;
    byStatus: Array<{ key: string; count: number }>;
  };
  sla: {
    tracked: number;
    breachedResponse: number;
    breachedResolution: number;
    complianceRate: number | null; // 0..1
  };
  performance: {
    avgResolutionHours: number | null;
    agents: Array<{ agentName: string; level: string; resolved: number; avgResolutionHours: number | null }>;
  };
  hotspots: {
    topModules: Array<{ code: string; name: string; count: number }>;
    topCustomers: Array<{ companyName: string; count: number }>;
  };
  narrative: string;
}

export interface DailyStatusReport {
  date: string;
  cumulative: {
    totalResolved: number;
    totalOpenBacklog: number;
    byStatus: Array<{ key: string; count: number }>;
  };
  today: {
    created: number;
    resolved: number;
  };
}

function periodWindow(period: ReportPeriod) {
  const to = new Date();
  const from = new Date(to);
  const previousFrom = new Date(to);
  if (period === 'week') {
    from.setDate(from.getDate() - 7);
    previousFrom.setDate(previousFrom.getDate() - 14);
  } else {
    from.setDate(from.getDate() - 30);
    previousFrom.setDate(previousFrom.getDate() - 60);
  }
  return { from, to, previousFrom, previousTo: from };
}

function groupToList(groups: Array<{ [k: string]: any; _count: number }>, key: string) {
  return groups
    .map(g => ({ key: String(g[key]), count: g._count }))
    .sort((a, b) => b.count - a.count);
}

function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function buildNarrative(r: Omit<OverallReport, 'narrative'>): string {
  const lines: string[] = [];
  const p = r.period.label;

  let trend = '';
  if (r.volumes.deltaPct !== null) {
    trend = r.volumes.deltaPct > 10 ? ` — up ${r.volumes.deltaPct}% vs the previous ${p}`
      : r.volumes.deltaPct < -10 ? ` — down ${Math.abs(r.volumes.deltaPct)}% vs the previous ${p}`
      : ` — roughly flat vs the previous ${p}`;
  }
  lines.push(`${r.volumes.created} ticket${r.volumes.created === 1 ? ' was' : 's were'} created this ${p}${trend}. ${r.volumes.resolved} ${r.volumes.resolved === 1 ? 'was' : 'were'} resolved, leaving ${r.volumes.openBacklog} open in the backlog.`);

  if (r.sla.tracked > 0 && r.sla.complianceRate !== null) {
    const pct = Math.round(r.sla.complianceRate * 100);
    const breaches = r.sla.breachedResponse + r.sla.breachedResolution;
    lines.push(
      pct >= 95 ? `SLA compliance is healthy at ${pct}%.`
      : pct >= 85 ? `SLA compliance is ${pct}% (${breaches} breach${breaches === 1 ? '' : 'es'}) — worth watching.`
      : `⚠️ SLA compliance is low at ${pct}% with ${breaches} breach${breaches === 1 ? '' : 'es'} — needs attention.`
    );
  }

  if (r.performance.avgResolutionHours !== null) {
    lines.push(`Average resolution time was ${r.performance.avgResolutionHours}h.`);
  }

  const topMod = r.hotspots.topModules[0];
  if (topMod) lines.push(`Hottest area: ${topMod.code} (${topMod.name}) with ${topMod.count} tickets.`);

  const topAgent = r.performance.agents[0];
  if (topAgent) lines.push(`Top resolver: ${topAgent.agentName} (${topAgent.level}) with ${topAgent.resolved} tickets resolved.`);

  const p1 = r.volumes.byPriority.find(x => x.key === 'P1');
  if (p1 && p1.count > 0) lines.push(`${p1.count} P1 ticket${p1.count === 1 ? '' : 's'} came in this ${p}.`);

  return lines.join(' ');
}

export async function generateOverallReport(
  tenantId: string,
  period: ReportPeriod = 'week',
  customerIds?: string[]
): Promise<OverallReport> {
  const { from, to, previousFrom, previousTo } = periodWindow(period);

  const scope: Prisma.ITSMRecordWhereInput = {
    tenantId,
    ...(customerIds?.length ? { customerId: { in: customerIds } } : {}),
  };
  const createdInWindow: Prisma.ITSMRecordWhereInput = { ...scope, createdAt: { gte: from, lt: to } };
  const resolvedInWindow: Prisma.ITSMRecordWhereInput = { ...scope, resolvedAt: { gte: from, lt: to } };

  const [
    created,
    createdPrev,
    byType,
    byPriority,
    byStatus,
    byModule,
    byCustomer,
    openBacklog,
    slaTracked,
    breachedResponse,
    breachedResolution,
    resolvedRows,
  ] = await Promise.all([
    prisma.iTSMRecord.count({ where: createdInWindow }),
    prisma.iTSMRecord.count({ where: { ...scope, createdAt: { gte: previousFrom, lt: previousTo } } }),
    prisma.iTSMRecord.groupBy({ by: ['recordType'], where: createdInWindow, _count: true }),
    prisma.iTSMRecord.groupBy({ by: ['priority'], where: createdInWindow, _count: true }),
    prisma.iTSMRecord.groupBy({ by: ['status'], where: createdInWindow, _count: true }),
    prisma.iTSMRecord.groupBy({ by: ['sapModuleId'], where: { ...createdInWindow, sapModuleId: { not: null } }, _count: true }),
    prisma.iTSMRecord.groupBy({ by: ['customerId'], where: { ...createdInWindow, customerId: { not: null } }, _count: true }),
    prisma.iTSMRecord.count({ where: { ...scope, status: { in: OPEN_STATUSES } } }),
    prisma.sLATracking.count({ where: { record: createdInWindow } }),
    prisma.sLATracking.count({ where: { record: createdInWindow, breachResponse: true } }),
    prisma.sLATracking.count({ where: { record: createdInWindow, breachResolution: true } }),
    prisma.iTSMRecord.findMany({
      where: resolvedInWindow,
      select: {
        createdAt: true,
        resolvedAt: true,
        assignedAgent: {
          select: { level: true, user: { select: { firstName: true, lastName: true } } },
        },
      },
      take: 5000,
    }),
  ]);

  // Resolution performance
  const durations = resolvedRows
    .filter(r => r.resolvedAt)
    .map(r => hoursBetween(r.createdAt, r.resolvedAt!));
  const avgResolutionHours = durations.length
    ? round1(durations.reduce((s, d) => s + d, 0) / durations.length)
    : null;

  // Per-agent performance
  const agentMap = new Map<string, { agentName: string; level: string; resolved: number; totalHours: number }>();
  for (const r of resolvedRows) {
    if (!r.assignedAgent || !r.resolvedAt) continue;
    const name = `${r.assignedAgent.user.firstName} ${r.assignedAgent.user.lastName || ''}`.trim();
    const entry = agentMap.get(name) || { agentName: name, level: r.assignedAgent.level, resolved: 0, totalHours: 0 };
    entry.resolved += 1;
    entry.totalHours += hoursBetween(r.createdAt, r.resolvedAt);
    agentMap.set(name, entry);
  }
  const agents = [...agentMap.values()]
    .sort((a, b) => b.resolved - a.resolved)
    .slice(0, 5)
    .map(a => ({
      agentName: a.agentName,
      level: a.level,
      resolved: a.resolved,
      avgResolutionHours: a.resolved ? round1(a.totalHours / a.resolved) : null,
    }));

  // Hotspots — resolve ids to names
  const topModuleGroups = (byModule as any[]).sort((a, b) => b._count - a._count).slice(0, 5);
  const moduleIds = topModuleGroups.map(g => g.sapModuleId).filter(Boolean) as string[];
  const modules = moduleIds.length
    ? await prisma.sAPModuleMaster.findMany({ where: { id: { in: moduleIds } }, select: { id: true, code: true, name: true } })
    : [];
  const topModules = topModuleGroups.map(g => {
    const m = modules.find(x => x.id === g.sapModuleId);
    return { code: m?.code || '?', name: m?.name || 'Unknown', count: g._count };
  });

  const topCustomerGroups = (byCustomer as any[]).sort((a, b) => b._count - a._count).slice(0, 5);
  const customerIdList = topCustomerGroups.map(g => g.customerId).filter(Boolean) as string[];
  const customers = customerIdList.length
    ? await prisma.customer.findMany({ where: { id: { in: customerIdList } }, select: { id: true, companyName: true } })
    : [];
  const topCustomers = topCustomerGroups.map(g => ({
    companyName: customers.find(x => x.id === g.customerId)?.companyName || 'Unknown',
    count: g._count,
  }));

  const resolved = resolvedRows.length;
  const deltaPct = createdPrev > 0 ? Math.round(((created - createdPrev) / createdPrev) * 100) : null;
  const totalBreaches = breachedResponse + breachedResolution;
  const complianceRate = slaTracked > 0
    ? Math.max(0, Math.round((1 - totalBreaches / slaTracked) * 1000) / 1000)
    : null;

  const base: Omit<OverallReport, 'narrative'> = {
    period: { label: period, from: from.toISOString(), to: to.toISOString() },
    volumes: {
      created,
      createdPreviousPeriod: createdPrev,
      deltaPct,
      resolved,
      openBacklog,
      byType: groupToList(byType as any, 'recordType'),
      byPriority: groupToList(byPriority as any, 'priority'),
      byStatus: groupToList(byStatus as any, 'status'),
    },
    sla: { tracked: slaTracked, breachedResponse, breachedResolution, complianceRate },
    performance: { avgResolutionHours, agents },
    hotspots: { topModules, topCustomers },
  };

  return { ...base, narrative: buildNarrative(base) };
}

export async function generateDailyStatusReport(tenantId: string): Promise<DailyStatusReport> {
  const now = new Date();
  
  // Start of today (00:00:00)
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  
  // End of today (23:59:59.999)
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const scope: Prisma.ITSMRecordWhereInput = { tenantId };

  const [
    totalResolved,
    totalOpenBacklog,
    byStatus,
    createdToday,
    resolvedToday,
  ] = await Promise.all([
    // All-time resolved
    prisma.iTSMRecord.count({ where: { ...scope, status: 'RESOLVED' } }),
    // All-time pending/open
    prisma.iTSMRecord.count({ where: { ...scope, status: { in: OPEN_STATUSES } } }),
    // Current counts grouped by all statuses
    prisma.iTSMRecord.groupBy({ by: ['status'], where: scope, _count: true }),
    // Created today
    prisma.iTSMRecord.count({ where: { ...scope, createdAt: { gte: todayStart, lte: todayEnd } } }),
    // Resolved today
    prisma.iTSMRecord.count({ where: { ...scope, resolvedAt: { gte: todayStart, lte: todayEnd } } }),
  ]);

  return {
    date: todayStart.toISOString().split('T')[0],
    cumulative: {
      totalResolved,
      totalOpenBacklog,
      byStatus: groupToList(byStatus as any, 'status'),
    },
    today: {
      created: createdToday,
      resolved: resolvedToday,
    }
  };
}

// ── HTML rendering for the emailed digest ────────────────────

function tableRows(rows: Array<[string, string | number]>): string {
  return rows
    .map(([k, v]) => `<tr><td style="padding:6px 10px; background:#f5f5f5;"><b>${k}</b></td><td style="padding:6px 10px;">${v}</td></tr>`)
    .join('');
}

export function renderDigestHtml(tenantName: string, r: OverallReport): string {
  const compliance = r.sla.complianceRate !== null ? `${Math.round(r.sla.complianceRate * 100)}%` : 'n/a';
  const priorities = r.volumes.byPriority.map(p => `${p.key}: ${p.count}`).join(' | ') || '—';
  const modules = r.hotspots.topModules.map(m => `${m.code} (${m.count})`).join(', ') || '—';
  const agentRows = r.performance.agents
    .map(a => `<tr><td style="padding:6px 10px;">${a.agentName} (${a.level})</td><td style="padding:6px 10px; text-align:center;">${a.resolved}</td><td style="padding:6px 10px; text-align:center;">${a.avgResolutionHours ?? '—'}h</td></tr>`)
    .join('');

  return `
    <div style="font-family: Arial, sans-serif; max-width: 640px;">
      <h2 style="color: #1a73e8;">📊 ${tenantName} — ${r.period.label === 'week' ? 'Weekly' : 'Monthly'} Service Desk Report</h2>
      <p style="color:#444; line-height:1.5;">${r.narrative}</p>
      <table style="width:100%; border-collapse: collapse; margin: 12px 0;">
        ${tableRows([
          ['Tickets created', r.volumes.created],
          ['Tickets resolved', r.volumes.resolved],
          ['Open backlog', r.volumes.openBacklog],
          ['SLA compliance', compliance],
          ['Avg resolution', r.performance.avgResolutionHours !== null ? `${r.performance.avgResolutionHours}h` : '—'],
          ['By priority', priorities],
          ['Top modules', modules],
        ])}
      </table>
      ${agentRows ? `
      <h3 style="color:#333;">Agent performance</h3>
      <table style="width:100%; border-collapse: collapse;">
        <tr style="background:#1a73e8; color:white;">
          <th style="padding:6px 10px; text-align:left;">Agent</th>
          <th style="padding:6px 10px;">Resolved</th>
          <th style="padding:6px 10px;">Avg time</th>
        </tr>
        ${agentRows}
      </table>` : ''}
      <p style="color:#999; font-size:12px; margin-top:16px;">Generated automatically by the ITSM reporting engine.</p>
    </div>
  `;
}

export function renderDailyStatusHtml(tenantName: string, r: DailyStatusReport): string {
  const statusRows = r.cumulative.byStatus
    .map(s => `<tr><td style="padding:6px 10px; background:#f5f5f5;"><b>${s.key}</b></td><td style="padding:6px 10px;">${s.count}</td></tr>`)
    .join('');

  return `
    <div style="font-family: Arial, sans-serif; max-width: 640px;">
      <h2 style="color: #1a73e8;">📊 ${tenantName} — Daily Status Report (${r.date})</h2>
      
      <h3 style="color:#333; margin-top: 20px;">Today's Activity</h3>
      <table style="width:100%; border-collapse: collapse; margin: 12px 0;">
        <tr><td style="padding:6px 10px; background:#e8f0fe;"><b>Tickets Created Today</b></td><td style="padding:6px 10px; background:#e8f0fe;">${r.today.created}</td></tr>
        <tr><td style="padding:6px 10px; background:#e8f0fe;"><b>Tickets Resolved Today</b></td><td style="padding:6px 10px; background:#e8f0fe;">${r.today.resolved}</td></tr>
      </table>

      <h3 style="color:#333; margin-top: 24px;">Cumulative Summary (All-Time)</h3>
      <table style="width:100%; border-collapse: collapse; margin: 12px 0;">
        <tr><td style="padding:6px 10px; background:#fce8e6; color:#c5221f;"><b>Total Pending / Open Backlog</b></td><td style="padding:6px 10px; background:#fce8e6; color:#c5221f;"><b>${r.cumulative.totalOpenBacklog}</b></td></tr>
        <tr><td style="padding:6px 10px; background:#e6f4ea; color:#137333;"><b>Total Resolved</b></td><td style="padding:6px 10px; background:#e6f4ea; color:#137333;"><b>${r.cumulative.totalResolved}</b></td></tr>
      </table>

      <h3 style="color:#333; margin-top: 24px;">Breakdown by Status</h3>
      <table style="width:100%; border-collapse: collapse; margin: 12px 0; border: 1px solid #ddd;">
        <tr style="background:#f1f3f4; color:#333;">
          <th style="padding:6px 10px; text-align:left;">Status</th>
          <th style="padding:6px 10px; text-align:left;">Count</th>
        </tr>
        ${statusRows}
      </table>
      
      <p style="color:#999; font-size:12px; margin-top:16px;">Generated automatically by the ITSM reporting engine.</p>
    </div>
  `;
}
