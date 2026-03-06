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
}

export function DataTable<T>({
  columns, data, loading, keyExtractor, onRowClick, pagination, emptyMessage
}: DataTableProps<T>) {
  if (loading) return <LoadingSpinner label="Loading data…" />;

  return (
    <div className="flex flex-col gap-0">
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-indigo-900 text-white">
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
                <td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-gray-400">
                  {emptyMessage || 'No records found.'}
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr
                  key={keyExtractor(row)}
                  onClick={() => onRowClick?.(row)}
                  className={`${onRowClick ? 'cursor-pointer hover:bg-blue-50/50' : ''} transition-colors`}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={`px-4 py-3 text-gray-700 ${col.className || ''}`}>
                      {col.render ? col.render(row) : (row as any)[col.key]}
                    </td>
                  ))}
                </tr>
              ))
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
