import ExcelJS from 'exceljs';
import { prisma } from '../config/database';

// Status buckets requested for the daily plant status digest.
const STATUS_GROUPS: { statuses: string[]; label: string }[] = [
  { statuses: ['OPEN', 'IN_PROGRESS'], label: 'Open/In Progress' },
  { statuses: ['AWAITING_CUSTOMER'], label: 'Awaiting Customer' },
  { statuses: ['IN_UAT'], label: 'In UAT' },
  { statuses: ['HOLD'], label: 'Hold' },
  { statuses: ['RESOLVED', 'CLOSED'], label: 'Resolved/Closed' },
];
const ALL_STATUSES = STATUS_GROUPS.flatMap((g) => g.statuses);
const GROUP_LABEL: Record<string, string> = {};
for (const g of STATUS_GROUPS) for (const s of g.statuses) GROUP_LABEL[s] = g.label;

export interface PlantStatusCounts {
  plant: string;
  counts: Record<string, number>;
  total: number;
}

export async function getPlantStatusCounts(tenantId: string, plant: string): Promise<PlantStatusCounts> {
  const rows = await prisma.iTSMRecord.groupBy({
    by: ['status'],
    where: { tenantId, plant, status: { in: ALL_STATUSES as any } },
    _count: true,
  });

  const counts: Record<string, number> = {};
  for (const g of STATUS_GROUPS) counts[g.label] = 0;
  let total = 0;
  for (const r of rows as any[]) {
    const label = GROUP_LABEL[r.status];
    if (label) { counts[label] += r._count; total += r._count; }
  }
  return { plant, counts, total };
}

// Ticket-level Excel export for one plant, grouped/sorted by status bucket.
export async function generatePlantStatusExcel(tenantId: string, plant: string): Promise<Buffer> {
  const records = await prisma.iTSMRecord.findMany({
    where: { tenantId, plant, status: { in: ALL_STATUSES as any } },
    select: {
      recordNumber: true,
      recordType: true,
      title: true,
      priority: true,
      status: true,
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
  const sheet = workbook.addWorksheet('Status Report');
  sheet.columns = [
    { header: 'Record #', key: 'recordNumber', width: 16 },
    { header: 'Type', key: 'recordType', width: 12 },
    { header: 'Title', key: 'title', width: 40 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Status Group', key: 'statusGroup', width: 20 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Customer', key: 'customer', width: 20 },
    { header: 'SAP Module', key: 'sapModule', width: 18 },
    { header: 'Assigned Agent', key: 'assignedAgent', width: 20 },
    { header: 'Created', key: 'createdAt', width: 14 },
    { header: 'Target Date', key: 'targetDate', width: 14 },
    { header: 'Revised Target Date', key: 'revisedTargetDate', width: 18 },
  ];
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };

  for (const r of records as any[]) {
    sheet.addRow({
      recordNumber: r.recordNumber,
      recordType: r.recordType,
      title: r.title,
      priority: r.priority,
      statusGroup: GROUP_LABEL[r.status] || r.status,
      status: String(r.status).replace(/_/g, ' '),
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

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
