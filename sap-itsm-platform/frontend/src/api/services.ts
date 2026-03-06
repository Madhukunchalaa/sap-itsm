import { apiClient } from './client';

// ── Auth API ─────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post('/auth/login', { email, password }),

  logout: (refreshToken: string) =>
    apiClient.post('/auth/logout', { refreshToken }),

  me: () => apiClient.get('/auth/me'),

  refresh: (refreshToken: string) =>
    apiClient.post('/auth/refresh', { refreshToken }),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.post('/auth/change-password', { currentPassword, newPassword }),
};

// ── Records API ───────────────────────────────────────────────
export interface RecordFilters {
  page?: number;
  limit?: number;
  recordType?: string;
  status?: string;
  priority?: string;
  assignedAgentId?: string;
  customerId?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  from?: string;
  to?: string;
}

export const recordsApi = {
  list: (filters: RecordFilters = {}) =>
    apiClient.get('/records', { params: filters }),

  get: (id: string) => apiClient.get(`/records/${id}`),

  create: (data: object) => apiClient.post('/records', data),

  update: (id: string, data: object) => apiClient.patch(`/records/${id}`, data),

  addComment: (id: string, text: string, internalFlag = false) =>
    apiClient.post(`/records/${id}/comment`, { text, internalFlag }),

  addTimeEntry: (id: string, data: { hours: number; description: string; workDate: string }) =>
    apiClient.post(`/records/${id}/time-entry`, data),

  getHistory: (id: string) => apiClient.get(`/records/${id}/history`),
};

// ── Agents API ────────────────────────────────────────────────
export const agentsApi = {
  list:     (params?: object)           => apiClient.get('/agents', { params }),
  get:      (id: string)                => apiClient.get(`/agents/${id}`),
  create:   (data: object)              => apiClient.post('/agents', data),
  update:   (id: string, data: object)  => apiClient.patch(`/agents/${id}`, data),
  delete:   (id: string)                => apiClient.delete(`/agents/${id}`),
  updateSpecializations: (id: string, data: object) => apiClient.put(`/agents/${id}/specializations`, data),
  linkUser: (data: object)              => apiClient.post('/agents/link-user', data),
};

// ── Users API ─────────────────────────────────────────────────
export const usersApi = {
  list: (params?: object) => apiClient.get('/users', { params }),
  get: (id: string) => apiClient.get(`/users/${id}`),
  create: (data: object) => apiClient.post('/users', data),
  update: (id: string, data: object) => apiClient.patch(`/users/${id}`, data),
  deactivate: (id: string) => apiClient.delete(`/users/${id}`),
};

// ── Customers API ─────────────────────────────────────────────
export const customersApi = {
  list: (params?: object) => apiClient.get('/customers', { params }),
  get: (id: string) => apiClient.get(`/customers/${id}`),
  create: (data: object) => apiClient.post('/customers', data),
  update: (id: string, data: object) => apiClient.patch(`/customers/${id}`, data),
};

// ── Contracts API ─────────────────────────────────────────────
export const supportTypesApi = {
  list:   (params?: object) => apiClient.get('/support-types', { params }),
  get:    (id: string)      => apiClient.get(`/support-types/${id}`),
  create: (data: object)    => apiClient.post('/support-types', data),
  update: (id: string, data: object) => apiClient.patch(`/support-types/${id}`, data),
  delete: (id: string)      => apiClient.delete(`/support-types/${id}`),
};

export const slaPoliciesApi = {
  list:   (params?: object) => apiClient.get('/sla-policies', { params }),
  get:    (id: string)      => apiClient.get(`/sla-policies/${id}`),
  create: (data: object)    => apiClient.post('/sla-policies', data),
  update: (id: string, data: object) => apiClient.patch(`/sla-policies/${id}`, data),
  delete: (id: string)      => apiClient.delete(`/sla-policies/${id}`),
};

export const contractTypesApi = {
  list:   (params?: object) => apiClient.get('/contract-types', { params }),
  get:    (id: string)      => apiClient.get(`/contract-types/${id}`),
  create: (data: object)    => apiClient.post('/contract-types', data),
  update: (id: string, data: object) => apiClient.patch(`/contract-types/${id}`, data),
  delete: (id: string)      => apiClient.delete(`/contract-types/${id}`),
};

export const contractsApi = {
  list: () => apiClient.get('/contracts'),
  get: (id: string) => apiClient.get(`/contracts/${id}`),
  create: (data: object) => apiClient.post('/contracts', data),
  update: (id: string, data: object) => apiClient.patch(`/contracts/${id}`, data),
  changelog: (id: string) => apiClient.get(`/contracts/${id}/changelog`),
};

// ── CMDB API ──────────────────────────────────────────────────
export const cmdbApi = {
  list: (params?: object) => apiClient.get('/cmdb', { params }),
  create: (data: object) => apiClient.post('/cmdb', data),
  update: (id: string, data: object) => apiClient.patch(`/cmdb/${id}`, data),
  delete: (id: string) => apiClient.delete(`/cmdb/${id}`),
  seed: () => apiClient.post('/cmdb/seed'),
};

// ── Reports API ───────────────────────────────────────────────
export const reportsApi = {
  timeEntries: (params?: object) => apiClient.get('/reports/time-entries', { params }),
  resolutionTimes: (params?: object) => apiClient.get('/reports/resolution-times', { params }),
};

// ── Audit API ─────────────────────────────────────────────────
export const auditApi = {
  list: (params?: object) => apiClient.get('/audit', { params }),
};



export const shiftsApi = {
  list: (params?: object) => apiClient.get('/shifts', { params }),
  create: (data: object) => apiClient.post('/shifts', data),
  update: (id: string, data: object) => apiClient.patch(`/shifts/${id}`, data),
};

export const holidaysApi = {
  list: (params?: object) => apiClient.get('/holidays', { params }),
  create: (data: object) => apiClient.post('/holidays', data),
  update: (calendarId: string, data: object) => apiClient.patch(`/holidays/${calendarId}`, data),
  createDate: (calendarId: string, data: object) => apiClient.post(`/holidays/${calendarId}/dates`, data),
  updateDate: (calendarId: string, dateId: string, data: object) => apiClient.patch(`/holidays/${calendarId}/dates/${dateId}`, data),
  deleteDate: (calendarId: string, dateId: string) => apiClient.delete(`/holidays/${calendarId}/dates/${dateId}`),
};

export const emailLogsApi = {
  list: (params?: object) => apiClient.get('/email-logs', { params }),
  get: (id: string) => apiClient.get(`/email-logs/${id}`),
};

export const notificationRulesApi = {
  metadata: () => apiClient.get('/notification-rules/metadata'),
  templates: () => apiClient.get('/notification-rules/templates'),
  createTemplate: (data: object) => apiClient.post('/notification-rules/templates', data),
  updateTemplate: (id: string, data: object) => apiClient.patch(`/notification-rules/templates/${id}`, data),
  previewTemplate: (id: string) => apiClient.post(`/notification-rules/templates/${id}/preview`),
  resetTemplate: (id: string) => apiClient.post(`/notification-rules/templates/reset/${id}`),
  list: (params?: object) => apiClient.get('/notification-rules', { params }),
  create: (data: object) => apiClient.post('/notification-rules', data),
  update: (id: string, data: object) => apiClient.patch(`/notification-rules/${id}`, data),
  delete: (id: string) => apiClient.delete(`/notification-rules/${id}`),
  seed: () => apiClient.post('/notification-rules/seed'),
  preview: (data: object) => apiClient.post('/notification-rules/preview', data),
};

export const sapModulesApi = {
  list: () => apiClient.get('/sap-modules'),
  active: () => apiClient.get('/sap-modules/active'),
  create: (data: object) => apiClient.post('/sap-modules', data),
  update: (id: string, data: object) => apiClient.patch(`/sap-modules/${id}`, data),
  delete: (id: string) => apiClient.delete(`/sap-modules/${id}`),
  createSubModule: (moduleId: string, data: object) => apiClient.post(`/sap-modules/${moduleId}/sub-modules`, data),
  updateSubModule: (id: string, data: object) => apiClient.patch(`/sap-modules/sub-modules/${id}`, data),
  deleteSubModule: (id: string) => apiClient.delete(`/sap-modules/sub-modules/${id}`),
  seed: () => apiClient.post('/sap-modules/seed'),
};

export const assignmentRulesApi = {
  list: (params?: object) => apiClient.get('/assignment-rules', { params }),
  create: (data: object) => apiClient.post('/assignment-rules', data),
  update: (id: string, data: object) => apiClient.patch(`/assignment-rules/${id}`, data),
  delete: (id: string) => apiClient.delete(`/assignment-rules/${id}`),
  recommend: (data: object) => apiClient.post('/assignment-rules/recommend', data),
};

// ── Dashboard API ─────────────────────────────────────────────
export const dashboardApi = {
  overview: () => apiClient.get('/dashboard'),
  pm: () => apiClient.get('/dashboard/pm'),
  customer: () => apiClient.get('/dashboard/customer'),
  agent: () => apiClient.get('/dashboard/agent'),
  user: () => apiClient.get('/dashboard/user'),
  slaReport: (from?: string, to?: string) =>
    apiClient.get('/dashboard/sla-report', { params: { from, to } }),
};
