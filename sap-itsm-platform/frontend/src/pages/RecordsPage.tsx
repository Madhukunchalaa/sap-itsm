import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, Plus, X, Download, AlertCircle, Calendar, User, Layers, Activity, Tag, ArrowUpDown, SlidersHorizontal, Settings, ChevronDown, ChevronUp } from 'lucide-react';
import { useRecords, useSapModules, useAgents } from '../hooks/useApi';
import { DataTable, Column } from '../components/ui/DataTable';
import { PriorityBadge, StatusBadge, TypeBadge, SLABadge } from '../components/ui/Badges';
import { useResolvedTicketCount } from '../hooks/useApi';
import { RestrictionModal } from '../components/records/RestrictionModal';
import { PageHeader, Button } from '../components/ui/Forms';
import { MultiSelectDropdown, MultiSelectOption } from '../components/ui/MultiSelectDropdown';
import { formatDistanceToNow } from 'date-fns';
import { recordsApi, RecordFilters } from '../api/services';
import { useAuthStore } from '../store/auth.store';
import { useRecordFilterStore } from '../store/record-filter.store';
import toast from 'react-hot-toast';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import * as XLSX from 'xlsx';

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

const EXPORT_LIMIT_OPTIONS = [
  { value: 'current', label: 'Current Page' },
  { value: '100',     label: '1-100 Rows' },
  { value: '200',     label: '200 Rows' },
  { value: '300',     label: '300 Rows' },
  { value: '500',     label: '500 Rows' },
  { value: 'all',     label: 'All Rows' },
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
    reset: clearFilters,
    dateFilterType, setDateFilterType,
    selectedDate, setSelectedDate,
    customFromDate, setCustomFromDate,
    customToDate, setCustomToDate,
  } = useRecordFilterStore();

  // ── Sanitize Persisted State (Migration / Cleanup) ─────────
  React.useEffect(() => {
    const validPriorities = ['P1', 'P2', 'P3', 'P4'];
    const hasInvalid = selPriority.some(p => !validPriorities.includes(p));
    if (hasInvalid) {
      const sanitized = selPriority.filter(p => validPriorities.includes(p));
      setSelPriority(sanitized);
      setFilters({ page: 1 });
    }
  }, [selPriority, setSelPriority, setFilters]);

  // ── Date Boundaries Calculation ───────────────────────────
  let fromDate: string | undefined = undefined;
  let toDate: string | undefined = undefined;

  if (dateFilterType !== 'none') {
    if (dateFilterType === 'custom' && customFromDate && customToDate) {
      const [fY, fM, fD] = customFromDate.split('-').map(Number);
      const [tY, tM, tD] = customToDate.split('-').map(Number);
      const s = new Date(fY, fM - 1, fD, 0, 0, 0, 0);
      const e = new Date(tY, tM - 1, tD, 23, 59, 59, 999);
      fromDate = s.toISOString();
      toDate = e.toISOString();
    } else if (selectedDate) {
      const [year, month, day] = selectedDate.split('-').map(Number);
      const baseDate = new Date(year, month - 1, day);

      if (dateFilterType === 'day') {
        const s = new Date(year, month - 1, day, 0, 0, 0, 0);
        const e = new Date(year, month - 1, day, 23, 59, 59, 999);
        fromDate = s.toISOString();
        toDate = e.toISOString();
      } else if (dateFilterType === 'week') {
        const dayOfWeek = baseDate.getDay();
        const s = new Date(baseDate);
        s.setDate(baseDate.getDate() - dayOfWeek);
        s.setHours(0, 0, 0, 0);

        const e = new Date(s);
        e.setDate(s.getDate() + 6);
        e.setHours(23, 59, 59, 999);

        fromDate = s.toISOString();
        toDate = e.toISOString();
      } else if (dateFilterType === 'month') {
        const s = new Date(year, month - 1, 1, 0, 0, 0, 0);
        const e = new Date(year, month, 0, 23, 59, 59, 999);
        fromDate = s.toISOString();
        toDate = e.toISOString();
      }
    }
  }

  // ── Date Range Formatted Description ───────────────────────
  const dateRangeDescription = React.useMemo(() => {
    if (dateFilterType === 'none') return '';
    const formatOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

    if (dateFilterType === 'custom') {
      if (!customFromDate || !customToDate) return '';
      const [fY, fM, fD] = customFromDate.split('-').map(Number);
      const [tY, tM, tD] = customToDate.split('-').map(Number);
      const s = new Date(fY, fM - 1, fD);
      const e = new Date(tY, tM - 1, tD);
      return `${s.toLocaleDateString('en-US', formatOpts)} - ${e.toLocaleDateString('en-US', formatOpts)}`;
    }

    if (!selectedDate) return '';
    const [year, month, day] = selectedDate.split('-').map(Number);
    const baseDate = new Date(year, month - 1, day);

    if (dateFilterType === 'day') {
      return baseDate.toLocaleDateString('en-US', formatOpts);
    } else if (dateFilterType === 'week') {
      const dayOfWeek = baseDate.getDay();
      const s = new Date(baseDate);
      s.setDate(baseDate.getDate() - dayOfWeek);
      const e = new Date(s);
      e.setDate(s.getDate() + 6);
      return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${e.toLocaleDateString('en-US', formatOpts)}`;
    } else if (dateFilterType === 'month') {
      return baseDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    return '';
  }, [dateFilterType, selectedDate, customFromDate, customToDate]);

  const [exportLimit, setExportLimit] = React.useState('current');
  const { data: resolvedCount } = useResolvedTicketCount(user?.id || '');
  const [restrictionModalOpen, setRestrictionModalOpen] = React.useState(false);
  const [isDatePanelExpanded, setIsDatePanelExpanded] = React.useState(() => {
    return dateFilterType !== 'none';
  });

  const { data, isLoading, isError, refetch } = useRecords({
    ...filters,
    status:          selStatus.length   ? (selStatus as any)   : undefined,
    recordType:      selType.length     ? (selType as any)     : undefined,
    priority:        selPriority.length ? (selPriority as any) : undefined,
    sapModuleId:     selModule.length   ? (selModule as any)   : undefined,
    assignedAgentId: selAgent           || undefined,
    search:          search             || undefined,
    from:            fromDate,
    to:              toDate,
  });

  if (isLoading) return <LoadingSpinner fullscreen label="Loading tickets…" />;

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-red-600" />
        </div>
        <p className="text-gray-500 font-medium">Failed to load tickets.</p>
        <button onClick={() => refetch()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
          Retry Connection
        </button>
      </div>
    );
  }

  const activeFilterCount =
    (selStatus.length   > 0 ? 1 : 0) +
    (selType.length     > 0 ? 1 : 0) +
    (selPriority.length > 0 ? 1 : 0) +
    (selModule.length   > 0 ? 1 : 0) +
    (selAgent           ? 1 : 0) +
    (dateFilterType !== 'none' ? 1 : 0);

  const handleExportExcel = async () => {
    let records = data?.data || [];

    if (exportLimit !== 'current') {
      const toastId = toast.loading(`Preparing export for ${exportLimit === 'all' ? 'all' : exportLimit} records...`);
      try {
        const limit = exportLimit === 'all' ? data?.pagination.total || 10000 : parseInt(exportLimit);
        const response = await recordsApi.list({
          ...filters,
          status:          selStatus.length   ? (selStatus as any)   : undefined,
          recordType:      selType.length     ? (selType as any)     : undefined,
          priority:        selPriority.length ? (selPriority as any) : undefined,
          sapModuleId:     selModule.length   ? (selModule as any)   : undefined,
          assignedAgentId: selAgent           || undefined,
          search:          search             || undefined,
          from:            fromDate,
          to:              toDate,
          limit,
          page: 1,
        });
        records = response.data.data;
        toast.success('Data ready for export', { id: toastId });
      } catch (error) {
        toast.error('Failed to fetch data for export', { id: toastId });
        return;
      }
    }

    if (records.length === 0) {
      toast.error('No records to export');
      return;
    }

    // ── Prepare Data ──────────────────────────────────────────
    const rows = records.map((r: any) => ({
      'Record #':       r.recordNumber,
      'Type':           r.recordType,
      'Title':          r.title || '',
      'Priority':       r.priority,
      'Status':         r.status,
      'Customer':       r.customer?.companyName || '',
      'Assigned Agent': r.assignedAgent ? `${r.assignedAgent.user?.firstName} ${r.assignedAgent.user?.lastName}` : 'Unassigned',
      'Created By':     r.createdBy ? `${r.createdBy.firstName} ${r.createdBy.lastName}` : '',
      'SAP Module':     r.sapModule ? `${r.sapModule.code} - ${r.sapModule.name}` : '',
      'Created':        new Date(r.createdAt).toLocaleDateString(),
      'Updated':        new Date(r.updatedAt).toLocaleDateString(),
    }));

    // ── Create Worksheet ──────────────────────────────────────
    const ws = XLSX.utils.json_to_sheet(rows);

    // ── Format Columns ────────────────────────────────────────
    const colWidths = [
      { wch: 20 }, // Record #
      { wch: 12 }, // Type
      { wch: 45 }, // Title
      { wch: 12 }, // Priority
      { wch: 15 }, // Status
      { wch: 25 }, // Customer
      { wch: 20 }, // Assigned Agent
      { wch: 20 }, // Created By
      { wch: 25 }, // SAP Module
      { wch: 15 }, // Created
      { wch: 15 }, // Updated
    ];
    ws['!cols'] = colWidths;

    // ── Create Workbook & Download ────────────────────────────
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tickets');
    
    const filename = `tickets-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
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
            <div className="flex items-center border border-gray-300 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
              <select
                value={exportLimit}
                onChange={(e) => setExportLimit(e.target.value)}
                className="pl-3 pr-1 py-2.5 text-sm font-medium text-gray-600 bg-white border-none focus:outline-none cursor-pointer"
              >
                {EXPORT_LIMIT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                onClick={handleExportExcel}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-50 text-gray-600 hover:bg-gray-100 border-l border-gray-300 transition-colors text-sm font-medium"
                title="Download Excel"
              >
                <Download className="w-4 h-4" /> Export Excel
              </button>
            </div>
            <Button onClick={() => {
              if (user?.role === 'USER' && (resolvedCount || 0) >= 15) {
                setRestrictionModalOpen(true);
              } else {
                navigate('/records/new');
              }
            }}>
              <Plus className="w-4 h-4" />
              New Ticket
            </Button>
            <RestrictionModal 
              open={restrictionModalOpen} 
              onClose={() => setRestrictionModalOpen(false)} 
              count={resolvedCount || 0} 
            />
          </div>
        }
      />

      {/* Search + Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setFilters({ page: 1 }); }}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4 p-5 bg-white/70 backdrop-blur-xl rounded-2xl border border-slate-200/60 shadow-[0_8px_30px_rgb(0,0,0,0.02)] transition-all duration-300">
          {/* Status */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-slate-400" />
              <span>Status</span>
              {selStatus.length > 0 && (
                <span className="ml-auto bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded text-[10px] font-bold">{selStatus.length}</span>
              )}
            </label>
            <MultiSelectDropdown
              options={STATUS_OPTIONS}
              selected={selStatus}
              onChange={(v) => { setSelStatus(v); setFilters({ page: 1 }); }}
              placeholder="All Statuses"
              colorMap={STATUS_COLORS}
            />
          </div>

          {/* Type */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              <span>Type</span>
              {selType.length > 0 && (
                <span className="ml-auto bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded text-[10px] font-bold">{selType.length}</span>
              )}
            </label>
            <MultiSelectDropdown
              options={TYPE_OPTIONS}
              selected={selType}
              onChange={(v) => { setSelType(v); setFilters({ page: 1 }); }}
              placeholder="All Types"
            />
          </div>

          {/* Priority */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-slate-400" />
              <span>Priority</span>
              {selPriority.length > 0 && (
                <span className="ml-auto bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded text-[10px] font-bold">{selPriority.length}</span>
              )}
            </label>
            <MultiSelectDropdown
              options={PRIORITY_OPTIONS}
              selected={selPriority}
              onChange={(v) => { setSelPriority(v); setFilters({ page: 1 }); }}
              placeholder="All Priorities"
              colorMap={PRIORITY_COLORS}
            />
          </div>

          {/* Module (admin/PM only) */}
          {canSeeModuleColumn && (
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5 text-slate-400" />
                <span>SAP Module</span>
                {selModule.length > 0 && (
                  <span className="ml-auto bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded text-[10px] font-bold">{selModule.length}</span>
                )}
              </label>
              <MultiSelectDropdown
                options={moduleOptions}
                selected={selModule}
                onChange={(v) => { setSelModule(v); setFilters({ page: 1 }); }}
                placeholder="All Modules"
              />
            </div>
          )}

          {/* Agent (SUPER_ADMIN / PM only) */}
          {canFilterByAgent && (
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" />
                <span>Agent</span>
                {selAgent && (
                  <span className="ml-auto bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded text-[10px] font-bold">1</span>
                )}
              </label>
              <div className="relative">
                <select
                  value={selAgent}
                  onChange={(e) => setSelAgent(e.target.value)}
                  className="w-full text-sm border border-slate-200/80 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 text-slate-700 font-medium transition-all hover:bg-white"
                >
                  <option value="">All Agents</option>
                  {agentOptions.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Sort */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <span>Sort By</span>
            </label>
            <div className="relative">
              <select
                value={sortValue}
                onChange={(e) => {
                  const [by, order] = e.target.value.split('_');
                  setFilters({ sortBy: by, sortOrder: order as any, page: 1 });
                }}
                className="w-full text-sm border border-slate-200/80 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 text-slate-700 font-medium transition-all hover:bg-white"
              >
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Collapsible Date Filter Accordion */}
          <div className="col-span-full mt-2 pt-2 border-t border-slate-100/80">
            <button
              type="button"
              onClick={() => setIsDatePanelExpanded(!isDatePanelExpanded)}
              className="w-full flex items-center justify-between py-2 px-3 rounded-xl hover:bg-slate-50 transition-colors text-left"
            >
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Date Filter Settings</span>
                {dateFilterType !== 'none' && (
                  <span className="ml-2 bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-[10px] font-bold border border-blue-100/50">
                    Active: {dateFilterType.toUpperCase()} {dateRangeDescription ? `(${dateRangeDescription})` : ''}
                  </span>
                )}
              </span>
              {isDatePanelExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {isDatePanelExpanded && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-12 gap-4 items-end bg-slate-50/50 p-4 rounded-xl border border-slate-100 transition-all duration-300">
                <div className="md:col-span-4 lg:col-span-3">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>Range Mode</span>
                    </span>
                  </label>
                  <div className="bg-slate-100/80 p-0.5 rounded-lg flex w-full">
                    {[
                      { value: 'none', label: 'None' },
                      { value: 'day', label: 'Day' },
                      { value: 'week', label: 'Week' },
                      { value: 'month', label: 'Month' },
                      { value: 'custom', label: 'Custom' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setDateFilterType(opt.value as any);
                          setFilters({ page: 1 });
                        }}
                        className={`flex-1 py-1.5 text-[10px] font-bold rounded-md text-center transition-all ${
                          dateFilterType === opt.value
                            ? 'bg-white text-blue-600 shadow-[0_2px_4px_rgba(0,0,0,0.06)]'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="md:col-span-5 lg:col-span-5">
                  {dateFilterType === 'custom' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Start Date</span>
                        <input
                          type="date"
                          value={customFromDate}
                          onChange={(e) => {
                            setCustomFromDate(e.target.value);
                            setFilters({ page: 1 });
                          }}
                          className="w-full text-sm border border-slate-200/80 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 text-slate-700 font-medium transition-all hover:bg-white"
                        />
                      </div>
                      <div>
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">End Date</span>
                        <input
                          type="date"
                          value={customToDate}
                          onChange={(e) => {
                            setCustomToDate(e.target.value);
                            setFilters({ page: 1 });
                          }}
                          className="w-full text-sm border border-slate-200/80 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 text-slate-700 font-medium transition-all hover:bg-white"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Reference Date</span>
                      <input
                        type="date"
                        disabled={dateFilterType === 'none'}
                        value={selectedDate}
                        onChange={(e) => {
                          setSelectedDate(e.target.value);
                          if (dateFilterType === 'none') {
                            setDateFilterType('day');
                          }
                          setFilters({ page: 1 });
                        }}
                        className={`w-full text-sm border border-slate-200/80 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 text-slate-700 font-medium transition-all hover:bg-white ${
                          dateFilterType === 'none' ? 'opacity-50 cursor-not-allowed bg-slate-50/50' : ''
                        }`}
                      />
                    </div>
                  )}
                </div>

                <div className="md:col-span-3 lg:col-span-4">
                  {dateFilterType !== 'none' && dateRangeDescription ? (
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Active Range Summary</span>
                      <div className="text-sm font-semibold text-blue-600 bg-blue-50/60 border border-blue-100/80 px-4 py-2 rounded-xl flex items-center justify-between">
                        <span className="truncate">{dateRangeDescription}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 italic px-2 py-3">
                      Select a Range Mode to activate date filtering.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Active Filters Summary row */}
          {activeFilterCount > 0 && (
            <div className="col-span-1 sm:col-span-2 md:col-span-3 lg:col-span-4 xl:col-span-6 mt-2 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
                <span>Active Filters:</span>
              </span>
              
              {/* Status Tags */}
              {selStatus.map((status) => (
                <span key={status} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-slate-50 border border-slate-200 text-slate-600 rounded-full">
                  <span>Status: {status}</span>
                  <button onClick={() => { setSelStatus(selStatus.filter(s => s !== status)); setFilters({ page: 1 }); }} className="text-slate-400 hover:text-slate-600 ml-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}

              {/* Type Tags */}
              {selType.map((type) => (
                <span key={type} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-slate-50 border border-slate-200 text-slate-600 rounded-full">
                  <span>Type: {type}</span>
                  <button onClick={() => { setSelType(selType.filter(t => t !== type)); setFilters({ page: 1 }); }} className="text-slate-400 hover:text-slate-600 ml-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}

              {/* Priority Tags */}
              {selPriority.map((priority) => (
                <span key={priority} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-slate-50 border border-slate-200 text-slate-600 rounded-full">
                  <span>Priority: {priority}</span>
                  <button onClick={() => { setSelPriority(selPriority.filter(p => p !== priority)); setFilters({ page: 1 }); }} className="text-slate-400 hover:text-slate-600 ml-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}

              {/* Module Tags */}
              {selModule.map((moduleId) => {
                const mod = moduleOptions.find(o => o.value === moduleId);
                return (
                  <span key={moduleId} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-slate-50 border border-slate-200 text-slate-600 rounded-full">
                    <span>Module: {mod?.label || moduleId}</span>
                    <button onClick={() => { setSelModule(selModule.filter(m => m !== moduleId)); setFilters({ page: 1 }); }} className="text-slate-400 hover:text-slate-600 ml-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}

              {/* Agent Tag */}
              {selAgent && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-slate-50 border border-slate-200 text-slate-600 rounded-full">
                  <span>Agent: {agentOptions.find(o => o.value === selAgent)?.label || selAgent}</span>
                  <button onClick={() => { setSelAgent(''); setFilters({ page: 1 }); }} className="text-slate-400 hover:text-slate-600 ml-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Date Filter Tag */}
              {dateFilterType !== 'none' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-blue-50 border border-blue-100 text-blue-700 rounded-full shadow-sm">
                  <span>Date: {dateFilterType.toUpperCase()} ({dateRangeDescription})</span>
                  <button onClick={() => { setDateFilterType('none'); setFilters({ page: 1 }); }} className="text-blue-400 hover:text-blue-600 ml-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              <button
                onClick={clearFilters}
                className="ml-auto text-[11px] font-bold text-red-600 hover:text-red-700 transition-colors flex items-center gap-1 bg-red-50 hover:bg-red-100/80 px-2.5 py-1 rounded-full border border-red-100"
              >
                Clear All Filters
              </button>
            </div>
          )}
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
