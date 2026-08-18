import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { plantsApi, customersApi } from '../api/services';
import { getErrorMessage } from '../api/client';
import { PageHeader, Button } from '../components/ui/Forms';
import { Modal } from '../components/ui/Modal';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Factory, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function PlantsPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ customerId: '', name: '', code: '' });

  const { data: plantsData, isLoading } = useQuery({
    queryKey: ['plants-admin'],
    queryFn: () => plantsApi.list().then(r => r.data.data),
  });
  const { data: customersData } = useQuery({
    queryKey: ['customers-for-plants'],
    queryFn: () => customersApi.list({ limit: 500 }).then(r => r.data.data || []),
  });

  const plants: any[] = plantsData || [];
  const customers: any[] = customersData || [];

  const grouped = customers.map(c => ({
    customer: c,
    plants: plants.filter(p => p.customerId === c.id),
  }));

  const openCreate = (customerId?: string) => {
    setForm({ customerId: customerId || customers[0]?.id || '', name: '', code: '' });
    setEditRow(null);
    setShowModal(true);
  };

  const openEdit = (row: any) => {
    setForm({ customerId: row.customerId, name: row.name, code: row.code || '' });
    setEditRow(row);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.customerId) { toast.error('Customer is required'); return; }
    if (!form.name.trim()) { toast.error('Plant name is required'); return; }
    setSaving(true);
    try {
      if (editRow) {
        await plantsApi.update(editRow.id, { name: form.name, code: form.code || null });
        toast.success('Plant updated');
      } else {
        await plantsApi.create({ customerId: form.customerId, name: form.name, code: form.code || undefined });
        toast.success('Plant added');
      }
      queryClient.invalidateQueries({ queryKey: ['plants-admin'] });
      setShowModal(false);
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const handleDelete = async (row: any) => {
    if (!confirm(`Delete plant "${row.name}"?`)) return;
    try {
      await plantsApi.delete(row.id);
      toast.success('Plant deleted');
      queryClient.invalidateQueries({ queryKey: ['plants-admin'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  const handleToggleActive = async (row: any) => {
    try {
      await plantsApi.update(row.id, { isActive: !row.isActive });
      queryClient.invalidateQueries({ queryKey: ['plants-admin'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <PageHeader
        title="Plants"
        subtitle="Manage each customer's plants/sites — used by the ticket Plant field, filters, and the daily plant status digest"
        actions={<Button onClick={() => openCreate()}><Plus className="w-4 h-4"/> Add Plant</Button>}
      />

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : customers.length === 0 ? (
        <div className="text-center py-16">
          <Building2 className="w-12 h-12 mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500 font-medium">No customers configured yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map(({ customer, plants: customerPlants }) => (
            <div key={customer.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 bg-gray-50 border-b border-gray-100">
                <Building2 className="w-4 h-4 text-indigo-500"/>
                <span className="text-sm font-semibold text-gray-800">{customer.companyName}</span>
                <span className="text-xs text-gray-400">
                  {customerPlants.length} plant{customerPlants.length !== 1 ? 's' : ''}
                </span>
                <button onClick={() => openCreate(customer.id)} className="ml-auto p-1.5 text-green-500 hover:bg-green-50 rounded-lg" title="Add plant">
                  <Plus className="w-4 h-4"/>
                </button>
              </div>
              {customerPlants.length === 0 ? (
                <div className="px-5 py-4 text-sm text-gray-400">No plants yet for this customer.</div>
              ) : (
                <div>
                  {customerPlants.map((row: any) => (
                    <div key={row.id} className={`flex items-center gap-3 px-5 py-2.5 border-b border-gray-100 last:border-0 group ${!row.isActive ? 'opacity-50' : ''}`}>
                      <Factory className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"/>
                      <p className="text-sm text-gray-800 flex-1">{row.name}</p>
                      {row.code && <span className="text-xs font-mono text-gray-400">{row.code}</span>}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleToggleActive(row)} className={`p-1.5 rounded-lg ${row.isActive ? 'text-green-500 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`} title={row.isActive ? 'Active — click to disable' : 'Disabled — click to enable'}>
                          {row.isActive ? <ToggleRight className="w-4 h-4"/> : <ToggleLeft className="w-4 h-4"/>}
                        </button>
                        <button onClick={() => openEdit(row)} className="p-1.5 text-orange-400 hover:bg-orange-50 rounded-lg">
                          <Pencil className="w-4 h-4"/>
                        </button>
                        <button onClick={() => handleDelete(row)} className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg">
                          <Trash2 className="w-4 h-4"/>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={editRow ? 'Edit Plant' : 'Add Plant'}
        footer={<>
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button loading={saving} onClick={handleSave}>{editRow ? 'Save' : 'Add'}</Button>
        </>}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer *</label>
            <select value={form.customerId} disabled={!!editRow}
              onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-100">
              {customers.map((c: any) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Plant Name *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. SEPC - 3121"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
            <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
              placeholder="Optional short code"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
          </div>
        </div>
      </Modal>
    </div>
  );
}
