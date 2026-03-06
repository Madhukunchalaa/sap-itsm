import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, Plus, X, Download } from 'lucide-react';
import { useRecords } from '../hooks/useApi';
import { DataTable, Column } from '../components/ui/DataTable';
import { PriorityBadge, StatusBadge, TypeBadge, SLABadge } from '../components/ui/Badges';
import { PageHeader, Button } from '../components/ui/Forms';
import { formatDistanceToNow } from 'date-fns';
import { RecordFilters } from '../api/services';

const STATUS_OPTIONS = ['', 'NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'CANCELLED'];
const PRIORITY_OPTIONS = ['', 'P1', 'P2', 'P3', 'P4'];
const TYPE_OPTIONS = ['', 'INCIDENT', 'REQUEST', 'PROBLEM', 'CHANGE'];

export default function RecordsPage() {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<RecordFilters>({
    page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc',
  });

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
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `tickets-export-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading } = useRecords({
    ...filters,
    search: search || undefined,
  });

  const setFilter = (key: keyof RecordFilters, value: string | number | undefined) => {
    setFilters((f) => ({ ...f, [key]: value || undefined, page: 1 }));
  };

  const clearFilters = () => {
    setFilters({ page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' });
    setSearch('');
  };

  const activeFilterCount = [filters.recordType, filters.status, filters.priority]
    .filter(Boolean).length;

  const columns: Column<any>[] = [
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
      className: 'w-32',
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

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      <PageHeader
        title="Tickets"
        subtitle={data ? `${data.pagination.total} total records` : ''}
        actions={
          <div className="flex gap-2">
            <button onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-4 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm font-medium">
              <Download className="w-4 h-4"/>Export CSV
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
            placeholder="Search by title, number, description…"
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
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
            <label className="text-xs font-medium text-gray-500 mb-1 block">Status</label>
            <select
              value={filters.status || ''}
              onChange={(e) => setFilter('status', e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o.replace('_', ' ') || 'All Statuses'}</option>)}
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
