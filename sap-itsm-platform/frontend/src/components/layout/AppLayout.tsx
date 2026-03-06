import React, { useState, useRef, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard, Ticket, Users, UserCog, Building2, FileText, Tag,
  Server, Shield, ShieldCheck, LogOut, Bell, ChevronDown, AlertTriangle,
  Plus, User, Clock, Calendar, Mail, ChevronRight, Settings,
  Target, Layers, Zap, Check
} from 'lucide-react';
import { useAuthStore } from '../../store/auth.store';
import { authApi } from '../../api/services';
import { apiClient } from '../../api/client';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';

/* ── nav structure ─────────────────────────────────────────────
   Top-level items that appear directly in the navbar.
   Items with `children` render as a dropdown group.
──────────────────────────────────────────────────────────────── */
const NAV_STRUCTURE = [
  {
    label: 'Dashboard',
    to: '/dashboard',
    icon: LayoutDashboard,
    roles: [],
  },
  {
    label: 'All Records',
    to: '/records',
    icon: Ticket,
    roles: [],
  },
  // Customers dropdown
  {
    label: 'Customers',
    icon: Building2,
    roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_MANAGER'],
    children: [
      { to: '/customers',  icon: Building2, label: 'Customers',  roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_MANAGER'] },
      { to: '/users',      icon: Users,     label: 'Users',      roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'] },
      { to: '/contracts',  icon: FileText,  label: 'Contracts',  roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_MANAGER'] },
    ],
  },
  {
    label: 'Agents',
    to: '/agents',
    icon: UserCog,
    roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_MANAGER'],
  },
  {
    label: 'Assignment Rules',
    to: '/assignment-rules',
    icon: Zap,
    roles: ['SUPER_ADMIN', 'PROJECT_MANAGER'],
  },
  // Coverage dropdown — SUPER_ADMIN only
  {
    label: 'Coverage',
    icon: Shield,
    roles: ['SUPER_ADMIN'],
    children: [
      { to: '/shifts',        icon: Clock,          label: 'Shifts',        roles: ['SUPER_ADMIN'] },
      { to: '/support-types', icon: Shield,         label: 'Support Types', roles: ['SUPER_ADMIN'] },
      { to: '/sla-policies',  icon: Target,         label: 'SLA Policies',  roles: ['SUPER_ADMIN'] },
      { to: '/holidays',      icon: Calendar,       label: 'Holidays',      roles: ['SUPER_ADMIN'] },
    ],
  },
  // Holidays standalone for non-SUPER_ADMIN (view only)
  {
    label: 'Holidays',
    to: '/holidays',
    icon: Calendar,
    roles: ['COMPANY_ADMIN', 'PROJECT_MANAGER', 'AGENT'],
  },
  // Reporting dropdown
  {
    label: 'Reporting',
    icon: AlertTriangle,
    roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_MANAGER'],
    children: [
      { to: '/sla-report', icon: AlertTriangle, label: 'SLA Reports', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_MANAGER'] },
    ],
  },
  {
    label: 'Notifications',
    to: '/notifications',
    icon: Bell,
    roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'],
  },
  // Admin dropdown — SUPER_ADMIN only
  {
    label: 'Admin',
    icon: Settings,
    roles: ['SUPER_ADMIN'],
    children: [
      { to: '/cmdb',         icon: Server,        label: 'CMDB',         roles: ['SUPER_ADMIN'] },
      { to: '/sap-modules',  icon: Layers,        label: 'SAP Modules',  roles: ['SUPER_ADMIN'] },
      { to: '/audit', icon: ShieldCheck,   label: 'Audit Log', roles: ['SUPER_ADMIN'] },
    ],
  },
];

/* ── Dropdown ──────────────────────────────────────────────── */
function NavDropdown({
  item, userRole, activeDropdown, setActiveDropdown,
}: {
  item: typeof NAV_STRUCTURE[number];
  userRole: string;
  activeDropdown: string | null;
  setActiveDropdown: (v: string | null) => void;
}) {
  const location = useLocation();
  const isOpen = activeDropdown === item.label;
  const children = item.children || [];

  const isChildActive = children.some(c => location.pathname.startsWith(c.to || ''));

  return (
    <div className="relative">
      <button
        onClick={() => setActiveDropdown(isOpen ? null : item.label)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 whitespace-nowrap ${
          isChildActive || isOpen
            ? 'text-indigo-700 bg-indigo-50'
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
        }`}
      >
        <item.icon className="w-4 h-4" />
        <span>{item.label}</span>
        <ChevronDown className={`w-3.5 h-3.5 ml-0.5 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setActiveDropdown(null)} />
          <div className="absolute left-0 top-full mt-1.5 z-[9999] min-w-[200px] bg-white rounded-xl shadow-2xl border border-gray-100 py-1.5">
            {children.map(child => (
              <NavLink
                key={child.to}
                to={child.to || '/'}
                onClick={() => setActiveDropdown(null)}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700 font-semibold'
                      : 'text-gray-700 hover:bg-gray-50 font-medium'
                  }`
                }
              >
                <child.icon className="w-4 h-4 flex-shrink-0 opacity-70" />
                {child.label}
              </NavLink>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── AppLayout ─────────────────────────────────────────────── */
export default function AppLayout() {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const { user, refreshToken, logout } = useAuthStore();
  const navigate = useNavigate();

  const role = user?.role || '';

  const visibleNav = NAV_STRUCTURE.filter(item => {
    if (item.roles.length === 0) return true;
    return item.roles.includes(role);
  }).map(item => {
    if (item.children) {
      const filteredChildren = item.children.filter(
        c => c.roles.length === 0 || c.roles.includes(role)
      );
      return { ...item, children: filteredChildren };
    }
    return item;
  }).filter(item => !item.children || item.children.length > 0);

  const handleLogout = async () => {
    try { if (refreshToken) await authApi.logout(refreshToken); } catch {}
    logout();
    navigate('/login');
    toast.success('Logged out');
  };

  const initials = user
    ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase()
    : '??';

  const roleLabel: Record<string, string> = {
    SUPER_ADMIN:     'Super Administrator',
    COMPANY_ADMIN:   'Company Administrator',
    AGENT:           'Support Agent',
    PROJECT_MANAGER: 'Project Manager',
    USER:            'End User',
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50" style={{ fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif" }}>
      {/* Google Fonts — DM Sans */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap');`}</style>

      {/* ── Top Header ─────────────────────────────────────── */}
      <header
        className="flex-shrink-0 h-[70px] flex items-center justify-between px-6 gap-4"
        style={{ background: 'linear-gradient(135deg, #4338ca 0%, #6d28d9 50%, #7c3aed 100%)' }}
      >
        {/* Logo */}
        <NavLink to="/dashboard" className="flex items-center gap-3 flex-shrink-0 group">
          <div className="w-9 h-9 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center ring-2 ring-white/30 group-hover:bg-white/30 transition-colors">
            <Target className="w-5 h-5 text-white" />
          </div>
          <div className="leading-tight">
            <p className="text-white font-bold text-base tracking-tight leading-none">Service Desk Pro</p>
            <p className="text-white/60 text-[11px] font-medium mt-0.5">{user?.tenant?.name || 'ITSM Platform'}</p>
          </div>
        </NavLink>

        {/* Right: New Ticket + Bell + User */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          <button
            onClick={() => navigate('/records/new')}
            className="flex items-center gap-1.5 bg-white text-indigo-700 font-semibold text-sm px-4 py-2 rounded-xl hover:bg-indigo-50 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" /> New Ticket
          </button>

          <NotificationBell />

          {/* User dropdown */}
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-xl hover:bg-white/10 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-xs font-bold ring-2 ring-white/30 flex-shrink-0">
                {initials}
              </div>
              <div className="text-left leading-tight hidden sm:block">
                <p className="text-white text-sm font-semibold leading-none">{user?.firstName} {user?.lastName}</p>
                <p className="text-white/60 text-[11px] font-medium mt-0.5">{roleLabel[role] || role}</p>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-white/60 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-2 z-50 w-52 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-gray-100">
                    <p className="text-sm font-semibold text-gray-900">{user?.firstName} {user?.lastName}</p>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{user?.email}</p>
                  </div>
                  <button
                    onClick={() => { navigate('/profile'); setUserMenuOpen(false); }}
                    className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 font-medium"
                  >
                    <User className="w-4 h-4 text-gray-400" /> My Profile
                  </button>
                  <div className="my-1 border-t border-gray-100" />
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 font-medium"
                  >
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Nav Bar ────────────────────────────────────────── */}
      <nav
        className="flex-shrink-0 h-[46px] flex items-center px-4 gap-0.5 border-b border-gray-200 bg-white relative"
        
      >
        {visibleNav.map(item => {
          if (item.children) {
            return (
              <NavDropdown
                key={item.label}
                item={item}
                userRole={role}
                activeDropdown={activeDropdown}
                setActiveDropdown={setActiveDropdown}
              />
            );
          }
          return (
            <NavLink
              key={item.to}
              to={item.to!}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 whitespace-nowrap ${
                  isActive
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-indigo-600' : 'text-gray-400'}`} />
                  {item.label}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* ── Page Content ───────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto bg-gray-50">
        <Outlet />
      </main>
    </div>
  );
}

function NotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: countData } = useQuery({
    queryKey: ['notification-count'],
    queryFn: () => apiClient.get('/notifications/inbox/count').then(r => r.data.unreadCount || 0),
    refetchInterval: 30000,
  });

  const { data: notifData } = useQuery({
    queryKey: ['notifications-inbox'],
    queryFn: () => apiClient.get('/notifications/inbox', { params: { limit: 10 } }).then(r => r.data),
    enabled: open,
  });

  const unread = countData || 0;
  const notifications = notifData?.notifications || [];

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markRead = async (id: string) => {
    await apiClient.patch(`/notifications/inbox/${id}/read`);
    queryClient.invalidateQueries({ queryKey: ['notification-count'] });
    queryClient.invalidateQueries({ queryKey: ['notifications-inbox'] });
  };

  const markAllRead = async () => {
    await apiClient.post('/notifications/inbox/read-all');
    queryClient.invalidateQueries({ queryKey: ['notification-count'] });
    queryClient.invalidateQueries({ queryKey: ['notifications-inbox'] });
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="relative w-9 h-9 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition-colors">
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full ring-2 ring-indigo-700 px-1">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-96 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-800">Notifications</h3>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
                <Check className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No notifications yet</p>
              </div>
            ) : notifications.map((n: any) => (
              <div key={n.id}
                onClick={() => { if (!n.isRead) markRead(n.id); if (n.recordId) { navigate(`/records/${n.recordId}`); setOpen(false); } }}
                className={`px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${!n.isRead ? 'bg-blue-50/50' : ''}`}>
                <div className="flex items-start gap-2">
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${!n.isRead ? 'bg-blue-500' : 'bg-transparent'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{n.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {n.record && <span className="text-[10px] font-mono text-blue-600">{n.record.recordNumber}</span>}
                      <span className="text-[10px] text-gray-400">{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-gray-100 text-center">
              <button onClick={() => { navigate('/notifications'); setOpen(false); }} className="text-xs text-blue-600 hover:text-blue-800">View all notifications</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
