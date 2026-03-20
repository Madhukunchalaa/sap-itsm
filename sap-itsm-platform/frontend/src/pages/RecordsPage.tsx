import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, Plus, X, Download } from 'lucide-react';
import { useRecords, useSapModules } from '../hooks/useApi';
import { DataTable, Column } from '../components/ui/DataTable';
import { PriorityBadge, StatusBadge, TypeBadge, SLABadge } from '../components/ui/Badges';
import { PageHeader, Button } from '../components/ui/Forms';
import { formatDistanceToNow } from 'date-fns';
import { RecordFilters } from '../api/services';
import { useAuthStore } from '../store/auth.store';

const ALL_STATUSES = ['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'AWAITING_CUSTOMER', 'RESOLVED', 'CLOSED', 'CANCELLED'];
const PRIORITY_OPTIONS = ['', 'P1', 'P2', 'P3', 'P4'];
const TYPE_OPTIONS = ['', 'INCIDENT', 'REQUEST', 'PROBLEM', 'CHANGE'];

const STATUS_COLORS: Record<string, string> = {
  NEW:               'bg-slate-100 text-slate-700 border-slate-300',
  OPEN:              'bg-blue-100 text-blue-700 border-blue-300',
  IN_PROGRESS:       'bg-indigo-100 text-indigo-700 border-indigo-300',
  PENDING:           'bg-amber-100 text-amber-700 border-amber-300',
  AWAITING_CUSTOMER: 'bg-orange-100 text-orange-700 border-orange-300',
  RESOLVED:          'bg-green-100 text-green-700 border-green-300',
  CLOSED:            'bg-gray-200 text-gray-600 border-gray-300',
  CANCELLED:         'bg-red-100 text-red-600 border-red-300',
};

const STATUS_ACTIVE: Record<string, string> = {
  NEW:               'bg-slate-600 text-white border-slate-600',
  OPEN:              'bg-blue-600 text-white border-blue-600',
  IN_PROGRESS:       'bg-indigo-600 text-white border-indigo-600',
  PENDING:           'bg-amber-500 text-white border-amber-500',
  AWAITING_CUSTOMER: 'bg-orange-500 text-white border-orange-500',
  RESOLVED:          'bg-green-600 text-white border-green-600',
  CLOSED:            'bg-gray-500 text-white border-gray-500',
  CANCELLED:         'bg-red-500 text-white border-red-500',
};

function statusLabel(s: string) {
  return s.replace(/_/g, ' ');
}

export default function RecordsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canSeeModuleColumn = user?.role === 'SUPER_ADMIN' || user?.role === 'PROJECT_MANAGER';

  const { data: sapModules = [] } = useSapModules();

  const [filters, setFilters] = useState<RecordFilters>({
    page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc',
  });
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading } = useRecords({
    ...filters,
    statusIn: selectedStatuses.length ? selectedStatuses : undefined,
    search: search || undefined,
  });

  const setFilter = (key: keyof RecordFilters, value: string | number | undefined) => {
    setFilters((f) => ({ ...f, [key]: value || undefined, page: 1 }));
  };

  const toggleStatus = (s: string) => {
    setSelectedStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
    setFilters((f) => ({ ...f, page: 1 }));
  };

  const clearFilters = () => {
    setFilters({ page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' });
    setSelectedStatuses([]);
    setSearch('');
  };

  const activeFilterCount =
    [filters.recordType, filters.priority, filters.sapModuleId].filter(Boolean).length +
    (selectedStatuses.length > 0 ? 1 : 0);

  const handleExportCSV = () => {
    const records = data?.data || [];
    if (records.length === 0) return;
    const headers = ['Record #', 'Type', 'Title', 'Priority', 'Status', 'Customer', 'Assigned Agent', 'Created By', 'SAP Module', 'Created', 'Updated'];
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
            Filters {activeFilterCount > 0 && <span className="bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">{activeFilterCount}</span>}
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
        <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-4">

          {/* Status multi-select pills */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-2 block">
              Status
              {selectedStatuses.length > 0 && (
                <button
                  onClick={() => setSelectedStatuses([])}
                  className="ml-2 text-blue-600 hover:text-blue-800 font-normal"
                >
                  clear
                </button>
              )}
            </label>
            <div className="flex flex-wrap gap-2">
              {ALL_STATUSES.map((s) => {
                const active = selectedStatuses.includes(s);
                return (
                  <button
                    key={s}
                    onClick={() => toggleStatus(s)}
                    className={`text-xs px-3 py-1 rounded-full border font-medium transition-all ${
                      active ? STATUS_ACTIVE[s] : STATUS_COLORS[s] + ' hover:opacity-80'
                    }`}
                  >
                    {statusLabel(s)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Other filters row */}
          <div className={`grid grid-cols-2 gap-3 ${canSeeModuleColumn ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Type</label>
              <select
                value={filters.recordType || ''}
                onChange={(e) => setFilter('recordType', e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o || 'All Types'}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Priority</label>
              <select
                value={filters.priority || ''}
                onChange={(e) => setFilter('priority', e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {PRIORITY_OPTIONS.map((o) => <option key={o} value={o}>{o || 'All Priorities'}</option>)}
              </select>
            </div>
            {canSeeModuleColumn && (
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Module</label>
                <select
                  value={filters.sapModuleId || ''}
                  onChange={(e) => setFilter('sapModuleId', e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">All Modules</option>
                  {sapModules.map((m) => (
                    <option key={m.id} value={m.id}>{m.code} – {m.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Sort By</label>
              <select
                value={`${filters.sortBy}_${filters.sortOrder}`}
                onChange={(e) => {
                  const [by, order] = e.target.value.split('_');
                  setFilters((f) => ({ ...f, sortBy: by, sortOrder: order as any, page: 1 }));
                }}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="createdAt_desc">Newest First</option>
                <option value="createdAt_asc">Oldest First</option>
                <option value="priority_asc">Priority (High First)</option>
                <option value="updatedAt_desc">Recently Updated</option>
              </select>
            </div>
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
        pagination={
          data?.pagination
            ? { ...data.pagination, onPage: (p) => setFilters((f) => ({ ...f, page: p })) }
            : undefined
        }
      />
    </div>
  );
}
