import path from 'path';
import PptxGenJS from 'pptxgenjs';
import { endOfDay, format, subDays, subMonths } from 'date-fns';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';

// ---------------------------------------------------------------------------
// Weekly / Monthly "SAP Support — Ticket Status Report" deck (editable .pptx),
// laid out like the MNEPL weekly status deck the project managers send out:
//   1 Cover  2 Summary (+ last week/month comparison)  3 Open tickets & target
//   dates  4.. UAT tickets  5.. Awaiting & Hold (Remarks left blank — the
//   manager fills them in PowerPoint)  last: Thank you.
// ---------------------------------------------------------------------------

export type DeckPeriod = 'weekly' | 'monthly';

// Status -> report bucket. Single place to change how a status is counted.
// CANCELLED is deliberately absent: cancelled tickets are not reported.
const BUCKET_STATUSES = {
  open: ['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'WITH_SAP', 'REOPEN', 'DEVELOPMENT_COMPLETED'],
  uat: ['IN_UAT', 'MOVED_TO_QUALITY'],
  awaitingHold: ['AWAITING_CUSTOMER', 'HOLD'],
  closed: ['RESOLVED', 'CLOSED', 'MOVED_TO_PRODUCTION'],
} as const;
type BucketKey = keyof typeof BUCKET_STATUSES;

const STATUS_TO_BUCKET: Record<string, BucketKey> = {};
for (const key of Object.keys(BUCKET_STATUSES) as BucketKey[]) {
  for (const s of BUCKET_STATUSES[key]) STATUS_TO_BUCKET[s] = key;
}

export interface BucketCounts {
  total: number;
  closed: number;
  open: number;
  uat: number;
  awaitingHold: number;
}

export interface DeckTicket {
  recordNumber: string;
  title: string;
  status: string;
  targetDate: Date | null;
  revisedTargetDate: Date | null;
}

export interface StatusDeckData {
  period: DeckPeriod;
  customerName: string;
  plant: string | null;
  asOf: Date;
  previousAsOf: Date;
  current: BucketCounts;
  previous: BucketCounts;
  openTickets: DeckTicket[];
  uatTickets: DeckTicket[];
  awaitingHoldTickets: DeckTicket[];
}

function emptyCounts(): BucketCounts {
  return { total: 0, closed: 0, open: 0, uat: 0, awaitingHold: 0 };
}

function addToCounts(c: BucketCounts, bucket: BucketKey) {
  c[bucket] += 1;
  c.total += 1;
}

export async function buildStatusDeckData(
  tenantId: string,
  opts: { period: DeckPeriod; customerId: string; plant?: string; noPlant?: boolean; asOf: Date },
): Promise<StatusDeckData> {
  const customer = await prisma.customer.findFirst({
    where: { id: opts.customerId, tenantId },
    select: { companyName: true },
  });
  if (!customer) throw new AppError('Customer not found.', 404);

  const plant = opts.plant?.trim() || null;
  const recordScope = {
    tenantId, customerId: opts.customerId,
    ...(opts.noPlant ? { plant: null } : plant ? { plant } : {}),
  };

  const asOfEnd = endOfDay(opts.asOf);
  const previousEnd = endOfDay(opts.period === 'weekly' ? subDays(opts.asOf, 7) : subMonths(opts.asOf, 1));

  const records = await prisma.iTSMRecord.findMany({
    where: recordScope,
    select: {
      id: true, recordNumber: true, title: true, status: true, createdAt: true,
      targetDate: true, revisedTargetDate: true,
    },
  });

  // A ticket's status "as of" a past moment = the status it was changed FROM
  // by its first status change after that moment (or its current status if it
  // hasn't changed since). Only changes after the earlier snapshot are needed.
  const changes = await prisma.auditLog.findMany({
    where: {
      tenantId,
      action: 'STATUS_CHANGE',
      entityType: 'ITSMRecord',
      createdAt: { gt: previousEnd },
      record: recordScope,
    },
    select: { recordId: true, createdAt: true, oldValues: true, newValues: true },
    orderBy: { createdAt: 'asc' },
  });
  const changesByRecord = new Map<string, { at: Date; from: string | null }[]>();
  for (const c of changes) {
    if (!c.recordId || (c.newValues as any)?.status === undefined) continue;
    const list = changesByRecord.get(c.recordId) || [];
    list.push({ at: c.createdAt, from: (c.oldValues as any)?.status ?? null });
    changesByRecord.set(c.recordId, list);
  }

  const statusAt = (rec: { id: string; status: string; createdAt: Date }, moment: Date): string | null => {
    if (rec.createdAt > moment) return null; // didn't exist yet
    const firstLater = changesByRecord.get(rec.id)?.find((c) => c.at > moment);
    return firstLater?.from ?? rec.status;
  };

  const current = emptyCounts();
  const previous = emptyCounts();
  const lists: Record<BucketKey, DeckTicket[]> = { open: [], uat: [], awaitingHold: [], closed: [] };

  for (const rec of records) {
    const nowStatus = statusAt(rec, asOfEnd);
    const nowBucket = nowStatus ? STATUS_TO_BUCKET[nowStatus] : undefined;
    if (nowStatus && nowBucket) {
      addToCounts(current, nowBucket);
      lists[nowBucket].push({
        recordNumber: rec.recordNumber, title: rec.title, status: nowStatus,
        targetDate: rec.targetDate, revisedTargetDate: rec.revisedTargetDate,
      });
    }
    const prevStatus = statusAt(rec, previousEnd);
    const prevBucket = prevStatus ? STATUS_TO_BUCKET[prevStatus] : undefined;
    if (prevBucket) addToCounts(previous, prevBucket);
  }

  const byNumberDesc = (a: DeckTicket, b: DeckTicket) => b.recordNumber.localeCompare(a.recordNumber);
  const byTargetAsc = (a: DeckTicket, b: DeckTicket) => {
    const ta = a.targetDate ? a.targetDate.getTime() : Infinity;
    const tb = b.targetDate ? b.targetDate.getTime() : Infinity;
    return ta - tb || a.recordNumber.localeCompare(b.recordNumber);
  };

  return {
    period: opts.period,
    customerName: customer.companyName,
    plant,
    asOf: opts.asOf,
    previousAsOf: previousEnd,
    current,
    previous,
    openTickets: lists.open.sort(byTargetAsc),
    uatTickets: lists.uat.sort(byNumberDesc),
    awaitingHoldTickets: lists.awaitingHold.sort(byNumberDesc),
  };
}

// ── naming helpers ──────────────────────────────────────────────────────────

// "2301 - MNEPL" -> "MNEPL", "SEPC - 3121" -> "SEPC"; no plant -> customer name.
function plantShortName(plant: string | null, customerName: string): string {
  if (!plant) return customerName.toUpperCase();
  const parts = plant.split(/\s*-\s*/).map((p) => p.trim()).filter(Boolean);
  const named = parts.find((p) => /[A-Za-z]/.test(p));
  return (named || plant).toUpperCase();
}

export function statusDeckFileName(data: StatusDeckData): string {
  const customerShort = data.customerName.split(/\s+/)[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
  const plantShort = data.plant ? plantShortName(data.plant, data.customerName).replace(/[^A-Z0-9]+/g, '_') : '';
  const kind = data.period === 'weekly' ? 'WEEKLY' : 'MONTHLY';
  return [customerShort, plantShort, kind, 'STATUS', format(data.asOf, 'dd_MM_yyyy')]
    .filter(Boolean).join('_') + '.pptx';
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  return ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th';
}

const fmtDate = (d: Date | null) => (d ? format(d, 'dd-MM-yyyy') : '');

// ── deck rendering ──────────────────────────────────────────────────────────

const ASSETS = path.join(__dirname, '..', '..', 'assets', 'status-deck');
const asset = (f: string) => path.join(ASSETS, f);

const C = {
  navy: '16233F', ink: '1D252C', amber: 'FFC000', gold: 'FFC72C', green: '2E7D5B', blue: '0070C0',
  grey: '5B6B7C', border: 'E2E8F0', footerText: '9AA7B5', rowA: 'FFE8C2', rowB: 'FFF3E0', white: 'FFFFFF',
};
const SLIDE_W = 13.333;
const FOOTER_Y = 6.94;
const CONFIDENTIAL = 'Private & Confidential — Do not duplicate or distribute without written permission from IntraEdge, Inc.';

// Customer logos that ship with the deck; other customers get no logo.
function customerLogo(customerName: string): string | null {
  return /meil/i.test(customerName) ? asset('meil-logo.png') : null;
}

function addFooter(pptx: PptxGenJS, slide: PptxGenJS.Slide) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: FOOTER_Y, w: SLIDE_W, h: 7.5 - FOOTER_Y, fill: { color: C.ink }, line: { color: C.ink } });
  slide.addImage({ path: asset('intraedge-logo-footer.png'), x: 0.3, y: FOOTER_Y + 0.08, w: 1.45, h: 0.378 });
  slide.addText(CONFIDENTIAL, { x: 2.2, y: FOOTER_Y, w: 8.9, h: 7.5 - FOOTER_Y, align: 'center', valign: 'middle', fontFace: 'Calibri', fontSize: 9, color: C.footerText });
  slide.slideNumber = { x: 12.2, y: FOOTER_Y, w: 0.8, h: 7.5 - FOOTER_Y, align: 'right', valign: 'middle', fontFace: 'Calibri', fontSize: 9, color: C.footerText };
}

function contentSlide(pptx: PptxGenJS, title: string, customerName?: string): PptxGenJS.Slide {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };
  slide.addText(title, { x: 0.5, y: 0.25, w: 12.33, h: 0.75, align: 'center', valign: 'middle', fontFace: 'Cambria', fontSize: 28, bold: true, color: C.navy });
  const logo = customerName ? customerLogo(customerName) : null;
  if (logo) slide.addImage({ path: logo, x: 10.7, y: 0.22, w: 2.1, h: 0.49 });
  addFooter(pptx, slide);
  return slide;
}

// Row height estimate so pagination matches how PowerPoint will wrap text.
const TABLE_FONT = 12;
function estimateRowH(text: string, colWidthIn: number): number {
  const charsPerLine = Math.max(10, Math.floor(colWidthIn * 10.5));
  const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
  return Math.max(0.38, lines * 0.2 + 0.16);
}

function paginate<T>(rows: T[], heightOf: (r: T) => number, maxH: number): T[][] {
  const pages: T[][] = [];
  let cur: T[] = [];
  let h = 0;
  for (const r of rows) {
    const rh = heightOf(r);
    if (cur.length && h + rh > maxH) { pages.push(cur); cur = []; h = 0; }
    cur.push(r);
    h += rh;
  }
  if (cur.length) pages.push(cur);
  return pages;
}

interface TableSpec {
  title: string;
  customerName?: string;
  columns: { header: string; w: number }[];
  detailsCol: number;
  rows: string[][]; // already formatted cell text, excluding Sno
  note?: string;
}

const TABLE_X = 0.5;
const TABLE_Y = 1.3;
const TABLE_BOTTOM = FOOTER_Y - 0.2;
const HEADER_H = 0.4;

function addTableSlides(pptx: PptxGenJS, spec: TableSpec) {
  const noteH = spec.note ? 1.05 : 0;
  const maxH = TABLE_BOTTOM - TABLE_Y - HEADER_H - noteH;
  const hOf = (r: string[]) => estimateRowH(r[spec.detailsCol - 1] ?? '', spec.columns[spec.detailsCol].w);

  const pages = spec.rows.length ? paginate(spec.rows, hOf, maxH) : [[]];
  let sno = 1;

  pages.forEach((pageRows, pi) => {
    const slide = contentSlide(pptx, spec.title, spec.customerName);
    const header = spec.columns.map((c) => ({
      text: c.header,
      options: { bold: true, color: C.white, fill: { color: C.amber }, fontFace: 'Calibri', fontSize: TABLE_FONT, valign: 'middle' as const },
    }));
    const body = pageRows.map((r, ri) => {
      const fill = { color: ri % 2 === 0 ? C.rowA : C.rowB };
      const cells = [String(sno++), ...r];
      return cells.map((t) => ({
        text: t,
        options: { color: C.ink, fill, fontFace: 'Calibri', fontSize: TABLE_FONT, valign: 'middle' as const },
      }));
    });

    if (pageRows.length) {
      slide.addTable([header, ...body], {
        x: TABLE_X, y: TABLE_Y, w: spec.columns.reduce((s, c) => s + c.w, 0),
        colW: spec.columns.map((c) => c.w),
        rowH: [HEADER_H, ...pageRows.map(hOf)],
        border: { type: 'none' },
        margin: [0.03, 0.08, 0.03, 0.08],
      });
    } else {
      slide.addText('No tickets in this category.', { x: TABLE_X, y: TABLE_Y + 0.2, w: 12.33, h: 0.5, fontFace: 'Calibri', fontSize: 16, italic: true, color: C.grey });
    }

    const isLast = pi === pages.length - 1;
    if (isLast && spec.note) {
      const used = pageRows.reduce((s, r) => s + hOf(r), HEADER_H);
      slide.addText(spec.note, {
        x: TABLE_X + 0.2, y: TABLE_Y + (pageRows.length ? used : 0.9) + 0.2, w: 11.9, h: noteH - 0.1,
        valign: 'top', fontFace: 'Calibri', fontSize: 14, bold: true, color: C.ink,
      });
    }
  });
}

function addCoverSlide(pptx: PptxGenJS, data: StatusDeckData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.ink };
  slide.addImage({ path: asset('cover.jpg'), x: 0, y: 0, w: SLIDE_W, h: 7.5 });
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: SLIDE_W, h: 7.5, fill: { color: '000000', transparency: 48 }, line: { type: 'none' } });
  slide.addImage({ path: asset('intraedge-logo-cover.png'), x: 10.45, y: 0.45, w: 2.2, h: 0.62 });

  const kind = data.period === 'weekly' ? 'WEEKLY' : 'MONTHLY';
  const scope = plantShortName(data.plant, data.customerName);
  slide.addText('SAP SUPPORT — TICKET STATUS REPORT', { x: 0.9, y: 1.78, w: 8, h: 0.4, fontFace: 'Calibri', fontSize: 16, bold: true, color: C.gold, charSpacing: 2 });
  slide.addText(`${scope} ${kind} Review: Ticket Summary`, { x: 0.9, y: 2.35, w: 9.5, h: 0.8, fontFace: 'Calibri', fontSize: 36, bold: true, color: C.white });
  const day = data.asOf.getDate();
  slide.addText(
    [
      { text: String(day), options: {} },
      { text: ordinal(day), options: { superscript: true } },
      { text: `  ${format(data.asOf, 'MMMM, yyyy')}`, options: {} },
    ],
    { x: 0.9, y: 3.3, w: 8, h: 0.4, fontFace: 'Calibri', fontSize: 16, bold: true, color: C.white },
  );
  slide.addText(CONFIDENTIAL, { x: 0.15, y: 6.95, w: 9, h: 0.4, fontFace: 'Calibri', fontSize: 9, color: C.footerText });
}

function addSummarySlide(pptx: PptxGenJS, data: StatusDeckData) {
  const slide = contentSlide(pptx, 'Support Ticket  Summary', data.customerName);
  const c = data.current;
  const cards: { value: number; label: string; color: string }[] = [
    { value: c.total, label: 'TOTAL ISSUES', color: C.navy },
    { value: c.closed, label: 'RESOLVED & CLOSED', color: C.green },
    { value: c.open, label: 'OPEN', color: C.navy },
    { value: c.uat, label: 'IN UAT', color: C.green },
    { value: c.awaitingHold, label: 'AWAITING & HOLD', color: C.green },
  ];
  cards.forEach((card, i) => {
    const x = 0.45 + i * 2.5;
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y: 1.55, w: 1.95, h: 1.4, rectRadius: 0.06,
      fill: { color: C.white }, line: { color: C.border, width: 0.75 },
      shadow: { type: 'outer', color: '000000', opacity: 0.15, blur: 6, offset: 2, angle: 90 },
    });
    slide.addText(String(card.value), { x, y: 1.7, w: 1.95, h: 0.7, align: 'center', valign: 'middle', fontFace: 'Cambria', fontSize: 34, bold: true, color: card.color });
    slide.addText(card.label, { x, y: 2.4, w: 1.95, h: 0.35, align: 'center', valign: 'middle', fontFace: 'Calibri', fontSize: 9, bold: true, color: C.grey, charSpacing: 2 });
  });

  const p = data.previous;
  const prevWord = data.period === 'weekly' ? 'Last Week' : 'Last Month';
  slide.addText(`${prevWord} Ticket Status (${format(data.previousAsOf, 'dd-MM-yyyy')})`, {
    x: 0.45, y: 3.55, w: 6.5, h: 0.4, fontFace: 'Calibri', fontSize: 15, bold: true, color: C.ink,
  });
  const bullet = { code: '27A2', indent: 24 };
  const prevLines = [
    `Total Tickets – ${p.total}`,
    `Closed / Resolved – ${p.closed}`,
    `Open / InProgress – ${p.open}`,
    `In UAT – ${p.uat}`,
    `Awaiting / Hold – ${p.awaitingHold}`,
  ];
  slide.addText(
    prevLines.map((t) => ({ text: t, options: { bullet, breakLine: true, paraSpaceAfter: 6 } })),
    { x: 0.45, y: 4.1, w: 6.3, h: 2.4, valign: 'top', fontFace: 'Calibri', fontSize: 16, bold: true, color: C.blue },
  );

  const defs = [
    'OPEN – The tickets which are InProgress with IntraEdge',
    'IN UAT – The Tickets which are in User Acceptance Test, once after confirmation will be moved to Production',
    'Awaiting / Hold – The Tickets which are waiting for Inputs',
  ];
  slide.addText(
    defs.map((t) => ({ text: t, options: { bullet, breakLine: true, paraSpaceAfter: 8 } })),
    { x: 7.1, y: 3.55, w: 5.8, h: 3.0, valign: 'top', fontFace: 'Calibri', fontSize: 15, bold: true, color: C.ink },
  );
}

function addClosingSlide(pptx: PptxGenJS) {
  const slide = pptx.addSlide();
  slide.background = { color: C.ink };
  slide.addImage({ path: asset('closing-bg.png'), x: 0, y: 0, w: SLIDE_W, h: 7.5 });
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: SLIDE_W, h: 7.5, fill: { color: '000000', transparency: 45 }, line: { type: 'none' } });
  // Angled navy panel on the right edge, as in the IntraEdge template.
  // custGeom exists at runtime but is missing from the library's ShapeType typings.
  slide.addShape('custGeom' as any, {
    x: 10.5, y: 0, w: 2.833, h: 7.5, fill: { color: C.navy, transparency: 25 }, line: { type: 'none' },
    points: [{ x: 0, y: 0, moveTo: true }, { x: 2.833, y: 0 }, { x: 2.833, y: 7.5 }, { x: 0.9, y: 7.5 }, { close: true }],
  });
  slide.addImage({ path: asset('intraedge-logo-cover.png'), x: 11.1, y: 0.55, w: 1.9, h: 0.54 });
  slide.addText('THANK YOU!', { x: 3.67, y: 2.95, w: 6, h: 0.9, align: 'center', valign: 'middle', fontFace: 'Calibri', fontSize: 40, bold: true, color: C.white });
  slide.addText(CONFIDENTIAL, { x: 0.57, y: 6.85, w: 9, h: 0.4, fontFace: 'Calibri', fontSize: 9, color: C.white });
}

export async function generateStatusDeck(data: StatusDeckData): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in (16:9)
  pptx.title = `${data.customerName} ${data.period} ticket status`;
  pptx.company = 'IntraEdge';

  const scope = plantShortName(data.plant, data.customerName);
  const withDates = (t: DeckTicket) => [t.recordNumber, t.title, fmtDate(t.targetDate), fmtDate(t.revisedTargetDate)];

  addCoverSlide(pptx, data);
  addSummarySlide(pptx, data);

  addTableSlides(pptx, {
    title: 'Open Tickets and Target Dates',
    customerName: data.customerName,
    columns: [{ header: 'Sno', w: 0.65 }, { header: 'Ticket ID', w: 1.9 }, { header: 'Ticket Details', w: 6.4 }, { header: 'Target Date', w: 1.7 }, { header: 'Revised Target', w: 1.68 }],
    detailsCol: 2,
    rows: data.openTickets.map(withDates),
  });

  addTableSlides(pptx, {
    title: 'UAT TICKETS',
    customerName: data.customerName,
    columns: [{ header: 'Sno', w: 0.65 }, { header: 'Ticket ID', w: 1.9 }, { header: 'Ticket Details', w: 9.78 }],
    detailsCol: 2,
    rows: data.uatTickets.map((t) => [t.recordNumber, t.title]),
    note:
      'The above UAT tickets have to be checked and tested in the QAS system. If there are no issues, then based on your confirmation we will move the TR to Production and close the tickets.\n\n' +
      'If any issues are found while testing, IntraEdge will fix them on top priority.',
  });

  addTableSlides(pptx, {
    title: 'Awaiting & Hold Tickets',
    customerName: data.customerName,
    columns: [{ header: 'Sno', w: 0.65 }, { header: 'Ticket ID', w: 1.9 }, { header: 'Ticket Details', w: 5.6 }, { header: 'Remarks', w: 4.18 }],
    detailsCol: 2,
    rows: data.awaitingHoldTickets.map((t) => [t.recordNumber, t.title, '']), // Remarks filled in by hand
    note: `** Requesting ${scope} to provide the inputs ASAP. Accordingly, IntraEdge will take this forward.`,
  });

  addClosingSlide(pptx);

  const out = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(out as Uint8Array);
}


// ===========================================================================
// Consolidated (all plants of one customer) deck — layout of the
// "MEIL Consolidated Weekly Status" deck:
//   cover · executive summary · plant-wise chart+table · then per plant:
//   summary (with previous status) and Open / UAT / Awaiting & Hold tables.
// ===========================================================================

export interface PlantBlock {
  label: string; // "SEPC", "ANPARA", ... or "NO PLANT" (tickets with no plant)
  data: StatusDeckData;
}

export interface ConsolidatedDeckData {
  period: DeckPeriod;
  customerName: string;
  asOf: Date;
  previousAsOf: Date;
  current: BucketCounts;
  previous: BucketCounts;
  plants: PlantBlock[];
}

export async function buildConsolidatedDeckData(
  tenantId: string,
  opts: { period: DeckPeriod; customerId: string; asOf: Date },
): Promise<ConsolidatedDeckData> {
  const customer = await prisma.customer.findFirst({
    where: { id: opts.customerId, tenantId },
    select: { companyName: true },
  });
  if (!customer) throw new AppError('Customer not found.', 404);

  const groups = await prisma.iTSMRecord.groupBy({
    by: ['plant'],
    where: { tenantId, customerId: opts.customerId },
  });
  const plantNames = groups.map((g) => g.plant).filter((p): p is string => !!p && p.trim() !== '');
  const hasUnassigned = groups.some((g) => !g.plant || g.plant.trim() === '');

  const blocks: PlantBlock[] = [];
  for (const name of plantNames) {
    const data = await buildStatusDeckData(tenantId, { ...opts, plant: name });
    blocks.push({ label: plantShortName(name, customer.companyName), data });
  }
  blocks.sort((a, b) => a.label.localeCompare(b.label));
  if (hasUnassigned) {
    // Tickets raised without a plant still count — otherwise the totals would silently under-report.
    const data = await buildStatusDeckData(tenantId, { ...opts, noPlant: true });
    blocks.push({ label: 'NO PLANT', data });
  }

  const plants = blocks.filter((b) => b.data.current.total > 0 || b.data.previous.total > 0);
  const sum = (pick: (d: StatusDeckData) => BucketCounts): BucketCounts => {
    const t = emptyCounts();
    for (const b of plants) {
      const c = pick(b.data);
      t.total += c.total; t.closed += c.closed; t.open += c.open; t.uat += c.uat; t.awaitingHold += c.awaitingHold;
    }
    return t;
  };
  const previousAsOf = endOfDay(opts.period === 'weekly' ? subDays(opts.asOf, 7) : subMonths(opts.asOf, 1));
  return {
    period: opts.period,
    customerName: customer.companyName,
    asOf: opts.asOf,
    previousAsOf,
    current: sum((d) => d.current),
    previous: sum((d) => d.previous),
    plants,
  };
}

export function consolidatedDeckFileName(data: ConsolidatedDeckData): string {
  const customerShort = data.customerName.split(/\s+/)[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
  const kind = data.period === 'weekly' ? 'Weekly' : 'Monthly';
  return `${customerShort}_Consolidated_${kind}_Status_${format(data.asOf, 'dd_MM_yyyy')}.pptx`;
}

const K = {
  navy: '1E2761', grey: '4A4A4A', card: 'F4F6FB', cardLine: 'E3E7F0', amber: 'F2A900', green: '2C7A4B', red: 'B5453A',
  rowA: 'FDF3DC', rowB: 'FFFFFF', tableLine: 'EFD9A0', sub: 'CADCFC', ink: '1D252C', white: 'FFFFFF', footerText: '9AA7B5',
};
const ARROW = { code: '27A2', indent: 24 };

function kFooter(pptx: PptxGenJS, slide: PptxGenJS.Slide) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: FOOTER_Y, w: SLIDE_W, h: 7.5 - FOOTER_Y, fill: { color: K.ink }, line: { color: K.ink } });
  slide.addImage({ path: asset('intraedge-logo-footer.png'), x: 0.3, y: FOOTER_Y + 0.08, w: 1.45, h: 0.378 });
  slide.addText(CONFIDENTIAL, { x: 2.2, y: FOOTER_Y, w: 8.9, h: 7.5 - FOOTER_Y, align: 'center', valign: 'middle', fontFace: 'Calibri', fontSize: 9, color: K.footerText });
  slide.slideNumber = { x: 12.2, y: FOOTER_Y, w: 0.8, h: 7.5 - FOOTER_Y, align: 'right', valign: 'middle', fontFace: 'Calibri', fontSize: 9, color: K.footerText };
}

// White slide with the amber kicker line ("SEPC — WEEKLY REVIEW"), optional title and customer logo.
function kSlide(pptx: PptxGenJS, kicker: string, title?: string, customerName?: string): PptxGenJS.Slide {
  const slide = pptx.addSlide();
  slide.background = { color: K.white };
  slide.addText(kicker, { x: 0.6, y: 0.35, w: 9, h: 0.35, fontFace: 'Calibri', fontSize: 12, bold: true, color: K.amber, charSpacing: 3, valign: 'middle' });
  if (title) slide.addText(title, { x: 0.6, y: 0.68, w: 9.9, h: 0.7, fontFace: 'Cambria', fontSize: 28, bold: true, color: K.navy, valign: 'middle' });
  const logo = customerName ? customerLogo(customerName) : null;
  if (logo) slide.addImage({ path: logo, x: 10.72, y: 0.31, w: 2.37, h: 0.553 });
  kFooter(pptx, slide);
  return slide;
}

function kCards(pptx: PptxGenJS, slide: PptxGenJS.Slide, c: BucketCounts) {
  const cards = [
    { v: c.total, l: 'TOTAL ISSUES', col: K.navy },
    { v: c.closed, l: 'RESOLVED & CLOSED', col: K.green },
    { v: c.open, l: 'OPEN', col: K.red },
    { v: c.uat, l: 'IN UAT', col: K.amber },
    { v: c.awaitingHold, l: 'AWAITING & HOLD', col: K.navy },
  ];
  const xs = [0.6, 3.08, 5.55, 8.03, 10.5];
  cards.forEach((card, i) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: xs[i], y: 1.7, w: 2.23, h: 1.7, rectRadius: 0.06,
      fill: { color: K.card }, line: { color: K.cardLine, width: 0.75 },
      shadow: { type: 'outer', color: '000000', opacity: 0.12, blur: 5, offset: 2, angle: 90 },
    });
    slide.addText(String(card.v), { x: xs[i], y: 1.85, w: 2.23, h: 0.85, align: 'center', valign: 'middle', fontFace: 'Cambria', fontSize: 38, bold: true, color: card.col });
    slide.addText(card.l, { x: xs[i] + 0.1, y: 2.75, w: 2.03, h: 0.55, align: 'center', valign: 'middle', fontFace: 'Calibri', fontSize: 11, color: K.grey, charSpacing: 2 });
  });
}

function kCover(pptx: PptxGenJS, data: ConsolidatedDeckData) {
  const slide = pptx.addSlide();
  slide.background = { color: K.ink };
  slide.addImage({ path: asset('cover.jpg'), x: 0, y: 0, w: SLIDE_W, h: 7.5 });
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: SLIDE_W, h: 7.5, fill: { color: '000000', transparency: 48 }, line: { type: 'none' } });
  slide.addImage({ path: asset('intraedge-logo-cover.png'), x: 10.45, y: 0.45, w: 2.2, h: 0.62 });
  const kind = data.period === 'weekly' ? 'Weekly' : 'Monthly';
  slide.addText('SAP SUPPORT — TICKET STATUS REPORT', { x: 0.8, y: 2.15, w: 10, h: 0.4, fontFace: 'Calibri', fontSize: 16, bold: true, color: K.amber, charSpacing: 3 });
  slide.addText(`Consolidated ${kind} Review: Ticket Summary`, { x: 0.8, y: 2.55, w: 11.5, h: 1.3, valign: 'top', fontFace: 'Cambria', fontSize: 40, bold: true, color: K.white });
  slide.addText(data.plants.map((p) => p.label).join('   •   '), { x: 0.8, y: 4.0, w: 11.5, h: 0.5, fontFace: 'Calibri', fontSize: 20, color: K.sub });
  const day = data.asOf.getDate();
  slide.addText(
    [{ text: String(day), options: {} }, { text: ordinal(day), options: { superscript: true } }, { text: `   ${format(data.asOf, 'MMMM, yyyy')}`, options: {} }],
    { x: 0.8, y: 4.7, w: 6, h: 0.5, fontFace: 'Calibri', fontSize: 16, bold: true, color: K.white },
  );
  slide.addText(CONFIDENTIAL, { x: 0.15, y: 6.95, w: 9, h: 0.4, fontFace: 'Calibri', fontSize: 9, color: K.footerText });
}

function kExecutiveSummary(pptx: PptxGenJS, data: ConsolidatedDeckData) {
  const slide = kSlide(pptx, 'ALL PLANTS COMBINED', 'Executive Summary — Support Ticket Overview', data.customerName);
  kCards(pptx, slide, data.current);
  slide.addText('Definitions', { x: 0.6, y: 3.75, w: 6, h: 0.35, fontFace: 'Calibri', fontSize: 14, bold: true, color: K.navy });
  const defs = [
    'OPEN – Tickets in progress with IntraEdge',
    'IN UAT – Tickets in User Acceptance Test; move to Production once confirmed',
    'AWAITING / HOLD – Tickets waiting on inputs from the respective plant',
  ];
  slide.addText(defs.map((t) => ({ text: t, options: { bullet: ARROW, breakLine: true, paraSpaceAfter: 8 } })),
    { x: 0.6, y: 4.15, w: 11.5, h: 1.8, valign: 'top', fontFace: 'Calibri', fontSize: 14, color: K.grey });
}

function kPlantComparison(pptx: PptxGenJS, data: ConsolidatedDeckData) {
  const slide = kSlide(pptx, 'PLANT-WISE COMPARISON', 'Ticket Status by Plant');
  const labels = data.plants.map((p) => p.label);
  const col = (pick: (c: BucketCounts) => number) => data.plants.map((p) => pick(p.data.current));
  slide.addChart(
    pptx.ChartType.bar,
    [
      { name: 'Resolved & Closed', labels, values: col((c) => c.closed) },
      { name: 'Open', labels, values: col((c) => c.open) },
      { name: 'In UAT', labels, values: col((c) => c.uat) },
      { name: 'Awaiting & Hold', labels, values: col((c) => c.awaitingHold) },
    ],
    {
      x: 0.5, y: 1.6, w: 6.4, h: 5.0, barDir: 'col', barGrouping: 'stacked',
      chartColors: [K.green, K.red, K.amber, K.navy],
      showTitle: true, title: 'Tickets by Status per Plant', titleFontSize: 14, titleColor: K.grey, titleFontFace: 'Calibri',
      showLegend: true, legendPos: 'b', legendFontSize: 10,
      showValue: true, dataLabelColor: K.white, dataLabelFontSize: 10, dataLabelFormatCode: '#,##0;;;',
      catAxisLabelFontSize: 11, valAxisLabelFontSize: 10,
      valGridLine: { color: 'E5E7EB', size: 0.75 }, catGridLine: { style: 'none' },
    },
  );

  const head = (t: string) => ({ text: t, options: { bold: true, color: K.white, fill: { color: K.amber }, align: 'center' as const, fontFace: 'Calibri', fontSize: 10.5, valign: 'middle' as const } });
  const cell = (t: string | number, i: number) => ({ text: String(t), options: { color: K.navy, fill: { color: i % 2 === 0 ? K.rowA : K.rowB }, align: 'center' as const, fontFace: 'Calibri', fontSize: 12, valign: 'middle' as const } });
  const row = (name: string, pick: (c: BucketCounts) => number, i: number) => [
    cell(name, i), ...data.plants.map((p) => cell(pick(p.data.current), i)), cell(pick(data.current), i),
  ];
  const rows = [
    [head('Metric'), ...data.plants.map((p) => head(p.label)), head('Total')],
    row('Total Issues', (c) => c.total, 0),
    row('Resolved & Closed', (c) => c.closed, 1),
    row('Open', (c) => c.open, 2),
    row('In UAT', (c) => c.uat, 3),
    row('Awaiting & Hold', (c) => c.awaitingHold, 4),
  ];
  const nCols = data.plants.length + 2;
  const metricW = 1.7;
  const otherW = Math.min(1.05, (5.9 - metricW) / (nCols - 1));
  slide.addTable(rows, {
    x: 7.2, y: 1.9, w: metricW + otherW * (nCols - 1), colW: [metricW, ...Array(nCols - 1).fill(otherW)],
    rowH: 0.52, border: { type: 'solid', pt: 0.75, color: K.tableLine }, margin: [0.03, 0.06, 0.03, 0.06],
  });
}

function kPlantSummary(pptx: PptxGenJS, data: ConsolidatedDeckData, block: PlantBlock) {
  const slide = kSlide(pptx, `${block.label} — ${data.period === 'weekly' ? 'WEEKLY' : 'MONTHLY'} REVIEW`, 'Support Ticket Summary');
  kCards(pptx, slide, block.data.current);
  const p = block.data.previous;
  slide.addText('Previous  Ticket Status', { x: 0.6, y: 3.75, w: 6, h: 0.35, fontFace: 'Calibri', fontSize: 14, bold: true, color: K.navy });
  const lines = [`Total Tickets – ${p.total}`, `Closed / Resolved – ${p.closed}`, `Open / In Progress – ${p.open}`, `In UAT – ${p.uat}`, `Awaiting / Hold – ${p.awaitingHold}`];
  slide.addText(lines.map((t) => ({ text: t, options: { bullet: ARROW, breakLine: true, paraSpaceAfter: 6 } })),
    { x: 0.6, y: 4.15, w: 5.8, h: 2.4, valign: 'top', fontFace: 'Calibri', fontSize: 16, color: K.navy });
  slide.addText('Definitions', { x: 6.9, y: 3.75, w: 6, h: 0.35, fontFace: 'Calibri', fontSize: 14, bold: true, color: K.navy });
  const waiting = block.label === 'NO PLANT' ? 'the respective plant' : block.label;
  const defs = [
    'OPEN – Tickets which are In Progress with IntraEdge',
    'IN UAT – Tickets in User Acceptance Test; moved to Production once confirmed',
    `AWAITING / HOLD – Tickets waiting for inputs from ${waiting}`,
  ];
  slide.addText(defs.map((t) => ({ text: t, options: { bullet: ARROW, breakLine: true, paraSpaceAfter: 8 } })),
    { x: 6.9, y: 4.15, w: 5.8, h: 2.4, valign: 'top', fontFace: 'Calibri', fontSize: 13, color: K.grey });
}

// ── per-plant ticket tables: sections are flowed onto as few slides as fit ──

const K_TABLE_W = 12.15;
const K_BOTTOM = FOOTER_Y - 0.2;
const K_HEAD_H = 0.45;
const K_SECTION_TITLE_H = 0.75;

function kRowH(text: string, colW: number): number {
  const charsPerLine = Math.max(8, Math.floor(colW * 11));
  const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
  return Math.max(0.42, lines * 0.26 + 0.16);
}

interface KSection {
  title: string;
  cols: { header: string; w: number }[];
  rows: string[][]; // cells after Sno: [ticket id, details, (remarks)]
  remarksCol?: number; // index into cols of the Remarks column (left blank)
}

function kAddSections(pptx: PptxGenJS, plantLabel: string, customerName: string, sections: KSection[]) {
  let slide: PptxGenJS.Slide | null = null;
  let y = 0;

  for (const sec of sections) {
    if (!sec.rows.length) continue; // empty categories are left out, as in the reference deck
    const detailsW = sec.cols[2].w;
    const hOf = (r: string[]) => kRowH(r[1] ?? '', detailsW);
    let remaining = sec.rows.map((r, i) => ({ r, sno: i + 1 }));
    let continued = false;

    while (remaining.length) {
      if (slide && y + K_SECTION_TITLE_H + K_HEAD_H + hOf(remaining[0].r) > K_BOTTOM) slide = null;
      if (!slide) { slide = kSlide(pptx, plantLabel, undefined, customerName); y = 0.7; }

      const titleY = y;
      const tableY = titleY + K_SECTION_TITLE_H;
      let used = K_HEAD_H;
      const take: typeof remaining = [];
      for (const item of remaining) {
        const h = hOf(item.r);
        if (take.length && tableY + used + h > K_BOTTOM) break;
        take.push(item);
        used += h;
      }

      slide.addText(continued ? `${sec.title} (contd.)` : sec.title,
        { x: 0.6, y: titleY, w: 11.5, h: 0.7, fontFace: 'Cambria', fontSize: 26, bold: true, color: K.navy, valign: 'middle' });

      const header = sec.cols.map((c) => ({
        text: c.header,
        options: { bold: true, color: K.white, fill: { color: K.amber }, fontFace: 'Calibri', fontSize: 11.5, valign: 'middle' as const },
      }));
      const body = take.map((item, ri) => {
        const fill = { color: ri % 2 === 0 ? K.rowA : K.rowB };
        return [String(item.sno), ...item.r].map((t, ci) => ({
          text: t,
          options: { color: ci === sec.remarksCol ? K.navy : '000000', fill, fontFace: 'Calibri', fontSize: 14, valign: 'middle' as const },
        }));
      });
      slide.addTable([header, ...body], {
        x: 0.6, y: tableY, w: K_TABLE_W, colW: sec.cols.map((c) => c.w),
        rowH: [K_HEAD_H, ...take.map((t) => hOf(t.r))],
        border: { type: 'solid', pt: 0.75, color: K.tableLine }, margin: [0.03, 0.08, 0.03, 0.08],
      });

      y = tableY + used + 0.3;
      remaining = remaining.slice(take.length);
      if (remaining.length) { slide = null; continued = true; }
    }
  }
}

// Previous vs current comparison (chart + table with the change per metric).
// Used once for all plants combined and once per plant.
function kComparison(pptx: PptxGenJS, data: ConsolidatedDeckData, kicker: string, current: BucketCounts, previous: BucketCounts, customerName?: string) {
  const weekly = data.period === 'weekly';
  const unit = weekly ? 'Week' : 'Month';
  const slide = kSlide(pptx, kicker, `${unit}-over-${unit} Comparison`, customerName);
  const prevDate = format(data.previousAsOf, 'dd-MM-yyyy');
  const curDate = format(data.asOf, 'dd-MM-yyyy');

  // good = which direction of change is an improvement (null = just informational)
  const metrics: { label: string; pick: (c: BucketCounts) => number; good: 'up' | 'down' | null }[] = [
    { label: 'Total Issues', pick: (c) => c.total, good: null },
    { label: 'Resolved & Closed', pick: (c) => c.closed, good: 'up' },
    { label: 'Open', pick: (c) => c.open, good: 'down' },
    { label: 'In UAT', pick: (c) => c.uat, good: null },
    { label: 'Awaiting & Hold', pick: (c) => c.awaitingHold, good: 'down' },
  ];

  const chartMetrics = metrics.slice(1); // "Total" would dwarf the other bars; it is in the table
  const labels = chartMetrics.map((m) => m.label);
  slide.addChart(
    pptx.ChartType.bar,
    [
      { name: `Previous ${unit}`, labels, values: chartMetrics.map((m) => m.pick(previous)) },
      { name: `Current ${unit}`, labels, values: chartMetrics.map((m) => m.pick(current)) },
    ],
    {
      x: 0.5, y: 1.6, w: 6.4, h: 5.0, barDir: 'col', barGrouping: 'clustered', barGapWidthPct: 60,
      chartColors: ['9AA7B5', K.navy],
      showTitle: true, title: `Previous vs Current ${unit}`, titleFontSize: 14, titleColor: K.grey, titleFontFace: 'Calibri',
      showLegend: true, legendPos: 'b', legendFontSize: 10,
      showValue: true, dataLabelColor: K.grey, dataLabelFontSize: 10, dataLabelPosition: 'outEnd',
      catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
      valGridLine: { color: 'E5E7EB', size: 0.75 }, catGridLine: { style: 'none' },
    },
  );

  const head = (t: string) => ({ text: t, options: { bold: true, color: K.white, fill: { color: K.amber }, align: 'center' as const, fontFace: 'Calibri', fontSize: 11, valign: 'middle' as const } });
  const rows = [
    [head('Metric'), head(`Previous\n${prevDate}`), head(`Current\n${curDate}`), head('Change')],
    ...metrics.map((m, i) => {
      const before = m.pick(previous);
      const now = m.pick(current);
      const diff = now - before;
      const text = diff === 0 ? '–  0' : diff > 0 ? `▲ +${diff}` : `▼ −${Math.abs(diff)}`;
      const color = diff === 0 || !m.good ? K.navy : (diff > 0) === (m.good === 'up') ? K.green : K.red;
      const fill = { color: i % 2 === 0 ? K.rowA : K.rowB };
      const base = { fill, fontFace: 'Calibri', fontSize: 12, valign: 'middle' as const, align: 'center' as const };
      return [
        { text: m.label, options: { ...base, color: K.navy } },
        { text: String(before), options: { ...base, color: K.navy } },
        { text: String(now), options: { ...base, color: K.navy, bold: true } },
        { text, options: { ...base, color, bold: true } },
      ];
    }),
  ];
  slide.addTable(rows, {
    x: 7.2, y: 1.9, w: 5.6, colW: [1.9, 1.2, 1.2, 1.3], rowH: [0.7, 0.52, 0.52, 0.52, 0.52, 0.52],
    border: { type: 'solid', pt: 0.75, color: K.tableLine }, margin: [0.03, 0.06, 0.03, 0.06],
  });
  slide.addText('Change: green = improvement, red = needs attention.', {
    x: 7.2, y: 5.2, w: 5.6, h: 0.35, fontFace: 'Calibri', fontSize: 11, italic: true, color: K.grey,
  });
}

export async function generateConsolidatedDeck(data: ConsolidatedDeckData): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `${data.customerName} consolidated ${data.period} ticket status`;
  pptx.company = 'IntraEdge';

  kCover(pptx, data);
  kExecutiveSummary(pptx, data);
  kPlantComparison(pptx, data);
  kComparison(pptx, data, 'ALL PLANTS COMBINED', data.current, data.previous, data.customerName);

  for (const block of data.plants) {
    kPlantSummary(pptx, data, block);
    kComparison(pptx, data, `${block.label} — ${data.period === 'weekly' ? 'WEEKLY' : 'MONTHLY'} REVIEW`, block.data.current, block.data.previous);
    const d = block.data;
    const idTitle = (t: DeckTicket) => [t.recordNumber, t.title];
    const withRemarks = { remarksCol: 3 };
    const remarksCols = [{ header: 'Sno', w: 0.65 }, { header: 'Ticket ID', w: 1.9 }, { header: 'Ticket Details', w: 6.1 }, { header: 'Remarks', w: 3.5 }];
    kAddSections(pptx, block.label, data.customerName, [
      { title: 'Open Tickets and Target Dates', cols: remarksCols, rows: d.openTickets.map((t) => [...idTitle(t), '']), ...withRemarks },
      { title: 'UAT Tickets', cols: [{ header: 'Sno', w: 0.65 }, { header: 'Ticket ID', w: 1.9 }, { header: 'Ticket Details', w: 9.6 }], rows: d.uatTickets.map(idTitle) },
      { title: 'Awaiting & Hold Tickets', cols: remarksCols, rows: d.awaitingHoldTickets.map((t) => [...idTitle(t), '']), ...withRemarks },
    ]);
  }

  addClosingSlide(pptx);
  const out = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(out as Uint8Array);
}
