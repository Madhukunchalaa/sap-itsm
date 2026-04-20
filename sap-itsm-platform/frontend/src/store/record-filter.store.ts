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
  
  // Table row selection
  selectedIds: string[];

  // Actions
  setFilters: (filters: Partial<RecordFilterState['filters']>) => void;
  setSelStatus: (status: string[]) => void;
  setSelType: (type: string[]) => void;
  setSelPriority: (priority: string[]) => void;
  setSelModule: (module: string[]) => void;
  setSelAgent: (agentId: string) => void;
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
