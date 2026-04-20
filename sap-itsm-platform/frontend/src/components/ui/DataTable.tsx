import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { LoadingSpinner } from './LoadingSpinner';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  sortable?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  keyExtractor: (row: T) => string;
  onRowClick?: (row: T) => void;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
    onPage: (p: number) => void;
  };
  emptyMessage?: string;
  // Selection props
  selectedIds?: string[];
  onSelectRow?: (id: string) => void;
  onSelectAll?: (ids: string[]) => void;
}

export function DataTable<T>({
  columns, data, loading, keyExtractor, onRowClick, pagination, emptyMessage,
  selectedIds, onSelectRow, onSelectAll
}: DataTableProps<T>) {
  if (loading) return <LoadingSpinner label="Loading data…" />;

  const allIds = data.map(keyExtractor);
  const isAllSelected = data.length > 0 && selectedIds && allIds.every(id => selectedIds.includes(id));
  const isSomeSelected = selectedIds && selectedIds.length > 0 && !isAllSelected;

  return (
    <div className="flex flex-col gap-0">
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-indigo-900 text-white">
              {(onSelectRow || onSelectAll) && (
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={el => el && (el.indeterminate = !!isSomeSelected)}
                    onChange={() => onSelectAll?.(isAllSelected ? [] : allIds)}
                    className="w-4 h-4 rounded border-white/20 bg-white/10 text-indigo-600 focus:ring-offset-indigo-900 focus:ring-white"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-left text-xs font-semibold text-white/90 uppercase tracking-wide ${col.className || ''}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {data.length === 0 ? (
              <tr>
                <td colSpan={columns.length + ((onSelectRow || onSelectAll) ? 1 : 0)} className="px-4 py-12 text-center text-sm text-gray-400">
                  {emptyMessage || 'No records found.'}
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const id = keyExtractor(row);
                const isSelected = selectedIds?.includes(id);
                return (
                  <tr
                    key={id}
                    onClick={() => onRowClick?.(row)}
                    className={`${onRowClick ? 'cursor-pointer hover:bg-blue-50/50' : ''} ${isSelected ? 'bg-blue-50/30' : ''} transition-colors`}
                  >
                    {(onSelectRow || onSelectAll) && (
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onSelectRow?.(id)}
                          className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} className={`px-4 py-3 text-gray-700 ${col.className || ''}`}>
                        {col.render ? col.render(row) : (row as any)[col.key]}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between px-2 py-3">
          <p className="text-sm text-gray-500">
            Showing {((pagination.page - 1) * pagination.limit) + 1}–
            {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
          </p>
          <div className="flex items-center gap-1">
            <PageBtn icon={<ChevronsLeft className="w-4 h-4" />} onClick={() => pagination.onPage(1)} disabled={!pagination.hasPrev} />
            <PageBtn icon={<ChevronLeft className="w-4 h-4" />} onClick={() => pagination.onPage(pagination.page - 1)} disabled={!pagination.hasPrev} />
            <span className="px-3 py-1 text-sm font-medium text-gray-700">
              {pagination.page} / {pagination.totalPages}
            </span>
            <PageBtn icon={<ChevronRight className="w-4 h-4" />} onClick={() => pagination.onPage(pagination.page + 1)} disabled={!pagination.hasNext} />
            <PageBtn icon={<ChevronsRight className="w-4 h-4" />} onClick={() => pagination.onPage(pagination.totalPages)} disabled={!pagination.hasNext} />
          </div>
        </div>
      )}
    </div>
  );
}

function PageBtn({ icon, onClick, disabled }: { icon: React.ReactNode; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {icon}
    </button>
  );
}
