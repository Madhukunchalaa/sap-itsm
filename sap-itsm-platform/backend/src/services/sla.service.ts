import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { emailQueue } from '../workers/queues';
import { notify } from './notifications/notification.service';
import { auditLog } from '../utils/audit';
import { SLA_WARNING_THRESHOLD, SLA_STOP_STATUSES } from '../config/constants';
import { addMinutes, isWithinInterval, parseISO } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

/**
 * Core SLA processor — runs every 60 seconds via BullMQ.
 * ALL SLA computation is server-side. Never on frontend.
 */
export async function processSLAChecks(): Promise<void> {
  const now = new Date();

  // Fetch all active SLA records not yet breached / stopped
  const activeRecords = await prisma.sLATracking.findMany({
    where: {
      record: {
        status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] },
      },
      OR: [
        { breachResolution: false },
        { breachResponse: false },
        { warningResponseSent: false },
        { warningResolutionSent: false },
      ],
    },
    include: {
      record: {
        select: {
          id: true,
          tenantId: true,
          recordNumber: true,
          priority: true,
          status: true,
          title: true,
          assignedAgentId: true,
          contractId: true,
          createdAt: true,
          customer: { select: { companyName: true } },
          assignedAgent: {
            select: { user: { select: { email: true, firstName: true, lastName: true } } },
          },
          createdBy: { select: { email: true, firstName: true } },
        },
      },
    },
  });

  logger.info(`SLA check: processing ${activeRecords.length} active records`);

  for (const sla of activeRecords) {
    try {
      await processSingleSLA(sla, now);
    } catch (err) {
      logger.error(`SLA processing error for record ${sla.recordId}:`, err);
    }
  }
}

async function processSingleSLA(sla: any, now: Date): Promise<void> {
  const record = sla.record;
  const updates: Record<string, unknown> = {};
  const jobs: Array<{ name: string; data: { recordId: string; tenantId: string; event: string; slaType: string; deadline?: Date } }> = [];

  const effectiveNow = sla.pausedAt ? sla.pausedAt : now;

  // Load warning threshold from SLA Policy (fallback to 0.80)
  let warningThreshold = SLA_WARNING_THRESHOLD;
  if (record.contractId) {
    const contract = await prisma.contract.findUnique({
      where: { id: record.contractId },
      select: { slaPolicyMaster: { select: { warningThreshold: true } } },
    });
    if (contract?.slaPolicyMaster?.warningThreshold) {
      warningThreshold = contract.slaPolicyMaster.warningThreshold;
    }
  }

  // ── Response SLA ──────────────────────────────────────────
  if (!sla.breachResponse && !sla.record.respondedAt) {
    const responseDeadline = sla.responseDeadline;
    const totalMs = responseDeadline.getTime() - (sla.record.createdAt.getTime());
    const elapsedMs = effectiveNow.getTime() - sla.record.createdAt.getTime();
    const elapsedRatio = elapsedMs / totalMs;

    if (now > responseDeadline) {
      updates.breachResponse = true;
      jobs.push({
        name: 'sla-breach',
        data: {
          recordId: record.id,
          tenantId: record.tenantId,
          event: 'SLA_BREACH_RESPONSE',
          slaType: 'RESPONSE',
        },
      });
      await auditLog({
        tenantId: record.tenantId,
        recordId: record.id,
        action: 'BREACH',
        entityType: 'SLATracking',
        entityId: sla.id,
        newValues: { slaType: 'RESPONSE', breachTime: now },
      });
    } else if (!sla.warningResponseSent && elapsedRatio >= warningThreshold) {
      updates.warningResponseSent = true;
      jobs.push({
        name: 'sla-warning',
        data: {
          recordId: record.id,
          tenantId: record.tenantId,
          event: 'SLA_WARNING_RESPONSE',
          slaType: 'RESPONSE',
          deadline: responseDeadline,
        },
      });
    }
  }

  // ── Resolution SLA ────────────────────────────────────────
  if (!sla.breachResolution) {
    const resolutionDeadline = sla.resolutionDeadline;
    const totalMs = resolutionDeadline.getTime() - sla.record.createdAt.getTime();
    const elapsedMs = effectiveNow.getTime() - sla.record.createdAt.getTime();
    const elapsedRatio = elapsedMs / totalMs;

    if (now > resolutionDeadline) {
      updates.breachResolution = true;
      jobs.push({
        name: 'sla-breach',
        data: {
          recordId: record.id,
          tenantId: record.tenantId,
          event: 'SLA_BREACH_RESOLUTION',
          slaType: 'RESOLUTION',
        },
      });
      await auditLog({
        tenantId: record.tenantId,
        recordId: record.id,
        action: 'BREACH',
        entityType: 'SLATracking',
        entityId: sla.id,
        newValues: { slaType: 'RESOLUTION', breachTime: now },
      });
    } else if (!sla.warningResolutionSent && elapsedRatio >= warningThreshold) {
      updates.warningResolutionSent = true;
      jobs.push({
        name: 'sla-warning',
        data: {
          recordId: record.id,
          tenantId: record.tenantId,
          event: 'SLA_WARNING_RESOLUTION',
          slaType: 'RESOLUTION',
          deadline: resolutionDeadline,
        },
      });
    }
  }

  // Apply DB updates
  if (Object.keys(updates).length > 0) {
    await prisma.sLATracking.update({
      where: { id: sla.id },
      data: updates,
    });
  }

  // Send notifications via notification rules
  for (const job of jobs) {
    const { event, recordId: rid, tenantId: tid, slaType } = job.data;
    const slaEvent = event.includes('BREACH') ? 'SLA_BREACH' : 'SLA_WARNING';
    await notify({
      event: slaEvent,
      recordId: rid,
      tenantId: tid,
      triggeredBy: 'system',
      payload: { slaType },
    });
  }
}

/**
 * Check whether SLA should be tracked for a given record based on
 * the contract's SupportTypeMaster configuration.
 * Returns false if: priorityScope is P1_ONLY and record is not P1,
 *                   or slaEnabled[priority] is explicitly false.
 */
export async function isSLAApplicable(contractId: string, priority: string): Promise<boolean> {
  if (!contractId) return true;

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: {
      supportTypeMaster: { select: { priorityScope: true, slaEnabled: true } },
      slaPolicyMaster:   { select: { priorities: true } },
    },
  });

  if (!contract) return true;

  // Check support type priority scope
  const st = contract.supportTypeMaster;
  if (st) {
    if (st.priorityScope === 'P1_ONLY' && priority !== 'P1') return false;
    if (st.priorityScope === 'P1_P2' && !['P1','P2'].includes(priority)) return false;
    const slaEnabled = st.slaEnabled as Record<string, boolean> | null;
    if (slaEnabled && slaEnabled[priority] === false) return false;
  }

  // Check SLA policy has a target for this priority
  const slap = contract.slaPolicyMaster;
  if (slap) {
    const priorities = slap.priorities as Record<string, { response: number; resolution: number; enabled?: boolean }>;
    const target = priorities[priority];
    if (!target || target.enabled === false) return false;
  }

  return true;
}


/**
 * Calculate effective SLA deadline considering:
 * - Business hours only (shift schedule)
 * - Holiday exclusions
 * - After-hours multiplier
 * - Weekend multiplier
 * - Paused time
 */
export async function calculateSLADeadline(params: {
  startTime: Date;
  targetMinutes: number;
  contractId: string;
  timezone: string;
}): Promise<Date> {
  const { startTime, targetMinutes, contractId, timezone } = params;

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: {
      shifts: { include: { shift: true } },
      holidayCalendars: { include: { holidayCalendar: { include: { dates: true } } } },
      supportTypeMaster: { select: { workDays: true, slaPauseConditions: true } },
    },
  });

  if (!contract || !contract.shifts.length) {
    // No shift configured: add raw minutes
    return new Date(startTime.getTime() + targetMinutes * 60 * 1000);
  }

  // Build set of holiday dates from the calendar
  // ALL dates in the calendar are holidays — whether SLA pauses on them
  // is controlled by SupportTypeMaster.slaPauseConditions, not by the date itself
  const pauseConditions: string[] = (contract as any).supportTypeMaster?.slaPauseConditions || [];
  const slaFreezesOnHolidays = pauseConditions.includes('HOLIDAY');

  const holidays = new Set<string>();
  if (slaFreezesOnHolidays) {
    for (const ch of contract.holidayCalendars) {
      for (const hd of ch.holidayCalendar.dates) {
        holidays.add(hd.date.toISOString().split('T')[0]);
      }
    }
  }
  // If slaFreezesOnHolidays is false, holidays set stays empty — 
  // SLA runs normally on holiday dates as per Support Type policy

  const shift = contract.shifts[0].shift;
  const [startHour, startMin] = shift.startTime.split(':').map(Number);
  const [endHour, endMin] = shift.endTime.split(':').map(Number);

  // Work days come from Support Type Master, not from the Shift
  // Fall back to Mon-Fri if no support type configured
  const supportWorkDays = (contract as any).supportTypeMaster?.workDays;
  const workDays = new Set<number>(supportWorkDays || [1,2,3,4,5]);

  let remaining = targetMinutes;
  let current = new Date(startTime);

  // Add minutes only during working hours
  while (remaining > 0) {
    const zonedCurrent = toZonedTime(current, timezone);
    const dayOfWeek = zonedCurrent.getDay();
    const dateStr = zonedCurrent.toISOString().split('T')[0];
    const hour = zonedCurrent.getHours();
    const minute = zonedCurrent.getMinutes();
    const minuteOfDay = hour * 60 + minute;
    const shiftStart = startHour * 60 + startMin;
    const shiftEnd = endHour * 60 + endMin;

    if (
      workDays.has(dayOfWeek) &&
      !holidays.has(dateStr) &&
      minuteOfDay >= shiftStart &&
      minuteOfDay < shiftEnd
    ) {
      const minutesToShiftEnd = shiftEnd - minuteOfDay;
      const consume = Math.min(remaining, minutesToShiftEnd);
      remaining -= consume;
      current = addMinutes(current, consume);
    } else {
      // Skip to next shift start
      current = getNextShiftStart(current, workDays, timezone, startHour, startMin, holidays);
    }
  }

  return current;
}

function getNextShiftStart(
  current: Date,
  workDays: Set<number>,
  timezone: string,
  startHour: number,
  startMin: number,
  holidays: Set<string>
): Date {
  let next = new Date(current);
  next.setMinutes(0, 0, 0);

  for (let i = 0; i < 14; i++) {
    next = addMinutes(next, 24 * 60);
    const zoned = toZonedTime(next, timezone);
    const dateStr = zoned.toISOString().split('T')[0];

    if (workDays.has(zoned.getDay()) && !holidays.has(dateStr)) {
      zoned.setHours(startHour, startMin, 0, 0);
      return fromZonedTime(zoned, timezone);
    }
  }

  return addMinutes(current, 24 * 60); // fallback
}

/**
 * Get SLA health percentage (0-100) for a record.
 */
export function getSLAHealth(sla: {
  responseDeadline: Date;
  resolutionDeadline: Date;
  respondedAt?: Date | null;
  breachResponse: boolean;
  breachResolution: boolean;
  createdAt: Date;
}): { responsePercent: number; resolutionPercent: number; status: string } {
  const now = new Date();

  const responseTotal = sla.responseDeadline.getTime() - sla.createdAt.getTime();
  const responseElapsed = now.getTime() - sla.createdAt.getTime();
  const responsePercent = Math.min(100, Math.round((responseElapsed / responseTotal) * 100));

  const resolutionTotal = sla.resolutionDeadline.getTime() - sla.createdAt.getTime();
  const resolutionElapsed = now.getTime() - sla.createdAt.getTime();
  const resolutionPercent = Math.min(100, Math.round((resolutionElapsed / resolutionTotal) * 100));

  let status = 'ON_TRACK';
  if (sla.breachResponse || sla.breachResolution) status = 'BREACHED';
  else if (responsePercent >= 80 || resolutionPercent >= 80) status = 'AT_RISK';

  return { responsePercent, resolutionPercent, status };
}
