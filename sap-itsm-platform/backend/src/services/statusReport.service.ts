import ExcelJS from 'exceljs';
import { prisma } from '../config/database';

// Status buckets used across the daily status digest (email body + Excel).
const STATUS_GROUPS: { statuses: string[]; label: string; argb: string }[] = [
  { statuses: ['OPEN', 'IN_PROGRESS'], label: 'Open/In Progress', argb: 'FF6366F1' },   // indigo
  { statuses: ['AWAITING_CUSTOMER'], label: 'Awaiting Customer', argb: 'FFF97316' },     // orange
  { statuses: ['IN_UAT'], label: 'In UAT', argb: 'FF14B8A6' },                           // teal
  { statuses: ['HOLD'], label: 'Hold', argb: 'FFEC4899' },                               // pink
  { statuses: ['RESOLVED', 'CLOSED'], label: 'Resolved/Closed', argb: 'FF22C55E' },      // green
];
const ALL_STATUSES = STATUS_GROUPS.flatMap((g) => g.statuses);
export const GROUP_LABEL: Record<string, string> = {};
export const GROUP_COLOR: Record<string, string> = {};
for (const g of STATUS_GROUPS) {
  for (const s of g.statuses) GROUP_LABEL[s] = g.label;
  GROUP_COLOR[g.label] = g.argb;
}

export interface StatusScope {
  customerId?: string;
  plant?: string; // requires customerId — a plant can't be tenant-wide
}

export interface StatusCounts {
  scope: StatusScope;
  counts: Record<string, number>;
  total: number;
}

function scopeWhere(tenantId: string, scope?: StatusScope) {
  return {
    tenantId,
    ...(scope?.customerId ? { customerId: scope.customerId } : {}),
    ...(scope?.plant ? { plant: scope.plant } : {}),
  };
}

export async function getStatusCounts(tenantId: string, scope?: StatusScope): Promise<StatusCounts> {
  const rows = await prisma.iTSMRecord.groupBy({
    by: ['status'],
    where: { ...scopeWhere(tenantId, scope), status: { in: ALL_STATUSES as any } },
    _count: true,
  });

  const counts: Record<string, number> = {};
  for (const g of STATUS_GROUPS) counts[g.label] = 0;
  let total = 0;
  for (const r of rows as any[]) {
    const label = GROUP_LABEL[r.status];
    if (label) { counts[label] += r._count; total += r._count; }
  }
  return { scope: scope || {}, counts, total };
}

// Two-sheet Excel export: ticket-level list + a color-coded summary table.
// scope omitted = tenant-wide; { customerId } = that customer's tickets
// across all its plants; { customerId, plant } = one specific plant.
export async function generateStatusExcel(tenantId: string, scope?: StatusScope, scopeLabel?: string): Promise<Buffer> {
  const plant = scope?.plant;
  const records = await prisma.iTSMRecord.findMany({
    where: { ...scopeWhere(tenantId, scope), status: { in: ALL_STATUSES as any } },
    select: {
      recordNumber: true,
      recordType: true,
      title: true,
      priority: true,
      status: true,
      plant: true,
      createdAt: true,
      targetDate: true,
      revisedTargetDate: true,
      assignedAgent: { select: { user: { select: { firstName: true, lastName: true } } } },
      customer: { select: { companyName: true } },
      sapModule: { select: { code: true, name: true } },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });

  const workbook = new ExcelJS.Workbook();

  // ── Sheet 1: Tickets ──────────────────────────────────────────
  const ticketSheet = workbook.addWorksheet('Tickets');
  const ticketColumns = [
    { header: 'Record #', key: 'recordNumber', width: 16 },
    { header: 'Type', key: 'recordType', width: 12 },
    { header: 'Title', key: 'title', width: 40 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Status Group', key: 'statusGroup', width: 20 },
    { header: 'Status', key: 'status', width: 18 },
    ...(plant ? [] : [{ header: 'Plant', key: 'plant', width: 16 }]),
    { header: 'Customer', key: 'customer', width: 20 },
    { header: 'SAP Module', key: 'sapModule', width: 18 },
    { header: 'Assigned Agent', key: 'assignedAgent', width: 20 },
    { header: 'Created', key: 'createdAt', width: 14 },
    { header: 'Target Date', key: 'targetDate', width: 14 },
    { header: 'Revised Target Date', key: 'revisedTargetDate', width: 18 },
  ];
  ticketSheet.columns = ticketColumns;
  const ticketHeaderRow = ticketSheet.getRow(1);
  ticketHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ticketHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };

  for (const r of records as any[]) {
    ticketSheet.addRow({
      recordNumber: r.recordNumber,
      recordType: r.recordType,
      title: r.title,
      priority: r.priority,
      statusGroup: GROUP_LABEL[r.status] || r.status,
      status: String(r.status).replace(/_/g, ' '),
      ...(plant ? {} : { plant: r.plant || '' }),
      customer: r.customer?.companyName || '',
      sapModule: r.sapModule ? `${r.sapModule.code} — ${r.sapModule.name}` : '',
      assignedAgent: r.assignedAgent?.user
        ? `${r.assignedAgent.user.firstName} ${r.assignedAgent.user.lastName || ''}`.trim()
        : '',
      createdAt: r.createdAt ? r.createdAt.toISOString().split('T')[0] : '',
      targetDate: r.targetDate ? r.targetDate.toISOString().split('T')[0] : '',
      revisedTargetDate: r.revisedTargetDate ? r.revisedTargetDate.toISOString().split('T')[0] : '',
    });
  }

  // ── Sheet 2: Summary — color-coded status counts ───────────────
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Status', key: 'status', width: 24 },
    { header: 'Count', key: 'count', width: 12 },
    { header: '% of Total', key: 'pct', width: 14 },
  ];
  const summaryHeaderRow = summarySheet.getRow(1);
  summaryHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summaryHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };

  const counts: Record<string, number> = {};
  for (const g of STATUS_GROUPS) counts[g.label] = 0;
  let total = 0;
  for (const r of records as any[]) {
    const label = GROUP_LABEL[r.status];
    if (label) { counts[label] += 1; total += 1; }
  }

  for (const g of STATUS_GROUPS) {
    const count = counts[g.label];
    const row = summarySheet.addRow({
      status: g.label,
      count,
      pct: total > 0 ? `${Math.round((count / total) * 100)}%` : '0%',
    });
    row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: g.argb } };
    row.getCell('status').font = { bold: true, color: { argb: 'FFFFFFFF' } };
  }
  const totalRow = summarySheet.addRow({ status: 'Total', count: total, pct: '100%' });
  totalRow.font = { bold: true };
  totalRow.getCell('status').border = { top: { style: 'thin' } };
  totalRow.getCell('count').border = { top: { style: 'thin' } };
  totalRow.getCell('pct').border = { top: { style: 'thin' } };

  summarySheet.addRow({});
  const scopeRow = summarySheet.addRow({ status: scopeLabel || (plant ? `Plant: ${plant}` : 'All Plants') });
  scopeRow.font = { italic: true, color: { argb: 'FF999999' } };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
