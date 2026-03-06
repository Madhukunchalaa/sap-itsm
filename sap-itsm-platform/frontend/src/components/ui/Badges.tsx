import React from 'react';

// ── Priority Badge ────────────────────────────────────────────
const PRIORITY_MAP: Record<string, { label: string; classes: string }> = {
  P1: { label: 'P1 Critical', classes: 'bg-red-100 text-red-800 border border-red-200' },
  P2: { label: 'P2 High',     classes: 'bg-orange-100 text-orange-800 border border-orange-200' },
  P3: { label: 'P3 Medium',   classes: 'bg-yellow-100 text-yellow-800 border border-yellow-200' },
  P4: { label: 'P4 Low',      classes: 'bg-green-100 text-green-800 border border-green-200' },
};

export function PriorityBadge({ priority, short }: { priority: string; short?: boolean }) {
  const cfg = PRIORITY_MAP[priority] || { label: priority, classes: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.classes}`}>
      {short ? priority : cfg.label}
    </span>
  );
}

// ── Status Badge ──────────────────────────────────────────────
const STATUS_MAP: Record<string, { label: string; classes: string }> = {
  NEW:         { label: 'New',         classes: 'bg-blue-100 text-blue-800' },
  OPEN:        { label: 'Open',        classes: 'bg-indigo-100 text-indigo-800' },
  IN_PROGRESS: { label: 'In Progress', classes: 'bg-purple-100 text-purple-800' },
  PENDING:     { label: 'Pending',     classes: 'bg-yellow-100 text-yellow-800' },
  RESOLVED:    { label: 'Resolved',    classes: 'bg-green-100 text-green-800' },
  CLOSED:      { label: 'Closed',      classes: 'bg-gray-100 text-gray-600' },
  CANCELLED:   { label: 'Cancelled',   classes: 'bg-red-50 text-red-500' },
};

export function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_MAP[status] || { label: status, classes: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

// ── Record Type Badge ─────────────────────────────────────────
const TYPE_MAP: Record<string, { label: string; classes: string }> = {
  INCIDENT: { label: 'Incident', classes: 'bg-red-50 text-red-700 border border-red-200' },
  REQUEST:  { label: 'Request',  classes: 'bg-blue-50 text-blue-700 border border-blue-200' },
  PROBLEM:  { label: 'Problem',  classes: 'bg-purple-50 text-purple-700 border border-purple-200' },
  CHANGE:   { label: 'Change',   classes: 'bg-teal-50 text-teal-700 border border-teal-200' },
};

export function TypeBadge({ type }: { type: string }) {
  const cfg = TYPE_MAP[type] || { label: type, classes: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

// ── SLA Badge ─────────────────────────────────────────────────
interface SLABadgeProps {
  breachResponse?: boolean;
  breachResolution?: boolean;
  responseDeadline?: string | Date;
  resolutionDeadline?: string | Date;
  compact?: boolean;
}

export function SLABadge({ breachResponse, breachResolution, responseDeadline, resolutionDeadline, compact }: SLABadgeProps) {
  if (!responseDeadline && !resolutionDeadline) {
    return <span className="text-xs text-gray-400">No SLA</span>;
  }

  const now = new Date();
  const resDeadline = resolutionDeadline ? new Date(resolutionDeadline) : null;

  let status: 'breached' | 'at-risk' | 'ok' = 'ok';
  let timeLabel = '';

  if (breachResolution || breachResponse) {
    status = 'breached';
    timeLabel = 'BREACHED';
  } else if (resDeadline) {
    const msLeft = resDeadline.getTime() - now.getTime();
    const hrsLeft = msLeft / 3600000;
    if (hrsLeft < 1) status = 'at-risk';
    else if (hrsLeft < 2) status = 'at-risk';

    const absHrs = Math.abs(Math.floor(hrsLeft));
    const absMins = Math.abs(Math.floor((msLeft % 3600000) / 60000));
    timeLabel = msLeft < 0 ? `${absHrs}h ${absMins}m ago` : `${absHrs}h ${absMins}m left`;
  }

  const colorMap = {
    breached: 'bg-red-100 text-red-700 border border-red-300',
    'at-risk': 'bg-orange-100 text-orange-700 border border-orange-300',
    ok:        'bg-green-100 text-green-700 border border-green-300',
  };

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colorMap[status]}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${status === 'breached' ? 'bg-red-500' : status === 'at-risk' ? 'bg-orange-500' : 'bg-green-500'}`} />
        {timeLabel || (status === 'ok' ? 'On Track' : 'At Risk')}
      </span>
    );
  }

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${colorMap[status]}`}>
      <span className={`w-2 h-2 rounded-full animate-pulse ${status === 'breached' ? 'bg-red-500' : status === 'at-risk' ? 'bg-orange-500' : 'bg-green-500'}`} />
      SLA: {timeLabel || 'On Track'}
    </div>
  );
}

// ── Agent Level Badge ─────────────────────────────────────────
export function LevelBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    L1: 'bg-gray-100 text-gray-600',
    L2: 'bg-blue-100 text-blue-700',
    L3: 'bg-purple-100 text-purple-700',
    SPECIALIST: 'bg-amber-100 text-amber-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${map[level] || 'bg-gray-100 text-gray-600'}`}>
      {level}
    </span>
  );
}
