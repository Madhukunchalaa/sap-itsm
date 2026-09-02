import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, Plus, X, Download, SlidersHorizontal } from 'lucide-react';
import { useRecords, useSapModules, useAgents, useUsers, useCustomers } from '../hooks/useApi';
import { DataTable, Column } from '../components/ui/DataTable';
import { PriorityBadge, StatusBadge, TypeBadge, SLABadge } from '../components/ui/Badges';
import { useResolvedTicketCount } from '../hooks/useApi';
import { RestrictionModal } from '../components/records/RestrictionModal';
import { PageHeader, Button } from '../components/ui/Forms';
import { MultiSelectDropdown, MultiSelectOption } from '../components/ui/MultiSelectDropdown';
import { formatDistanceToNow, format } from 'date-fns';
import { recordsApi, plantsApi, RecordFilters } from '../api/services';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth.store';
import { useRecordFilterStore } from '../store/record-filter.store';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';

// ── Static filter options ────────────────────────────────────
const STATUS_OPTIONS: MultiSelectOption[] = [
  { value: 'NEW',               label: 'New' },
  { value: 'OPEN',              label: 'Open' },
  { value: 'IN_PROGRESS',       label: 'In Progress' },
  { value: 'PENDING',           label: 'Pending' },
  { value: 'AWAITING_CUSTOMER', label: 'Awaiting Customer' },
  { value: 'WITH_SAP',          label: 'With SAP' },
  { value: 'IN_UAT',            label: 'In UAT' },
  { value: 'HOLD',              label: 'Hold' },
  { value: 'DEVELOPMENT_COMPLETED', label: 'Development Completed' },
  { value: 'MOVED_TO_QUALITY',  label: 'Moved to Quality' },
  { value: 'MOVED_TO_PRODUCTION', label: 'Moved to Production' },
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
  IN_UAT:            'bg-teal-600 border-teal-600',
  HOLD:              'bg-pink-600 border-pink-600',
  DEVELOPMENT_COMPLETED: 'bg-violet-600 border-violet-600',
  MOVED_TO_QUALITY:  'bg-sky-600 border-sky-600',
  MOVED_TO_PRODUCTION: 'bg-lime-600 border-lime-600',
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

// ── Column visibility (per-user, persisted in localStorage) ───
const COLUMN_STORAGE_KEY = 'records-visible-columns-v1';
// Record # and Title are always shown and not toggleable.
const TOGGLEABLE_COLUMNS = [
  { key: 'type',              label: 'Type' },
  { key: 'priority',          label: 'Priority' },
  { key: 'status',            label: 'Status' },
  { key: 'sla',               label: 'SLA' },
  { key: 'plant',             label: 'Plant' },
  { key: 'customer',          label: 'Client' },
  { key: 'sapModule',         label: 'Module' },
  { key: 'targetDate',        label: 'Target Date' },
  { key: 'revisedTargetDate', label: 'Revised Target Date' },
  { key: 'assignedAgent',     label: 'Assigned' },
  { key: 'createdAt',         label: 'Created' },
];
// Shown by default; the two new date columns are opt-in.
const DEFAULT_VISIBLE_COLUMNS = TOGGLEABLE_COLUMNS
  .map(c => c.key)
  .filter(k => k !== 'targetDate' && k !== 'revisedTargetDate');

function loadVisibleColumns(): string[] {
  try {
    const saved = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_VISIBLE_COLUMNS;
}

// ── Component ────────────────────────────────────────────────
export default function RecordsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canSeeModuleColumn = user?.role === 'SUPER_ADMIN' || user?.role === 'PROJECT_MANAGER';

  const [showColumnsPanel, setShowColumnsPanel] = React.useState(false);
  const [visibleColKeys, setVisibleColKeys] = React.useState<string[]>(loadVisibleColumns);

  const toggleColumn = (key: string) => {
    setVisibleColKeys(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      try { localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

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

  const canFilterByCreator = !['USER', 'PLANT_MANAGER'].includes(user?.role || '');
  const { data: usersData } = useUsers(canFilterByCreator ? { limit: 500 } : undefined);
  const creatorOptions: MultiSelectOption[] = (usersData?.data || []).map((u: any) => ({
    value: u.id,
    label: `${u.firstName} ${u.lastName}`,
  }));

  const { data: customersData } = useCustomers({ limit: 200 });
  const customerOptions = (customersData?.data || []).map((c: any) => ({
    value: c.id,
    label: c.companyName,
  }));

  // ── State from Store ───────────────────────────────────────
  const {
    filters, setFilters,
    selStatus, setSelStatus,
    selType, setSelType,
    selPriority, setSelPriority,
    selModule, setSelModule,
    selPlant, setSelPlant,
    selCustomer, setSelCustomer,
    selAgent, setSelAgent,
    selCreator, setSelCreator,
    search, setSearch,
    showFilters, setShowFilters,
    selectedIds, setSelectedIds, toggleSelectedId,
    reset: clearFilters
  } = useRecordFilterStore();

  // Plant options narrow to the selected Client — otherwise every customer's
  // plants were shown regardless of which company was picked.
  const { data: plantsRaw = [] } = useQuery({
    queryKey: ['plants-for-filter', selCustomer],
    queryFn: () => (selCustomer ? plantsApi.byCustomer(selCustomer) : plantsApi.list(true)).then(r => r.data.data || []),
  });

  const [exportLimit, setExportLimit] = React.useState('current');
  const { data: resolvedCount } = useResolvedTicketCount(user?.id || '');
  const [restrictionModalOpen, setRestrictionModalOpen] = React.useState(false);

  const { data, isLoading } = useRecords({
    ...filters,
    status:          selStatus.length   ? (selStatus as any)   : undefined,
    recordType:      selType.length     ? (selType as any)     : undefined,
    priority:        selPriority.length ? (selPriority as any) : undefined,
    sapModuleId:     selModule.length   ? (selModule as any)   : undefined,
    plant:           selPlant           || undefined,
    customerId:      selCustomer        || undefined,
    assignedAgentId: selAgent.length    ? (selAgent as any)   : undefined,
    createdById:     selCreator         || undefined,
    search:          search             || undefined,
  });

  const activeFilterCount =
    (selStatus.length   > 0 ? 1 : 0) +
    (selType.length     > 0 ? 1 : 0) +
    (selPriority.length > 0 ? 1 : 0) +
    (selModule.length   > 0 ? 1 : 0) +
    (selPlant           ? 1 : 0) +
    (selCustomer        ? 1 : 0) +
    (selAgent.length    > 0 ? 1 : 0) +
    (selCreator         ? 1 : 0) +
    (filters.from || filters.to ? 1 : 0) +
    (filters.targetDateFrom || filters.targetDateTo ? 1 : 0);

  // ── Date range / Month-Year filter ──────────────────────────
  // Both controls just write filters.from/to (ISO datetimes) — the month
  // picker is a convenience shortcut for "the whole calendar month".
  const fromDateValue = filters.from ? format(new Date(filters.from), 'yyyy-MM-dd') : '';
  const toDateValue = filters.to ? format(new Date(filters.to), 'yyyy-MM-dd') : '';

  const monthValue = React.useMemo(() => {
    if (!filters.from || !filters.to) return '';
    const from = new Date(filters.from);
    const to = new Date(filters.to);
    const expectedFrom = new Date(from.getFullYear(), from.getMonth(), 1, 0, 0, 0, 0);
    const expectedTo = new Date(from.getFullYear(), from.getMonth() + 1, 0, 23, 59, 59, 999);
    if (from.getTime() === expectedFrom.getTime() && to.getTime() === expectedTo.getTime()) {
      return `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`;
    }
    return '';
  }, [filters.from, filters.to]);

  const handleFromChange = (value: string) => {
    setFilters({ from: value ? new Date(`${value}T00:00:00`).toISOString() : undefined, page: 1 });
  };
  const handleToChange = (value: string) => {
    setFilters({ to: value ? new Date(`${value}T23:59:59.999`).toISOString() : undefined, page: 1 });
  };
  const handleMonthChange = (value: string) => {
    if (!value) { setFilters({ from: undefined, to: undefined, page: 1 }); return; }
    const [y, m] = value.split('-').map(Number);
    const from = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const to = new Date(y, m, 0, 23, 59, 59, 999);
    setFilters({ from: from.toISOString(), to: to.toISOString(), page: 1 });
  };
  const clearDateFilters = () => setFilters({ from: undefined, to: undefined, page: 1 });

  // ── Target Date range filter ────────────────────────────────
  const targetDateFromValue = filters.targetDateFrom ? format(new Date(filters.targetDateFrom), 'yyyy-MM-dd') : '';
  const targetDateToValue = filters.targetDateTo ? format(new Date(filters.targetDateTo), 'yyyy-MM-dd') : '';
  const handleTargetDateFromChange = (value: string) => {
    setFilters({ targetDateFrom: value ? new Date(`${value}T00:00:00`).toISOString() : undefined, page: 1 });
  };
  const handleTargetDateToChange = (value: string) => {
    setFilters({ targetDateTo: value ? new Date(`${value}T23:59:59.999`).toISOString() : undefined, page: 1 });
  };
  const clearTargetDateFilters = () => setFilters({ targetDateFrom: undefined, targetDateTo: undefined, page: 1 });

  const handleExportExcel = async () => {
    let records = data?.data || [];

    if (exportLimit !== 'current') {
      const toastId = toast.loading(`Preparing export for ${exportLimit === 'all' ? 'all' : exportLimit} records...`);
      try {
        // Backend caps list limit at 5000 — clamp so "All Rows" never 400s
        const limit = Math.min(exportLimit === 'all' ? data?.pagination.total || 5000 : parseInt(exportLimit), 5000);
        const response = await recordsApi.list({
          ...filters,
          status:          selStatus.length   ? (selStatus as any)   : undefined,
          recordType:      selType.length     ? (selType as any)     : undefined,
          priority:        selPriority.length ? (selPriority as any) : undefined,
          sapModuleId:     selModule.length   ? (selModule as any)   : undefined,
          plant:           selPlant           || undefined,
          customerId:      selCustomer        || undefined,
          assignedAgentId: selAgent.length    ? (selAgent as any)   : undefined,
          createdById:     selCreator         || undefined,
          search:          search             || undefined,
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
  // Record # and Title are always shown; the rest are toggled via visibleColKeys.
  const recordNumberColumn: Column<any> = {
    key: 'recordNumber',
    header: 'Record #',
    render: (row) => <span className="font-mono text-xs text-gray-500">{row.recordNumber}</span>,
    className: 'w-36',
  };
  const titleColumn: Column<any> = {
    key: 'title',
    header: 'Title',
    render: (row) => (
      <div>
        <p className="font-medium text-gray-900 line-clamp-1">{row.title}</p>
        {row.customer && <p className="text-xs text-gray-400">{row.customer.companyName}</p>}
      </div>
    ),
  };
  const typeColumn: Column<any> = {
    key: 'type',
    header: 'Type',
    render: (row) => <TypeBadge type={row.recordType} />,
    className: 'w-28',
  };
  const priorityColumn: Column<any> = {
    key: 'priority',
    header: 'Priority',
    render: (row) => <PriorityBadge priority={row.priority} short />,
    className: 'w-24',
  };
  const statusColumn: Column<any> = {
    key: 'status',
    header: 'Status',
    render: (row) => <StatusBadge status={row.status} />,
    className: 'w-36',
  };
  const slaColumn: Column<any> = {
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
  };
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
  const plantColumn: Column<any> = {
    key: 'plant',
    header: 'Plant',
    render: (row) => row.plant ? (
      <span className="text-xs font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5">
        {row.plant}
      </span>
    ) : <span className="text-xs text-gray-300">—</span>,
    className: 'w-28',
  };
  const clientColumn: Column<any> = {
    key: 'customer',
    header: 'Client',
    render: (row) => row.customer ? (
      <span className="text-sm font-medium text-gray-700">
        {row.customer.companyName}
      </span>
    ) : <span className="text-xs text-gray-300">—</span>,
    className: 'w-44',
  };
  const targetDateColumn: Column<any> = {
    key: 'targetDate',
    header: 'Target Date',
    render: (row) => row.targetDate ? (
      <span className="text-xs text-gray-700">{format(new Date(row.targetDate), 'MMM d, yyyy')}</span>
    ) : <span className="text-xs text-gray-300">—</span>,
    className: 'w-32',
  };
  const revisedTargetDateColumn: Column<any> = {
    key: 'revisedTargetDate',
    header: 'Revised Target Date',
    render: (row) => row.revisedTargetDate ? (
      <span className="text-xs text-gray-700">{format(new Date(row.revisedTargetDate), 'MMM d, yyyy')}</span>
    ) : <span className="text-xs text-gray-300">—</span>,
    className: 'w-32',
  };
  const assignedAgentColumn: Column<any> = {
    key: 'assignedAgent',
    header: 'Assigned',
    render: (row) => row.assignedAgent ? (
      <span className="text-sm text-gray-700">
        {row.assignedAgent.user.firstName} {row.assignedAgent.user.lastName}
      </span>
    ) : <span className="text-xs text-gray-300">Unassigned</span>,
    className: 'w-36',
  };
  const createdAtColumn: Column<any> = {
    key: 'createdAt',
    header: 'Created',
    render: (row) => (
      <div className="flex flex-col">
        <span className="text-xs text-gray-400">
          {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })}
        </span>
        {row.createdBy && (
          <span className="text-xs text-gray-500 font-medium truncate mt-0.5" title={`${row.createdBy.firstName} ${row.createdBy.lastName}`}>
            by {row.createdBy.firstName} {row.createdBy.lastName}
          </span>
        )}
      </div>
    ),
    className: 'w-40',
  };

  const columnMap: Record<string, Column<any>> = {
    recordNumber: recordNumberColumn, type: typeColumn, title: titleColumn,
    priority: priorityColumn, status: statusColumn, sla: slaColumn,
    plant: plantColumn, customer: clientColumn, sapModule: moduleColumn,
    targetDate: targetDateColumn, revisedTargetDate: revisedTargetDateColumn,
    assignedAgent: assignedAgentColumn, createdAt: createdAtColumn,
  };
  const ORDERED_COLUMN_KEYS = [
    'recordNumber', 'type', 'title', 'priority', 'status', 'sla',
    'plant', 'customer', 'sapModule', 'targetDate', 'revisedTargetDate',
    'assignedAgent', 'createdAt',
  ];
  const LOCKED_COLUMNS = ['recordNumber', 'title'];

  const columns: Column<any>[] = ORDERED_COLUMN_KEYS
    .filter(key => key !== 'sapModule' || canSeeModuleColumn)
    .filter(key => LOCKED_COLUMNS.includes(key) || visibleColKeys.includes(key))
    .map(key => columnMap[key]);

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
            {user?.role !== 'PLANT_MANAGER' && (
              <Button onClick={() => {
                const isDrillmec = user?.customer?.companyName?.toLowerCase().includes('drillmec');
                if (user?.role === 'USER' && !isDrillmec && (resolvedCount || 0) >= 15) {
                  setRestrictionModalOpen(true);
                } else {
                  navigate('/records/new');
                }
              }}>
                <Plus className="w-4 h-4" />
                New Ticket
              </Button>
            )}
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

          <div className="relative">
            <button
              onClick={() => setShowColumnsPanel(!showColumnsPanel)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm border rounded-xl transition-colors ${
                showColumnsPanel
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              Columns
            </button>
            {showColumnsPanel && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowColumnsPanel(false)} />
                <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-20 p-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">Show Columns</p>
                  <div className="space-y-0.5 max-h-80 overflow-y-auto">
                    {TOGGLEABLE_COLUMNS
                      .filter(c => c.key !== 'sapModule' || canSeeModuleColumn)
                      .map(c => (
                        <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={visibleColKeys.includes(c.key)}
                            onChange={() => toggleColumn(c.key)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          {c.label}
                        </label>
                      ))}
                  </div>
                </div>
              </>
            )}
          </div>
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
              onChange={(v) => { setSelStatus(v); setFilters({ page: 1 }); }}
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
              onChange={(v) => { setSelType(v); setFilters({ page: 1 }); }}
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
              onChange={(v) => { setSelPriority(v); setFilters({ page: 1 }); }}
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
                onChange={(v) => { setSelModule(v); setFilters({ page: 1 }); }}
                placeholder="All Modules"
              />
            </div>
          )}

          {/* Agent (SUPER_ADMIN / PM only) */}
          {canFilterByAgent && (
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center justify-between">
                Agent
                {selAgent.length > 0 && <span className="text-blue-600 font-semibold">{selAgent.length}</span>}
              </label>
              <MultiSelectDropdown
                options={agentOptions}
                selected={selAgent}
                onChange={(v) => { setSelAgent(v); setFilters({ page: 1 }); }}
                placeholder="All Agents"
              />
            </div>
          )}

          {/* Created By */}
          {canFilterByCreator && (
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center justify-between">
                Created By
                {selCreator && <span className="text-blue-600 font-semibold">1</span>}
              </label>
              <select
                value={selCreator}
                onChange={(e) => { setSelCreator(e.target.value); setFilters({ page: 1 }); }}
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">All Users</option>
                {creatorOptions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          )}

          {/* Plant — hidden for Plant Manager, whose scope is fixed to one plant */}
          {user?.role !== 'PLANT_MANAGER' && (
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center justify-between">
                Plant
                {selPlant && <span className="text-blue-600 font-semibold">1</span>}
              </label>
              <select
                value={selPlant}
                onChange={(e) => { setSelPlant(e.target.value); setFilters({ page: 1 }); }}
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">All Plants</option>
                {plantsRaw.map((p: any) => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Client / Customer — hidden for Plant Manager, whose scope is fixed to one customer */}
          {user?.role !== 'PLANT_MANAGER' && (
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center justify-between">
                Client
                {selCustomer && <span className="text-blue-600 font-semibold">1</span>}
              </label>
              <select
                value={selCustomer}
                onChange={(e) => { setSelCustomer(e.target.value); setSelPlant(''); setFilters({ page: 1 }); }}
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">All Clients</option>
                {customerOptions.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
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

      {showFilters && (
        <div className="flex flex-wrap items-end gap-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Created From</label>
            <input type="date" value={fromDateValue} onChange={(e) => handleFromChange(e.target.value)}
              max={toDateValue || undefined}
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"/>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Created To</label>
            <input type="date" value={toDateValue} onChange={(e) => handleToChange(e.target.value)}
              min={fromDateValue || undefined}
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"/>
          </div>
          <div className="text-xs text-gray-400 pb-2">or</div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Month / Year</label>
            <input type="month" value={monthValue} onChange={(e) => handleMonthChange(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"/>
          </div>
          {(filters.from || filters.to) && (
            <button onClick={clearDateFilters} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-100">
              Clear dates
            </button>
          )}
          <div className="w-full border-t border-gray-200 my-1"/>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Target Date From</label>
            <input type="date" value={targetDateFromValue} onChange={(e) => handleTargetDateFromChange(e.target.value)}
              max={targetDateToValue || undefined}
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"/>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Target Date To</label>
            <input type="date" value={targetDateToValue} onChange={(e) => handleTargetDateToChange(e.target.value)}
              min={targetDateFromValue || undefined}
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"/>
          </div>
          {(filters.targetDateFrom || filters.targetDateTo) && (
            <button onClick={clearTargetDateFilters} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-100">
              Clear target dates
            </button>
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
