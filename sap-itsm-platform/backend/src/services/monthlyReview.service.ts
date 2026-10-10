import {
  AlignmentType, BorderStyle, Document, Header, Packer, Paragraph, ShadingType, Table, TableCell, TableRow,
  TabStopType, TextRun, VerticalAlign, WidthType,
} from 'docx';
import { endOfDay, endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { STATUS_TO_BUCKET } from './statusDeck.service';

// ---------------------------------------------------------------------------
// Monthly "SAP <module> MODULE - SUMMARY" review (Word), one page per module,
// in the layout of the "Month Review report" sample:
//   - Summary of tickets closed during the month (carry forward / new / closed
//     / still open, with a High vs Normal priority split)
//   - High priority open items as of month end
//   - Comments / signature box for the HOD
// ---------------------------------------------------------------------------

// Report sections, in order. A section is a module code, optionally narrowed to
// a sub-module by name (the optional `sub` pattern; unused at the moment).
interface SectionDef { id: string; title: string; code: string; sub?: RegExp }
const SECTIONS: SectionDef[] = [
  { id: 'pp', title: 'PP', code: 'PP' },
  { id: 'fico', title: 'FICO', code: 'FICO' },
  { id: 'ps', title: 'PS', code: 'PS' },
  { id: 'mm', title: 'MM', code: 'MM' },
  { id: 'basis', title: 'BASIS', code: 'BASIS' },
  { id: 'abap', title: 'ABAP', code: 'ABAP' },
  { id: 'sd', title: 'SD', code: 'SD' },
];
const OTHER_ID = 'other';

// Priority split used in the "Priority" column.
const HIGH_PRIORITIES = new Set(['P1', 'P2']);

// Same status grouping as the PowerPoint status report: closed = resolved,
// closed or moved to production; cancelled tickets are not reported.
const isClosed = (status: string) => STATUS_TO_BUCKET[status] === 'closed';
const isOpenType = (status: string) => !!STATUS_TO_BUCKET[status] && !isClosed(status);

export interface ModuleSummary {
  carry: number;
  carryClosed: number;
  carryHigh: number;
  carryNormal: number;
  newCount: number;
  newClosed: number;
  newHigh: number;
  newNormal: number;
}

export interface HighOpenItem {
  title: string;
  createdAt: Date;
  targetDate: Date | null;
  statusLabel: string;
}

export interface ModuleReview {
  id: string;
  title: string; // "PP", "MM – STORES", ...
  summary: ModuleSummary;
  highOpen: HighOpenItem[];
}

export interface MonthlyReviewData {
  customerName: string;
  plant: string | null;
  monthStart: Date;
  asOf: Date; // last day covered (month end, or today for the current month)
  prevMonthName: string;
  modules: ModuleReview[];
  fileTag: string; // e.g. "FICO" when exactly one module was picked
}

// Portal status -> wording used in the sample's "Status of Ticket" column.
function statusLabel(status: string): string {
  switch (status) {
    case 'NEW': case 'OPEN': case 'PENDING': case 'REOPEN': return 'Open';
    case 'IN_PROGRESS': return 'WIP';
    case 'DEVELOPMENT_COMPLETED': return 'Development Completed';
    case 'IN_UAT': return 'In UAT';
    case 'MOVED_TO_QUALITY': return 'Moved to Quality';
    case 'WITH_SAP': return 'With SAP';
    case 'AWAITING_CUSTOMER': return 'Awaiting Customer';
    case 'HOLD': return 'Hold';
    default: return status.replace(/_/g, ' ');
  }
}

export function parseMonth(month: string): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new AppError('month must be YYYY-MM.', 400, 'VALIDATION_ERROR');
  return new Date(Number(m[1]), Number(m[2]) - 1, 1);
}

export async function buildMonthlyReviewData(
  tenantId: string,
  opts: { customerId: string; plant?: string; month: string; modules?: string[] },
): Promise<MonthlyReviewData> {
  const customer = await prisma.customer.findFirst({
    where: { id: opts.customerId, tenantId },
    select: { companyName: true },
  });
  if (!customer) throw new AppError('Customer not found.', 404);

  const wanted = opts.modules?.length ? new Set(opts.modules) : null;
  if (wanted) {
    const known = new Set([...SECTIONS.map((x) => x.id), OTHER_ID]);
    const unknown = [...wanted].filter((id) => !known.has(id));
    if (unknown.length) throw new AppError(`Unknown module: ${unknown.join(', ')}`, 400, 'VALIDATION_ERROR');
  }

  const monthStart = startOfMonth(parseMonth(opts.month));
  const now = new Date();
  if (monthStart > now) throw new AppError('Report month cannot be in the future.', 400, 'VALIDATION_ERROR');
  // A month still in progress is reported up to today.
  const asOf = endOfMonth(monthStart) > now ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : endOfMonth(monthStart);
  const asOfEnd = endOfDay(asOf);
  const prevEnd = new Date(monthStart.getTime() - 1); // last instant of the previous month

  const plant = opts.plant?.trim() || null;
  const recordScope = { tenantId, customerId: opts.customerId, ...(plant ? { plant } : {}) };

  const records = await prisma.iTSMRecord.findMany({
    where: recordScope,
    select: {
      id: true, title: true, status: true, priority: true, createdAt: true, targetDate: true, revisedTargetDate: true,
      sapModule: { select: { code: true } },
      sapSubModule: { select: { name: true } },
    },
  });

  // Status at an earlier moment = what the first later status change moved it FROM.
  const changes = await prisma.auditLog.findMany({
    where: { tenantId, action: 'STATUS_CHANGE', entityType: 'ITSMRecord', createdAt: { gt: prevEnd }, record: recordScope },
    select: { recordId: true, createdAt: true, oldValues: true, newValues: true },
    orderBy: { createdAt: 'asc' },
  });
  const byRecord = new Map<string, { at: Date; from: string | null }[]>();
  for (const c of changes) {
    if (!c.recordId || (c.newValues as any)?.status === undefined) continue;
    const list = byRecord.get(c.recordId) || [];
    list.push({ at: c.createdAt, from: (c.oldValues as any)?.status ?? null });
    byRecord.set(c.recordId, list);
  }
  const statusAt = (r: { id: string; status: string; createdAt: Date }, moment: Date): string | null => {
    if (r.createdAt > moment) return null;
    return byRecord.get(r.id)?.find((c) => c.at > moment)?.from ?? r.status;
  };

  const sectionOf = (r: (typeof records)[number]): string => {
    const code = r.sapModule?.code?.toUpperCase();
    const sub = r.sapSubModule?.name || '';
    const hit = SECTIONS.find((s) => s.code === code && (!s.sub || s.sub.test(sub)));
    return hit ? hit.id : OTHER_ID;
  };

  const empty = (): ModuleSummary => ({ carry: 0, carryClosed: 0, carryHigh: 0, carryNormal: 0, newCount: 0, newClosed: 0, newHigh: 0, newNormal: 0 });
  const acc = new Map<string, { summary: ModuleSummary; high: (HighOpenItem & { n: number })[] }>();
  const slot = (id: string) => {
    if (!acc.has(id)) acc.set(id, { summary: empty(), high: [] });
    return acc.get(id)!;
  };

  for (const r of records) {
    const sec = slot(sectionOf(r));
    const high = HIGH_PRIORITIES.has(r.priority);
    const endStatus = statusAt(r, asOfEnd);
    if (!endStatus || !STATUS_TO_BUCKET[endStatus]) continue; // not created yet, or cancelled

    if (r.createdAt < monthStart) {
      // Carry forward: open when the month began
      const startStatus = statusAt(r, prevEnd);
      if (startStatus && isOpenType(startStatus)) {
        sec.summary.carry++;
        if (high) sec.summary.carryHigh++; else sec.summary.carryNormal++;
        if (isClosed(endStatus)) sec.summary.carryClosed++;
      }
    } else if (r.createdAt <= asOfEnd) {
      sec.summary.newCount++;
      if (high) sec.summary.newHigh++; else sec.summary.newNormal++;
      if (isClosed(endStatus)) sec.summary.newClosed++;
    }

    if (high && isOpenType(endStatus)) {
      sec.high.push({
        title: r.title.replace(/\s+/g, ' ').trim(), createdAt: r.createdAt, targetDate: r.revisedTargetDate ?? r.targetDate,
        statusLabel: statusLabel(endStatus), n: 0,
      });
    }
  }

  const modules: ModuleReview[] = [];
  const build = (id: string, title: string) => {
    const a = acc.get(id) ?? { summary: empty(), high: [] };
    const high = [...a.high].sort((x, y) => (x.targetDate?.getTime() ?? Infinity) - (y.targetDate?.getTime() ?? Infinity) || x.createdAt.getTime() - y.createdAt.getTime());
    modules.push({ id, title, summary: a.summary, highOpen: high });
  };
  for (const s of SECTIONS) build(s.id, s.title);
  // Tickets that fit none of the listed sections still count — shown only when there are some.
  const other = acc.get(OTHER_ID);
  if (other && (other.summary.carry || other.summary.newCount || other.high.length)) build(OTHER_ID, 'OTHER MODULES');

  const chosen = wanted ? modules.filter((m) => wanted.has(m.id)) : modules;
  if (!chosen.length) throw new AppError('None of the selected modules have anything to report for this period.', 400, 'VALIDATION_ERROR');
  return {
    customerName: customer.companyName, plant, monthStart, asOf, prevMonthName: format(subMonths(monthStart, 1), 'MMMM'),
    modules: chosen, fileTag: wanted && chosen.length === 1 ? chosen[0].title : '',
  };
}

// "2301 - MNEPL" -> "2301"; used in the file name.
function plantTag(plant: string | null): string {
  if (!plant) return '';
  const num = plant.split(/\s*-\s*/).find((p) => /^\d+$/.test(p.trim()));
  return (num || plant).replace(/[^A-Za-z0-9]+/g, '');
}

export function monthlyReviewFileName(d: MonthlyReviewData): string {
  const cust = d.customerName.split(/\s+/)[0].replace(/[^A-Za-z0-9]/g, '');
  const tag = d.fileTag.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return [`${format(d.monthStart, 'MMMM')} Month Review report_${cust}`, plantTag(d.plant), tag].filter(Boolean).join('_') + '.docx';
}

// ── Word rendering ──────────────────────────────────────────────────────────

const FONT = 'Calibri';
const CONTENT_W = 9026; // A4 with 1" margins, in twips
const FILL_HEAD = 'DEEAF6';
const FILL_TOTAL = 'FBE4D5';
const FILL_HOD = 'D9E2F3';
const LINE = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
const BORDERS = { top: LINE, bottom: LINE, left: LINE, right: LINE };

const scale = (cols: number[]): number[] => {
  const total = cols.reduce((a, b) => a + b, 0);
  const out = cols.map((c) => Math.round((c * CONTENT_W) / total));
  out[out.length - 1] += CONTENT_W - out.reduce((a, b) => a + b, 0);
  return out;
};

const run = (text: string, bold = false, size = 22) => new TextRun({ text, bold, font: FONT, size });

function cell(text: string, width: number, opts: { bold?: boolean; fill?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; height?: boolean } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: BORDERS,
    verticalAlign: VerticalAlign.CENTER,
    shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
    margins: { top: 40, bottom: 40, left: 90, right: 90 },
    children: [
      new Paragraph({
        alignment: opts.align ?? AlignmentType.LEFT,
        spacing: { after: 0, line: 240 },
        children: [run(text, opts.bold)],
      }),
    ],
  });
}

const dash = (n: number | null) => (n === null ? '-' : String(n));
const priorityText = (high: number, normal: number) => `High Priority - ${high} / Normal - ${normal}`;
const dotDate = (d: Date | null) => (d ? format(d, 'dd.MM.yyyy') : '');

function ordinalDay(d: Date): string {
  const n = d.getDate();
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th';
  return `${n}${suffix} ${format(d, 'MMMM yyyy')}`;
}

function moduleHeader(title: string): Header {
  const tab = [{ type: TabStopType.RIGHT, position: CONTENT_W }];
  const big = (text: string) => new TextRun({ text, bold: true, font: FONT, size: 28 });
  return new Header({
    children: [
      new Paragraph({ tabStops: tab, children: [big(title === 'OTHER MODULES' ? 'SAP OTHER MODULES - SUMMARY' : `SAP ${title} MODULE - SUMMARY`), new TextRun({ text: '\t', size: 28 }), big('SAP CONTACT: ')] }),
      new Paragraph({ tabStops: tab, children: [new TextRun({ text: '\t', size: 28 }), big('BUSINESS CONTACT: ')] }),
    ],
  });
}

function moduleSection(data: MonthlyReviewData, m: ModuleReview) {
  const monthName = format(data.monthStart, 'MMMM');
  const s = m.summary;
  const carryOpen = s.carry - s.carryClosed;
  const newOpen = s.newCount - s.newClosed;

  const c1 = scale([1811, 1091, 1415, 1389, 1745, 2064]);
  const head1 = ['Particulars', 'Open Issues', 'New Issues', 'Closed Issues', 'Total Open Issues', 'Priority'];
  const mid = AlignmentType.CENTER;
  const summaryTable = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: c1,
    rows: [
      new TableRow({ tableHeader: true, children: head1.map((h, i) => cell(h, c1[i], { bold: true, fill: FILL_HEAD, align: i === 0 ? AlignmentType.LEFT : mid })) }),
      new TableRow({
        children: [
          cell(`Issues Carry forward from ${data.prevMonthName}`, c1[0]),
          cell(String(s.carry), c1[1], { align: mid }), cell('-', c1[2], { align: mid }),
          cell(String(s.carryClosed), c1[3], { align: mid }), cell(String(carryOpen), c1[4], { align: mid }),
          cell(priorityText(s.carryHigh, s.carryNormal), c1[5]),
        ],
      }),
      new TableRow({
        children: [
          cell(`New issues raised from users (${monthName})`, c1[0]),
          cell('-', c1[1], { align: mid }), cell(String(s.newCount), c1[2], { align: mid }),
          cell(String(s.newClosed), c1[3], { align: mid }), cell(String(newOpen), c1[4], { align: mid }),
          cell(priorityText(s.newHigh, s.newNormal), c1[5]),
        ],
      }),
      new TableRow({
        children: [
          cell('TOTAL', c1[0], { bold: true, fill: FILL_TOTAL }),
          cell(String(s.carry), c1[1], { bold: true, fill: FILL_TOTAL, align: mid }),
          cell(String(s.newCount), c1[2], { bold: true, fill: FILL_TOTAL, align: mid }),
          cell(String(s.carryClosed + s.newClosed), c1[3], { bold: true, fill: FILL_TOTAL, align: mid }),
          cell(String(carryOpen + newOpen), c1[4], { bold: true, fill: FILL_TOTAL, align: mid }),
          cell('', c1[5], { fill: FILL_TOTAL }),
        ],
      }),
    ],
  });

  const c2 = scale([480, 4656, 1223, 1255, 1202, 1151]);
  const head2 = ['S. No', 'Description of open issues', 'Date of ticket', 'Target Date of completion', 'Comments', 'Status of Ticket / (High Priority)'];
  const detailRows = m.highOpen.length
    ? m.highOpen.map((t, i) => new TableRow({
        children: [
          cell(String(i + 1), c2[0], { align: mid }), cell(t.title, c2[1]), cell(dotDate(t.createdAt), c2[2], { align: mid }),
          cell(dotDate(t.targetDate), c2[3], { align: mid }), cell('', c2[4]), cell(t.statusLabel, c2[5], { align: mid }),
        ],
      }))
    : [new TableRow({
        children: [
          cell('', c2[0]), cell('No high priority open items.', c2[1]), cell('', c2[2]), cell('', c2[3]), cell('', c2[4]), cell('', c2[5]),
        ],
      })];
  const detailTable = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: c2,
    rows: [
      new TableRow({ tableHeader: true, children: head2.map((h, i) => cell(h, c2[i], { bold: true, fill: FILL_HEAD, align: i === 1 ? AlignmentType.LEFT : mid })) }),
      ...detailRows,
    ],
  });

  const c3 = scale([4531, 5245]);
  const hodTable = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: c3,
    rows: [
      new TableRow({ children: [cell('Comments by HOD', c3[0], { bold: true, fill: FILL_HOD }), cell('Signature of HOD', c3[1], { bold: true, fill: FILL_HOD })] }),
      new TableRow({
        height: { value: 1100, rule: 'atLeast' as any },
        children: [cell('', c3[0]), cell('', c3[1])],
      }),
    ],
  });

  const spacer = () => new Paragraph({ spacing: { after: 160 }, children: [] });
  return {
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 } } },
    headers: { default: moduleHeader(m.title) },
    children: [
      new Paragraph({ spacing: { after: 160 }, children: [run(`Summary of Tickets closed during the month of ${format(data.monthStart, 'MMMM yyyy')}`, true)] }),
      summaryTable,
      spacer(),
      new Paragraph({ spacing: { after: 160 }, children: [run(`Details of High Priority - Open Items as of ${ordinalDay(data.asOf)}`, true)] }),
      detailTable,
      spacer(),
      hodTable,
    ],
  };
}

export async function generateMonthlyReview(data: MonthlyReviewData): Promise<Buffer> {
  const doc = new Document({
    creator: 'IntraEdge',
    title: `${data.customerName} ${format(data.monthStart, 'MMMM yyyy')} month review`,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: data.modules.map((m) => moduleSection(data, m)),
  });
  return Packer.toBuffer(doc);
}
