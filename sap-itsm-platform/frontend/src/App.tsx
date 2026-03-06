import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './store/auth.store';
import { LoadingSpinner } from './components/ui/LoadingSpinner';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

// Lazy-loaded pages
const LoginPage          = lazy(() => import('./pages/LoginPage'));
const DashboardPage      = lazy(() => import('./pages/DashboardPage'));
const RecordsPage        = lazy(() => import('./pages/RecordsPage'));
const RecordDetailPage   = lazy(() => import('./pages/RecordDetailPage'));
const NewRecordPage      = lazy(() => import('./pages/NewRecordPage'));
const UsersPage          = lazy(() => import('./pages/UsersPage'));
const AgentsPage         = lazy(() => import('./pages/AgentsPage'));
const ProfilePage        = lazy(() => import('./pages/ProfilePage'));
const SLAPolicyMasterPage = lazy(() => import('./pages/SLAPolicyMasterPage'));
const SLAReportPage      = lazy(() => import('./pages/SLAReportPage'));
const CMDBPage           = lazy(() => import('./pages/CMDBPage'));
const AuditPage          = lazy(() => import('./pages/AuditPage'));
const ShiftsPage         = lazy(() => import('./pages/ShiftsPage'));
const HolidaysPage       = lazy(() => import('./pages/HolidaysPage'));
const NotificationsPage  = lazy(() => import('./pages/NotificationsPage'));
const SAPModulesPage     = lazy(() => import('./pages/SAPModulesPage'));
const AssignmentRulesPage = lazy(() => import('./pages/AssignmentRulesPage'));
const AppLayout          = lazy(() => import('./components/layout/AppLayout'));

// Customers — list + form + detail
const CustomersPage      = lazy(() => import('./pages/CustomersPage'));
const CustomerFormPage   = lazy(() => import('./pages/CustomerFormPage'));
const CustomerDetailPage = lazy(() => import('./pages/CustomerDetailPage'));

// Contracts — list + create form + read-only detail
const ContractsListPage  = lazy(() => import('./pages/ContractsListPage'));
const ContractFormPage   = lazy(() => import('./pages/ContractFormPage'));
const ContractDetailPage     = lazy(() => import('./pages/ContractDetailPage'));
const ContractTypeMasterPage  = lazy(() => import('./pages/ContractTypeMasterPage'));
const SupportTypeMasterPage   = lazy(() => import('./pages/SupportTypeMasterPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        if (error?.response?.status === 401) return false;
        if (error?.response?.status === 403) return false;
        return failureCount < 2;
      },
      staleTime: 30 * 1000,
    },
  },
});

function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <Suspense fallback={<LoadingSpinner fullscreen />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />

              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                {/* General */}
                <Route path="/dashboard"   element={<DashboardPage />} />
                <Route path="/records"     element={<RecordsPage />} />
                <Route path="/records/new" element={<NewRecordPage />} />
                <Route path="/records/:id" element={<RecordDetailPage />} />
                <Route path="/sla-policies" element={<SLAPolicyMasterPage />} />
                <Route path="/sla-report" element={
                  <ProtectedRoute roles={['SUPER_ADMIN','COMPANY_ADMIN','PROJECT_MANAGER']}>
                    <SLAReportPage />
                  </ProtectedRoute>
                } />
                <Route path="/profile"     element={<ProfilePage />} />

                {/* Users */}
                <Route path="/users" element={
                  <ProtectedRoute roles={['SUPER_ADMIN','COMPANY_ADMIN']}>
                    <UsersPage />
                  </ProtectedRoute>
                } />

                {/* Agents */}
                <Route path="/agents" element={
                  <ProtectedRoute roles={['SUPER_ADMIN','COMPANY_ADMIN','PROJECT_MANAGER']}>
                    <AgentsPage />
                  </ProtectedRoute>
                } />

                {/* Customers — list */}
                <Route path="/customers" element={
                  <ProtectedRoute roles={['SUPER_ADMIN','COMPANY_ADMIN','PROJECT_MANAGER']}>
                    <CustomersPage />
                  </ProtectedRoute>
                } />
                {/* Customers — create (Super Admin only) */}
                <Route path="/customers/new" element={
                  <ProtectedRoute roles={['SUPER_ADMIN']}>
                    <CustomerFormPage />
                  </ProtectedRoute>
                } />
                {/* Customers — edit (Super Admin only) */}
                <Route path="/customers/:id/edit" element={
                  <ProtectedRoute roles={['SUPER_ADMIN']}>
                    <CustomerFormPage />
                  </ProtectedRoute>
                } />
                {/* Customers — detail view (Company Admin, PM) */}
                <Route path="/customers/:id" element={
                  <ProtectedRoute roles={['SUPER_ADMIN','COMPANY_ADMIN','PROJECT_MANAGER']}>
                    <CustomerDetailPage />
                  </ProtectedRoute>
                } />

                {/* Contracts — list */}
                <Route path="/contracts" element={
                  <ProtectedRoute roles={['SUPER_ADMIN','COMPANY_ADMIN','PROJECT_MANAGER']}>
                    <ContractsListPage />
                  </ProtectedRoute>
                } />
                {/* Support Type Master */}
                <Route path="/support-types" element={
                  <ProtectedRoute roles={['SUPER_ADMIN']}>
                    <SupportTypeMasterPage />
                  </ProtectedRoute>
                } />

                {/* Contract Type Master */}
                <Route path="/contract-types" element={
                  <ProtectedRoute roles={['SUPER_ADMIN']}>
                    <ContractTypeMasterPage />
                  </ProtectedRoute>
                } />

                {/* Contracts — create (Super Admin only) */}
                <Route path="/contracts/new" element={
                  <ProtectedRoute roles={['SUPER_ADMIN']}>
                    <ContractFormPage />
                  </ProtectedRoute>
                } />
                {/* Contracts — read-only detail (both Super Admin and Company Admin) */}
                <Route path="/contracts/:id" element={
                  <ProtectedRoute roles={['SUPER_ADMIN','COMPANY_ADMIN','PROJECT_MANAGER']}>
                    <ContractDetailPage />
                  </ProtectedRoute>
                } />
                <Route path="/contracts/:id/edit" element={
                  <ProtectedRoute roles={['SUPER_ADMIN']}>
                    <ContractFormPage />
                  </ProtectedRoute>
                } />

                {/* CMDB & Audit — Super Admin only */}
                <Route path="/cmdb" element={
                  <ProtectedRoute roles={['SUPER_ADMIN']}>
                    <CMDBPage />
                  </ProtectedRoute>
                } />
                <Route path="/audit" element={
                  <ProtectedRoute roles={['SUPER_ADMIN']}>
                    <AuditPage />
                  </ProtectedRoute>
                } />

                {/* Config — Super Admin only */}
                <Route path="/shifts" element={
                  <ProtectedRoute roles={['SUPER_ADMIN']}>
                    <ShiftsPage />
                  </ProtectedRoute>
                } />
                <Route path="/holidays" element={
                  <ProtectedRoute roles={['SUPER_ADMIN','COMPANY_ADMIN','PROJECT_MANAGER','AGENT']}>
                    <HolidaysPage />
                  </ProtectedRoute>
                } />
                <Route path="/notifications" element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'COMPANY_ADMIN']}>
                    <NotificationsPage />
                  </ProtectedRoute>
                } />
                <Route path="/sap-modules" element={
                  <ProtectedRoute roles={['SUPER_ADMIN']}>
                    <SAPModulesPage />
                  </ProtectedRoute>
                } />
                <Route path="/assignment-rules" element={
                  <ProtectedRoute roles={['SUPER_ADMIN', 'PROJECT_MANAGER']}>
                    <AssignmentRulesPage />
                  </ProtectedRoute>
                } />
              </Route>

              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
      <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
      {import.meta.env.DEV && <ReactQueryDevtools />}
    </QueryClientProvider>
  );
}
