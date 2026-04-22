import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { recordsApi, dashboardApi, agentsApi, usersApi, customersApi, sapModulesApi, RecordFilters } from '../api/services';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../api/client';

// ── Dashboard ─────────────────────────────────────────────────
export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardApi.overview().then((r) => r.data.dashboard),
    refetchInterval: 30 * 1000,    // Poll every 30s
    refetchOnMount: 'always',      // Always fetch fresh when component mounts
    refetchOnWindowFocus: true,    // Fetch when tab regains focus
    staleTime: 0,                  // Never serve stale data
  });
}

export function useSLAReport(from?: string, to?: string) {
  return useQuery({
    queryKey: ['sla-report', from, to],
    queryFn: () => dashboardApi.slaReport(from, to).then((r) => r.data),
  });
}

// ── Records ───────────────────────────────────────────────────
export function useRecords(filters: RecordFilters) {
  return useQuery({
    queryKey: ['records', filters],
    queryFn: () => recordsApi.list(filters).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
}

export function useRecord(id: string) {
  return useQuery({
    queryKey: ['record', id],
    queryFn: () => recordsApi.get(id).then((r) => r.data.record),
    enabled: !!id,
    refetchInterval: (data) => {
      // If we're waiting for SAP sync, poll every 3s
      const syncStatus = (data as any)?.metadata?.sapSyncStatus;
      return (syncStatus && syncStatus !== 'SUCCESS' && syncStatus !== 'FAILED') ? 3000 : false;
    },
  });
}

export function useCreateRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: object) => recordsApi.create(data).then((r) => r.data.record),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['records'] });
      queryClient.removeQueries({ queryKey: ['dashboard'] });
      queryClient.removeQueries({ queryKey: ['dashboard-pm'] });
      queryClient.removeQueries({ queryKey: ['dashboard-customer'] });
      toast.success('Record created successfully');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}

export function useUpdateRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      recordsApi.update(id, data).then((r) => r.data.record),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['record', id] });
      queryClient.invalidateQueries({ queryKey: ['records'] });
      queryClient.removeQueries({ queryKey: ['dashboard'] });
      queryClient.removeQueries({ queryKey: ['dashboard-pm'] });
      queryClient.removeQueries({ queryKey: ['dashboard-customer'] });
      toast.success('Record updated');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}

export function useAddComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ recordId, text, internalFlag }: { recordId: string; text: string; internalFlag?: boolean }) =>
      recordsApi.addComment(recordId, text, internalFlag),
    onSuccess: (_, { recordId }) => {
      queryClient.invalidateQueries({ queryKey: ['record', recordId] });
      toast.success('Comment added');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}

export function useAddTimeEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ recordId, ...data }: { recordId: string; hours: number; description: string; workDate: string }) =>
      recordsApi.addTimeEntry(recordId, data),
    onSuccess: (_, { recordId }) => {
      queryClient.invalidateQueries({ queryKey: ['record', recordId] });
      toast.success('Time entry added');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}

export function useDeleteRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => recordsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['records'] });
      // Remove all dashboard variants from cache so next visit always fetches fresh
      queryClient.removeQueries({ queryKey: ['dashboard'] });
      queryClient.removeQueries({ queryKey: ['dashboard-pm'] });
      queryClient.removeQueries({ queryKey: ['dashboard-customer'] });
      toast.success('Ticket deleted successfully');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}

// ── Agents ────────────────────────────────────────────────────
export function useAgents(params?: object) {
  return useQuery({
    queryKey: ['agents', params],
    queryFn: () => agentsApi.list(params).then((r) => r.data),
  });
}

// ── Users ─────────────────────────────────────────────────────
export function useUsers(params?: object) {
  return useQuery({
    queryKey: ['users', params],
    queryFn: () => usersApi.list(params).then((r) => r.data),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: object) => usersApi.create(data).then((r) => r.data.user),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User created successfully');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}

// ── Customers ─────────────────────────────────────────────────
export function useCustomers(params?: object) {
  return useQuery({
    queryKey: ['customers', params],
    queryFn: () => customersApi.list(params).then((r) => r.data),
  });
}

// ── SAP Modules ───────────────────────────────────────────────
export function useSapModules() {
  return useQuery({
    queryKey: ['sap-modules'],
    queryFn: () => sapModulesApi.list().then((r) => r.data.data as Array<{ id: string; code: string; name: string }>),
    staleTime: 5 * 60 * 1000,
  });
}
