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
    from?: string;
    to?: string;
    targetDateFrom?: string;
    targetDateTo?: string;
  };
  
  // Multi-select and specialized filters
  selStatus: string[];
  selType: string[];
  selPriority: string[];
  selModule: string[];
  selPlant: string;
  selCustomer: string;
  selAgent: string[];
  selCreator: string;
  
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
  setSelPlant: (plant: string) => void;
  setSelCustomer: (customerId: string) => void;
  setSelAgent: (agentIds: string[]) => void;
  setSelCreator: (creatorId: string) => void;
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
  selPlant: '',
  selCustomer: '',
  selAgent: [],
  selCreator: '',
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
      setSelPlant: (selPlant) => set({ selPlant, filters: { ...initialState.filters, page: 1 } }),
      setSelCustomer: (selCustomer) => set({ selCustomer, filters: { ...initialState.filters, page: 1 } }),
      setSelAgent: (selAgent) => set({ selAgent, filters: { ...initialState.filters, page: 1 } }),
      setSelCreator: (selCreator) => set({ selCreator, filters: { ...initialState.filters, page: 1 } }),

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
      version: 1,
      // v0 stored selAgent as a single string; v1 uses an array (multi-select).
      migrate: (persisted: any) => {
        if (persisted && typeof persisted.selAgent === 'string') {
          persisted.selAgent = persisted.selAgent ? [persisted.selAgent] : [];
        }
        return persisted;
      },
    }
  )
);
