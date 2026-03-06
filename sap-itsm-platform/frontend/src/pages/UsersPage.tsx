import React, { useState } from 'react';
import { Plus, Search, Pencil, Zap, Trash2, Crown, User as UserIcon, Building2 } from 'lucide-react';
import { useUsers } from '../hooks/useApi';
import { useQuery } from '@tanstack/react-query';
import { customersApi } from '../api/services';
import { PageHeader, Button, Input, Select } from '../components/ui/Forms';
import { Modal } from '../components/ui/Modal';
import { useAuthStore } from '../store/auth.store';
import { usersApi } from '../api/services';
import { useQueryClient } from '@tanstack/react-query';
import { getErrorMessage } from '../api/client';
import toast from 'react-hot-toast';

const ALL_STATUSES = ['ACTIVE','INACTIVE','PENDING','LOCKED'];

export default function UsersPage() {
  const { user: currentUser } = useAuthStore();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showModal, setModal] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<any>(null);

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isCompanyAdmin = currentUser?.role === 'COMPANY_ADMIN';
  const canCreate = isSuperAdmin || isCompanyAdmin;

  const roleOptions = isSuperAdmin ? ['COMPANY_ADMIN','USER'] : ['USER'];

  // Fetch all users (high limit to group them)
  const { data, isLoading } = useUsers({ page: 1, limit: 200, search: search || undefined });
  const users: any[] = data?.data || [];

  // Fetch customers for hierarchy
  const { data: customersData } = useQuery({
    queryKey: ['customers-hierarchy'],
    queryFn: () => customersApi.list({ limit: 100 }).then(r => r.data.data || []),
  });
  const customers: any[] = customersData || [];

  // Also fetch customers for the modal dropdown
  const { data: modalCustomers } = useQuery({
    queryKey: ['customers-list'],
    queryFn: () => customersApi.list({ limit: 100 }).then(r => r.data.data || []),
    enabled: showModal,
  });
  const customersList: any[] = modalCustomers || [];

  const defaultForm = { email:'', password:'', firstName:'', lastName:'', role: 'USER', status:'ACTIVE', customerId:'' };
  const [form, setForm] = useState(defaultForm);

  const handleOpenCreate = () => {
    setForm(defaultForm);
    setEditUser(null);
    setModal(true);
  };

  const handleEdit = (u: any) => {
    setForm({
      email: u.email, password:'', firstName: u.firstName, lastName: u.lastName,
      role: u.role, status: u.status, customerId: u.customerId || '',
    });
    setEditUser(u);
    setModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editUser) {
        await usersApi.update(editUser.id, {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          role: form.role,
          status: form.status,
          customerId: form.customerId || null,
          ...(form.password ? { password: form.password } : {}),
        });
        toast.success('User updated');
      } else {
        await usersApi.create({
          ...form,
          ...(form.customerId ? { customerId: form.customerId } : {}),
        });
        toast.success('User created');
      }
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['customers-hierarchy'] });
      setModal(false);
    } catch(e) {
      toast.error(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (u: any) => {
    try {
      await usersApi.update(u.id, { status: 'INACTIVE' });
      toast.success('User deactivated');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setConfirmDelete(null);
    } catch(e) {
      toast.error(getErrorMessage(e));
    }
  };

  // Group users by customer for hierarchy view
  const buildHierarchy = () => {
    const grouped: Record<string, { customer: any; admin: any; users: any[] }> = {};
    const unassigned: any[] = [];

    // Initialize groups from customers
    for (const c of customers) {
      grouped[c.id] = { customer: c, admin: null, users: [] };
    }

    // Place users into groups
    for (const u of users) {
      if (u.customerId && grouped[u.customerId]) {
        if (u.role === 'COMPANY_ADMIN') {
          grouped[u.customerId].admin = u;
        } else {
          grouped[u.customerId].users.push(u);
        }
      } else if (!u.customerId && u.role !== 'SUPER_ADMIN') {
        unassigned.push(u);
      }
    }

    return { grouped, unassigned };
  };

  const { grouped, unassigned } = buildHierarchy();
  const superAdmins = users.filter(u => u.role === 'SUPER_ADMIN');

  // Filter by search
  const matchesSearch = (u: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return u.firstName?.toLowerCase().includes(s) || u.lastName?.toLowerCase().includes(s) || u.email?.toLowerCase().includes(s);
  };

  const filteredGroups = Object.values(grouped).filter(g => {
    if (!search) return true;
    const s = search.toLowerCase();
    if (g.customer?.companyName?.toLowerCase().includes(s)) return true;
    if (g.admin && matchesSearch(g.admin)) return true;
    return g.users.some(matchesSearch);
  });

  const BORDER_COLORS = ['border-l-blue-500', 'border-l-emerald-500', 'border-l-violet-500', 'border-l-amber-500', 'border-l-rose-500', 'border-l-cyan-500', 'border-l-indigo-500', 'border-l-teal-500'];

  const StatusDot = ({ status }: { status: string }) => {
    const color = status === 'ACTIVE' ? 'bg-green-400' : status === 'LOCKED' ? 'bg-red-400' : 'bg-gray-300';
    return <span className={`inline-block w-2 h-2 rounded-full ${color}`} title={status}/>;
  };

  const RoleBadge = ({ role }: { role: string }) => {
    const styles: Record<string,string> = {
      SUPER_ADMIN: 'bg-red-100 text-red-700',
      COMPANY_ADMIN: 'bg-orange-100 text-orange-700',
      USER: 'bg-slate-100 text-slate-600',
      AGENT: 'bg-blue-100 text-blue-700',
      PROJECT_MANAGER: 'bg-purple-100 text-purple-700',
    };
    return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[role]||'bg-gray-100 text-gray-600'}`}>{role.replace(/_/g,' ')}</span>;
  };

  const UserRow = ({ u, indent = false }: { u: any; indent?: boolean }) => {
    return (
      <div className={`flex items-center gap-3 py-3 px-4 ${indent ? 'ml-6 border-l-2 border-gray-100' : ''} hover:bg-gray-50 transition-colors rounded-lg group`}>
        {/* Avatar */}
        <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
          u.role === 'COMPANY_ADMIN' ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'
        }`}>
          {u.role === 'COMPANY_ADMIN'
            ? <Crown className="w-4 h-4"/>
            : <UserIcon className="w-4 h-4"/>
          }
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">{u.firstName} {u.lastName}</span>
            <RoleBadge role={u.role}/>
            <StatusDot status={u.status}/>
          </div>
          <p className="text-xs text-gray-400 truncate">{u.email}</p>
        </div>

        {/* Ticket count */}
        {u._count?.createdRecords > 0 && (
          <span className="text-xs font-medium text-orange-500 whitespace-nowrap">{u._count.createdRecords} ticket{u._count.createdRecords !== 1 ? 's' : ''}</span>
        )}

        {/* Actions */}
        {canCreate && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => handleEdit(u)} className="p-1.5 text-orange-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg" title="Edit">
              <Pencil className="w-4 h-4"/>
            </button>
            <button onClick={() => handleEdit(u)} className="p-1.5 text-amber-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg" title="Reset Password">
              <Zap className="w-4 h-4"/>
            </button>
            {u.role !== 'COMPANY_ADMIN' && u.status === 'ACTIVE' && (
              <button onClick={() => setConfirmDelete(u)} className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Deactivate">
                <Trash2 className="w-4 h-4"/>
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-5 max-w-screen-xl mx-auto">
      <PageHeader title="Users" subtitle={`${users.length} total users`}
        actions={canCreate ? <Button onClick={handleOpenCreate}><Plus className="w-4 h-4"/>Add User</Button> : undefined}
      />

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
        <p className="text-sm font-semibold text-blue-700">User Hierarchy</p>
        <p className="text-xs text-blue-500 mt-0.5">Super Admin → Company Admin → Individual Users · Agents work across all companies</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search users or companies…"
          className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"/>
      </div>

      {/* Super Admins section */}
      {isSuperAdmin && superAdmins.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-700">Super Administrators</span>
          </div>
          {superAdmins.filter(matchesSearch).map(u => (
            <UserRow key={u.id} u={u}/>
          ))}
        </div>
      )}

      {/* Customer hierarchy */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading users…</div>
      ) : (
        <div className="space-y-4">
          {filteredGroups.map((group, idx) => {
            const borderColor = BORDER_COLORS[idx % BORDER_COLORS.length];
            const filteredUsers = group.users.filter(matchesSearch);
            const showAdmin = group.admin && matchesSearch(group.admin);
            if (!search || showAdmin || filteredUsers.length > 0 || group.customer?.companyName?.toLowerCase().includes(search.toLowerCase())) {
              return (
                <div key={group.customer?.id || idx} className={`bg-white rounded-xl border border-gray-200 border-l-4 ${borderColor} overflow-hidden`}>
                  {/* Company header */}
                  <div className="px-4 py-3 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-gray-400"/>
                    <span className="text-sm font-bold text-gray-800">{group.customer?.companyName || 'Unknown Company'}</span>
                    <span className="text-xs text-gray-400 ml-auto">
                      {(group.admin ? 1 : 0) + group.users.length} user{(group.admin ? 1 : 0) + group.users.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Company Admin */}
                  {group.admin && <UserRow u={group.admin}/>}

                  {/* Users */}
                  {(search ? filteredUsers : group.users).map(u => (
                    <UserRow key={u.id} u={u} indent/>
                  ))}

                  {/* Empty state */}
                  {!group.admin && group.users.length === 0 && (
                    <div className="px-4 py-4 text-xs text-gray-400 text-center">No users assigned to this company</div>
                  )}
                </div>
              );
            }
            return null;
          })}

          {/* Unassigned users */}
          {unassigned.filter(matchesSearch).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 border-l-4 border-l-gray-300 overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-gray-300"/>
                <span className="text-sm font-bold text-gray-500">Unassigned Users</span>
              </div>
              {unassigned.filter(matchesSearch).map(u => (
                <UserRow key={u.id} u={u}/>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal open={showModal} onClose={()=>setModal(false)}
        title={editUser ? 'Edit User' : 'Create New User'} size="md"
        footer={<>
          <Button variant="secondary" onClick={()=>setModal(false)}>Cancel</Button>
          <Button loading={saving} onClick={handleSave}>
            {editUser ? 'Save Changes' : 'Create User'}
          </Button>
        </>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="First Name" value={form.firstName} onChange={e=>setForm(f=>({...f,firstName:e.target.value}))} placeholder="John"/>
            <Input label="Last Name" value={form.lastName} onChange={e=>setForm(f=>({...f,lastName:e.target.value}))} placeholder="Smith"/>
          </div>
          <Input label="Email" type="email" value={form.email}
            onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="john@company.com"/>
          <Input label={editUser ? "New Password (leave blank to keep current)" : "Password"}
            type="password" value={form.password}
            onChange={e=>setForm(f=>({...f,password:e.target.value}))}
            hint={editUser ? undefined : "Min 8 chars, upper+lower+number+special"}/>
          <Select label="Role" value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}
            options={roleOptions.map(r=>({value:r, label:r.replace(/_/g,' ')}))}/>
          <Select label="Status" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}
            options={ALL_STATUSES.map(s=>({value:s, label:s}))}/>
          {(form.role === 'COMPANY_ADMIN' || form.role === 'USER') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Assign to Customer {form.role === 'COMPANY_ADMIN' && <span className="text-red-500">*</span>}
              </label>
              <select value={form.customerId} onChange={e=>setForm(f=>({...f,customerId:e.target.value}))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white">
                <option value="">— None —</option>
                {customersList.map((cu:any) => (
                  <option key={cu.id} value={cu.id}>{cu.companyName}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Modal>

      {/* Deactivate confirmation */}
      <Modal open={!!confirmDelete} onClose={()=>setConfirmDelete(null)} title="Deactivate User" size="sm"
        footer={<>
          <Button variant="secondary" onClick={()=>setConfirmDelete(null)}>Cancel</Button>
          <Button onClick={()=>handleDeactivate(confirmDelete)} className="bg-red-600 hover:bg-red-700">Deactivate</Button>
        </>}>
        <p className="text-sm text-gray-600">
          Are you sure you want to deactivate <strong>{confirmDelete?.firstName} {confirmDelete?.lastName}</strong>?
          They will no longer be able to log in.
        </p>
      </Modal>
    </div>
  );
}
