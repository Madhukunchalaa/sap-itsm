import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { RecordFilters } from '../api/services';

interface RecordFilterState {
  // Base pagination / sort filters
  filters: {
    page: number;
    limit: number;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
  };
  
  // Multi-select and specialized filters
  selStatus: string[];
  selType: string[];
  selPriority: string[];
  selModule: string[];
  selAgent: string;
  
  search: string;
  showFilters: boolean;
  
  // Date filter specialized state
  dateFilterType: 'none' | 'day' | 'week' | 'month' | 'custom';
  selectedDate: string;
  customFromDate: string;
  customToDate: string;

  // Table row selection
  selectedIds: string[];

  // Actions
  setFilters: (filters: Partial<RecordFilterState['filters']>) => void;
  setSelStatus: (status: string[]) => void;
  setSelType: (type: string[]) => void;
  setSelPriority: (priority: string[]) => void;
  setSelModule: (module: string[]) => void;
  setSelAgent: (agentId: string) => void;
  setDateFilterType: (type: 'none' | 'day' | 'week' | 'month' | 'custom') => void;
  setSelectedDate: (date: string) => void;
  setCustomFromDate: (date: string) => void;
  setCustomToDate: (date: string) => void;
  setSearch: (search: string) => void;
  setShowFilters: (show: boolean) => void;
  setSelectedIds: (ids: string[]) => void;
  toggleSelectedId: (id: string) => void;
  reset: () => void;
}

const initialState = {
  filters: {
    page: 1,
    limit: 20,
    sortBy: 'createdAt',
    sortOrder: 'desc' as const,
  },
  selStatus: [],
  selType: [],
  selPriority: [],
  selModule: [],
  selAgent: '',
  search: '',
  showFilters: false,
  dateFilterType: 'none' as const,
  selectedDate: new Date().toISOString().split('T')[0],
  customFromDate: new Date().toISOString().split('T')[0],
  customToDate: new Date().toISOString().split('T')[0],
  selectedIds: [],
};

export const useRecordFilterStore = create<RecordFilterState>()(
  persist(
    (set) => ({
      ...initialState,

      setFilters: (newFilters) =>
        set((state) => ({ filters: { ...state.filters, ...newFilters } })),

      setSelStatus: (selStatus) => set({ selStatus, filters: { ...initialState.filters, page: 1 } }),
      setSelType: (selType) => set({ selType, filters: { ...initialState.filters, page: 1 } }),
      setSelPriority: (selPriority) => set({ selPriority, filters: { ...initialState.filters, page: 1 } }),
      setSelModule: (selModule) => set({ selModule, filters: { ...initialState.filters, page: 1 } }),
      setSelAgent: (selAgent) => set({ selAgent, filters: { ...initialState.filters, page: 1 } }),
      setDateFilterType: (dateFilterType) => set({ dateFilterType, filters: { ...initialState.filters, page: 1 } }),
      setSelectedDate: (selectedDate) => set({ selectedDate, filters: { ...initialState.filters, page: 1 } }),
      setCustomFromDate: (customFromDate) => set({ customFromDate, filters: { ...initialState.filters, page: 1 } }),
      setCustomToDate: (customToDate) => set({ customToDate, filters: { ...initialState.filters, page: 1 } }),

      setSearch: (search) => set({ search, filters: { ...initialState.filters, page: 1 } }),
      setShowFilters: (showFilters) => set({ showFilters }),
      
      setSelectedIds: (selectedIds) => set({ selectedIds }),
      toggleSelectedId: (id) => set((state) => ({
        selectedIds: state.selectedIds.includes(id)
          ? state.selectedIds.filter((x) => x !== id)
          : [...state.selectedIds, id],
      })),

      reset: () => set(initialState),
    }),
    {
      name: 'record-filters',
    }
  )
);
