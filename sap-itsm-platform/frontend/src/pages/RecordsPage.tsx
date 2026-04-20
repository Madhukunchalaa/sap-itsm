import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, Plus, X, Download } from 'lucide-react';
import { useRecords, useSapModules, useAgents } from '../hooks/useApi';
import { DataTable, Column } from '../components/ui/DataTable';
import { PriorityBadge, StatusBadge, TypeBadge, SLABadge } from '../components/ui/Badges';
import { PageHeader, Button } from '../components/ui/Forms';
import { MultiSelectDropdown, MultiSelectOption } from '../components/ui/MultiSelectDropdown';
import { formatDistanceToNow } from 'date-fns';
import { RecordFilters } from '../api/services';
import { useAuthStore } from '../store/auth.store';

// ── Static filter options ────────────────────────────────────
const STATUS_OPTIONS: MultiSelectOption[] = [
  { value: 'NEW',               label: 'New' },
  { value: 'OPEN',              label: 'Open' },
  { value: 'IN_PROGRESS',       label: 'In Progress' },
  { value: 'PENDING',           label: 'Pending' },
  { value: 'AWAITING_CUSTOMER', label: 'Awaiting Customer' },
  { value: 'WITH_SAP',          label: 'With SAP' },
  { value: 'RESOLVED',          label: 'Resolved' },
  { value: 'CLOSED',            label: 'Closed' },
  { value: 'CANCELLED',         label: 'Cancelled' },
];

const STATUS_COLORS: Record<string, string> = {
  NEW:               'bg-slate-600 border-slate-600',
  OPEN:              'bg-blue-600 border-blue-600',
  IN_PROGRESS:       'bg-indigo-600 border-indigo-600',
  PENDING:           'bg-amber-500 border-amber-500',
  AWAITING_CUSTOMER: 'bg-orange-500 border-orange-500',
  WITH_SAP:          'bg-cyan-600 border-cyan-600',
  RESOLVED:          'bg-green-600 border-green-600',
  CLOSED:            'bg-gray-500 border-gray-500',
  CANCELLED:         'bg-red-500 border-red-500',
};

const TYPE_OPTIONS: MultiSelectOption[] = [
  { value: 'INCIDENT', label: 'Incident' },
  { value: 'REQUEST',  label: 'Request' },
  { value: 'PROBLEM',  label: 'Problem' },
  { value: 'CHANGE',   label: 'Change' },
];

const PRIORITY_OPTIONS: MultiSelectOption[] = [
  { value: 'P1', label: 'P1 – Critical' },
  { value: 'P2', label: 'P2 – High' },
  { value: 'P3', label: 'P3 – Medium' },
  { value: 'P4', label: 'P4 – Low' },
];

const PRIORITY_COLORS: Record<string, string> = {
  P1: 'bg-red-600 border-red-600',
  P2: 'bg-orange-500 border-orange-500',
  P3: 'bg-yellow-500 border-yellow-500',
  P4: 'bg-green-500 border-green-500',
};

const SORT_OPTIONS = [
  { value: 'createdAt_desc', label: 'Newest First' },
  { value: 'createdAt_asc',  label: 'Oldest First' },
  { value: 'priority_asc',   label: 'Priority (High First)' },
  { value: 'updatedAt_desc', label: 'Recently Updated' },
];

// ── Component ────────────────────────────────────────────────
export default function RecordsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canSeeModuleColumn = user?.role === 'SUPER_ADMIN' || user?.role === 'PROJECT_MANAGER';

  const { data: sapModulesRaw = [] } = useSapModules();
  const moduleOptions: MultiSelectOption[] = sapModulesRaw.map((m: any) => ({
    value: m.id,
    label: `${m.code} – ${m.name}`,
  }));

  const canFilterByAgent = user?.role === 'SUPER_ADMIN' || user?.role === 'PROJECT_MANAGER';
  const { data: agentsData } = useAgents(canFilterByAgent ? { limit: 200 } : undefined);
  const agentOptions: MultiSelectOption[] = (agentsData?.data || []).map((a: any) => ({
    value: a.id,
    label: `${a.user.firstName} ${a.user.lastName}`,
  }));

  // ── State from Store ───────────────────────────────────────
  const {
    filters, setFilters,
    selStatus, setSelStatus,
    selType, setSelType,
    selPriority, setSelPriority,
    selModule, setSelModule,
    selAgent, setSelAgent,
    search, setSearch,
    showFilters, setShowFilters,
    selectedIds, setSelectedIds, toggleSelectedId,
    reset: clearFilters
  } = useRecordFilterStore();

  const { data, isLoading } = useRecords({
    ...filters,
    status:          selStatus.length   ? (selStatus as any)   : undefined,
    recordType:      selType.length     ? (selType as any)     : undefined,
    priority:        selPriority.length ? (selPriority as any) : undefined,
    sapModuleId:     selModule.length   ? (selModule as any)   : undefined,
    assignedAgentId: selAgent           || undefined,
    search:          search             || undefined,
  });

  const activeFilterCount =
    (selStatus.length   > 0 ? 1 : 0) +
    (selType.length     > 0 ? 1 : 0) +
    (selPriority.length > 0 ? 1 : 0) +
    (selModule.length   > 0 ? 1 : 0) +
    (selAgent           ? 1 : 0);

  const handleExportCSV = () => {
    const records = data?.data || [];
    if (records.length === 0) return;
    const headers = ['Record #','Type','Title','Priority','Status','Customer','Assigned Agent','Created By','SAP Module','Created','Updated'];
    const rows = records.map((r: any) => [
      r.recordNumber, r.recordType, `"${(r.title || '').replace(/"/g, '""')}"`,
      r.priority, r.status,
      r.customer?.companyName || '',
      r.assignedAgent ? `${r.assignedAgent.user?.firstName} ${r.assignedAgent.user?.lastName}` : '',
      r.createdBy ? `${r.createdBy.firstName} ${r.createdBy.lastName}` : '',
      r.sapModule ? `${r.sapModule.code} - ${r.sapModule.name}` : '',
      new Date(r.createdAt).toLocaleDateString(),
      new Date(r.updatedAt).toLocaleDateString(),
    ]);
    const csv = [headers.join(','), ...rows.map((r: any[]) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `tickets-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  // ── Columns ─────────────────────────────────────────────────
  const baseColumns: Column<any>[] = [
    {
      key: 'recordNumber',
      header: 'Record #',
      render: (row) => <span className="font-mono text-xs text-gray-500">{row.recordNumber}</span>,
      className: 'w-36',
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => <TypeBadge type={row.recordType} />,
      className: 'w-28',
    },
    {
      key: 'title',
      header: 'Title',
      render: (row) => (
        <div>
          <p className="font-medium text-gray-900 line-clamp-1">{row.title}</p>
          {row.customer && <p className="text-xs text-gray-400">{row.customer.companyName}</p>}
        </div>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      render: (row) => <PriorityBadge priority={row.priority} short />,
      className: 'w-24',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
      className: 'w-36',
    },
    {
      key: 'sla',
      header: 'SLA',
      render: (row) => row.slaTracking ? (
        <SLABadge
          breachResponse={row.slaTracking.breachResponse}
          breachResolution={row.slaTracking.breachResolution}
          resolutionDeadline={row.slaTracking.resolutionDeadline}
          compact
        />
      ) : <span className="text-xs text-gray-300">—</span>,
      className: 'w-32',
    },
  ];

  const moduleColumn: Column<any> = {
    key: 'sapModule',
    header: 'Module',
    render: (row) => row.sapModule ? (
      <span className="inline-flex items-center gap-1">
        <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5">{row.sapModule.code}</span>
        <span className="text-xs text-gray-500 hidden lg:inline">{row.sapModule.name}</span>
      </span>
    ) : <span className="text-xs text-gray-300">—</span>,
    className: 'w-36',
  };

  const tailColumns: Column<any>[] = [
    {
      key: 'assignedAgent',
      header: 'Assigned',
      render: (row) => row.assignedAgent ? (
        <span className="text-sm text-gray-700">
          {row.assignedAgent.user.firstName} {row.assignedAgent.user.lastName}
        </span>
      ) : <span className="text-xs text-gray-300">Unassigned</span>,
      className: 'w-36',
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (row) => (
        <span className="text-xs text-gray-400">
          {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })}
        </span>
      ),
      className: 'w-32',
    },
  ];

  const columns: Column<any>[] = canSeeModuleColumn
    ? [...baseColumns, moduleColumn, ...tailColumns]
    : [...baseColumns, ...tailColumns];

  // ── Sort helper ──────────────────────────────────────────────
  const sortValue = `${filters.sortBy}_${filters.sortOrder}`;

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      <PageHeader
        title="Tickets"
        subtitle={data ? `${data.pagination.total} total records` : ''}
        actions={
          <div className="flex gap-2">
            <button onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-4 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm font-medium">
              <Download className="w-4 h-4" />Export CSV
            </button>
            <Button onClick={() => navigate('/records/new')}>
              <Plus className="w-4 h-4" />
              New Ticket
            </Button>
          </div>
        }
      />

      {/* Search + Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setFilters((f) => ({ ...f, page: 1 })); }}
            placeholder="Search by title, number, description, module…"
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm border rounded-xl transition-colors ${
              showFilters || activeFilterCount > 0
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filters {activeFilterCount > 0 && (
              <span className="bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">{activeFilterCount}</span>
            )}
          </button>
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} className="px-3 py-2.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className={`grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-xl border border-gray-200 ${canSeeModuleColumn && canFilterByAgent ? 'sm:grid-cols-6' : canSeeModuleColumn || canFilterByAgent ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
          {/* Status */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center justify-between">
              Status
              {selStatus.length > 0 && <span className="text-blue-600 font-semibold">{selStatus.length}</span>}
            </label>
            <MultiSelectDropdown
              options={STATUS_OPTIONS}
              selected={selStatus}
              onChange={(v) => { setSelStatus(v); setFilters((f) => ({ ...f, page: 1 })); }}
              placeholder="All Statuses"
              colorMap={STATUS_COLORS}
            />
          </div>

          {/* Type */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center justify-between">
              Type
              {selType.length > 0 && <span className="text-blue-600 font-semibold">{selType.length}</span>}
            </label>
            <MultiSelectDropdown
              options={TYPE_OPTIONS}
              selected={selType}
              onChange={(v) => { setSelType(v); setFilters((f) => ({ ...f, page: 1 })); }}
              placeholder="All Types"
            />
          </div>

          {/* Priority */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center justify-between">
              Priority
              {selPriority.length > 0 && <span className="text-blue-600 font-semibold">{selPriority.length}</span>}
            </label>
            <MultiSelectDropdown
              options={PRIORITY_OPTIONS}
              selected={selPriority}
              onChange={(v) => { setSelPriority(v); setFilters((f) => ({ ...f, page: 1 })); }}
              placeholder="All Priorities"
              colorMap={PRIORITY_COLORS}
            />
          </div>

          {/* Module (admin/PM only) */}
          {canSeeModuleColumn && (
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center justify-between">
                Module
                {selModule.length > 0 && <span className="text-blue-600 font-semibold">{selModule.length}</span>}
              </label>
              <MultiSelectDropdown
                options={moduleOptions}
                selected={selModule}
                onChange={(v) => { setSelModule(v); setFilters((f) => ({ ...f, page: 1 })); }}
                placeholder="All Modules"
              />
            </div>
          )}

          {/* Agent (SUPER_ADMIN / PM only) */}
          {canFilterByAgent && (
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center justify-between">
                Agent
                {selAgent && <span className="text-blue-600 font-semibold">1</span>}
              </label>
              <select
                value={selAgent}
                onChange={(e) => setSelAgent(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">All Agents</option>
                {agentOptions.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
          )}

          {/* Sort */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Sort By</label>
            <select
              value={sortValue}
              onChange={(e) => {
                const [by, order] = e.target.value.split('_');
                setFilters({ sortBy: by, sortOrder: order as any, page: 1 });
              }}
              className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Data table */}
      <DataTable
        columns={columns}
        data={data?.data || []}
        loading={isLoading}
        keyExtractor={(r) => r.id}
        onRowClick={(r) => navigate(`/records/${r.id}`)}
        emptyMessage="No tickets found. Create your first ticket to get started."
        selectedIds={selectedIds}
        onSelectRow={toggleSelectedId}
        onSelectAll={setSelectedIds}
        pagination={
          data?.pagination
            ? { ...data.pagination, onPage: (p) => setFilters({ page: p }) }
            : undefined
        }
      />
    </div>
  );
}
