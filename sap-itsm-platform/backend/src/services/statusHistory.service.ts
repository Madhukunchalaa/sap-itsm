import ExcelJS from 'exceljs';
import { prisma } from '../config/database';
import { GROUP_LABEL, GROUP_COLOR } from './statusReport.service';

// Status transitions are read straight out of AuditLog — updateRecord() already
// writes a STATUS_CHANGE entry (oldValues/newValues) on every status change, so
// this report needs no new tracking table, just a query + presentation layer.

export interface StatusHistoryFilters {
  customerId?: string;
  customerIdIn?: string[];
  plant?: string;
  recordId?: string;
  assignedAgentId?: string;
  changedById?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

export interface StatusChangeRow {
  id: string;
  recordId: string;
  recordNumber: string;
  title: string;
  customerId: string | null;
  customerName: string | null;
  plant: string | null;
  fromStatus: string | null;
  toStatus: string;
  changedById: string | null;
  changedByName: string;
  changedAt: Date;
}

// Bounded fetch — same "take: N then filter/paginate in app" pattern already
// used for the audit_logs export in export.routes.ts. Status-change volume for
// a tenant this size won't approach the cap in practice.
const FETCH_CAP = 5000;

function buildWhere(tenantId: string, f: StatusHistoryFilters) {
  return {
    tenantId,
    action: 'STATUS_CHANGE' as const,
    entityType: 'ITSMRecord',
    ...(f.recordId && { recordId: f.recordId }),
    ...(f.changedById && { userId: f.changedById }),
    ...((f.from || f.to) && {
      createdAt: {
        ...(f.from && { gte: f.from }),
        ...(f.to && { lte: f.to }),
      },
    }),
    record: {
      ...(f.customerId && { customerId: f.customerId }),
      ...(f.customerIdIn && { customerId: { in: f.customerIdIn } }),
      ...(f.plant && { plant: f.plant }),
      ...(f.assignedAgentId && { assignedAgentId: f.assignedAgentId }),
    },
  };
}

async function fetchChanges(tenantId: string, f: StatusHistoryFilters): Promise<StatusChangeRow[]> {
  const rows = await prisma.auditLog.findMany({
    where: buildWhere(tenantId, f),
    include: {
      record: {
        select: {
          id: true, recordNumber: true, title: true, plant: true,
          customer: { select: { id: true, companyName: true } },
        },
      },
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: FETCH_CAP,
  });

  return rows
    .filter((r) => r.record && (r.newValues as any)?.status !== undefined)
    .map((r) => ({
      id: r.id,
      recordId: r.recordId!,
      recordNumber: r.record!.recordNumber,
      title: r.record!.title,
      customerId: r.record!.customer?.id ?? null,
      customerName: r.record!.customer?.companyName ?? null,
      plant: r.record!.plant,
      fromStatus: (r.oldValues as any)?.status ?? null,
      toStatus: (r.newValues as any).status as string,
      changedById: r.userId,
      changedByName: r.user ? `${r.user.firstName} ${r.user.lastName}` : 'System',
      changedAt: r.createdAt,
    }));
}

export async function listStatusChanges(tenantId: string, filters: StatusHistoryFilters) {
  const all = await fetchChanges(tenantId, filters);
  const page = filters.page || 1;
  const limit = filters.limit || 30;
  const total = all.length;
  const data = all.slice((page - 1) * limit, page * limit);
  return { data, total, page, limit };
}

export async function exportStatusHistoryExcel(
  tenantId: string,
  filters: StatusHistoryFilters,
  scopeLabel?: string
): Promise<Buffer> {
  const changes = await fetchChanges(tenantId, filters);

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Status History');

  sheet.columns = [
    { header: 'Ticket #', key: 'recordNumber', width: 16 },
    { header: 'Title', key: 'title', width: 36 },
    { header: 'Customer', key: 'customerName', width: 20 },
    { header: 'Plant', key: 'plant', width: 18 },
    { header: 'From Status', key: 'fromStatus', width: 16 },
    { header: 'To Status', key: 'toStatus', width: 16 },
    { header: 'Changed By', key: 'changedByName', width: 20 },
    { header: 'Changed At', key: 'changedAt', width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

  for (const c of changes) {
    const row = sheet.addRow({
      recordNumber: c.recordNumber,
      title: c.title,
      customerName: c.customerName || '—',
      plant: c.plant || '—',
      fromStatus: c.fromStatus || '(new)',
      toStatus: c.toStatus,
      changedByName: c.changedByName,
      changedAt: c.changedAt.toISOString().replace('T', ' ').slice(0, 19),
    });
    const color = GROUP_COLOR[GROUP_LABEL[c.toStatus]];
    if (color) {
      row.getCell('toStatus').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      row.getCell('toStatus').font = { color: { argb: 'FFFFFFFF' }, bold: true };
    }
  }

  const footer = sheet.addRow([]);
  footer.getCell(1).value = `Scope: ${scopeLabel || 'All'} · ${changes.length} status change${changes.length !== 1 ? 's' : ''} · Generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`;
  footer.getCell(1).font = { italic: true, color: { argb: 'FF9CA3AF' } };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
