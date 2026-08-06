import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { plantHeadEmailsApi } from '../api/services';
import { getErrorMessage } from '../api/client';
import { PageHeader, Button } from '../components/ui/Forms';
import { Modal } from '../components/ui/Modal';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Mail, Factory } from 'lucide-react';
import toast from 'react-hot-toast';

const PLANT_OPTIONS = ['SEPC - 3121', 'TAQA - 2301', '2121 - Anpara'];

export default function PlantHeadEmailsPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ plant: PLANT_OPTIONS[0], email: '', name: '' });

  const { data: rows, isLoading } = useQuery({
    queryKey: ['plant-head-emails'],
    queryFn: () => plantHeadEmailsApi.list().then(r => r.data.data),
  });

  const allRows: any[] = rows || [];
  const groupedByPlant = allRows.reduce((acc: Record<string, any[]>, row) => {
    (acc[row.plant] = acc[row.plant] || []).push(row);
    return acc;
  }, {});
  const plants = Object.keys(groupedByPlant).sort();

  const openCreate = () => {
    setForm({ plant: PLANT_OPTIONS[0], email: '', name: '' });
    setEditRow(null);
    setShowModal(true);
  };

  const openEdit = (row: any) => {
    setForm({ plant: row.plant, email: row.email, name: row.name || '' });
    setEditRow(row);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.plant.trim() || !form.email.trim()) { toast.error('Plant and Email are required'); return; }
    setSaving(true);
    try {
      if (editRow) {
        await plantHeadEmailsApi.update(editRow.id, { plant: form.plant, email: form.email, name: form.name || null });
        toast.success('Head email updated');
      } else {
        await plantHeadEmailsApi.create({ plant: form.plant, email: form.email, name: form.name || undefined });
        toast.success('Head email added');
      }
      queryClient.invalidateQueries({ queryKey: ['plant-head-emails'] });
      setShowModal(false);
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const handleDelete = async (row: any) => {
    if (!confirm(`Remove ${row.email} from ${row.plant}?`)) return;
    try {
      await plantHeadEmailsApi.delete(row.id);
      toast.success('Head email removed');
      queryClient.invalidateQueries({ queryKey: ['plant-head-emails'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  const handleToggleActive = async (row: any) => {
    try {
      await plantHeadEmailsApi.update(row.id, { isActive: !row.isActive });
      queryClient.invalidateQueries({ queryKey: ['plant-head-emails'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <PageHeader
        title="Daily Status Email Settings"
        subtitle="Configure which head emails receive the daily plant status report (Open/In Progress, Awaiting Customer, In UAT, Hold, Resolved/Closed) with an Excel attachment"
      />

      <div className="flex justify-end">
        <Button onClick={openCreate}><Plus className="w-4 h-4"/> Add Head Email</Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : plants.length === 0 ? (
        <div className="text-center py-16">
          <Mail className="w-12 h-12 mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500 font-medium">No head emails configured yet</p>
          <p className="text-sm text-gray-400 mt-1">Add a plant's head email to start receiving the daily status digest</p>
        </div>
      ) : (
        <div className="space-y-3">
          {plants.map(plant => (
            <div key={plant} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 bg-gray-50 border-b border-gray-100">
                <Factory className="w-4 h-4 text-indigo-500"/>
                <span className="text-sm font-semibold text-gray-800">{plant}</span>
                <span className="text-xs text-gray-400">
                  {groupedByPlant[plant].length} recipient{groupedByPlant[plant].length !== 1 ? 's' : ''}
                </span>
              </div>
              <div>
                {groupedByPlant[plant].map((row: any) => (
                  <div key={row.id} className={`flex items-center gap-3 px-5 py-2.5 border-b border-gray-100 last:border-0 group ${!row.isActive ? 'opacity-50' : ''}`}>
                    <Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"/>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800">{row.email}</p>
                      {row.name && <p className="text-xs text-gray-400">{row.name}</p>}
                    </div>
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
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={editRow ? 'Edit Head Email' : 'Add Head Email'}
        footer={<>
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button loading={saving} onClick={handleSave}>{editRow ? 'Save' : 'Add'}</Button>
        </>}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Plant *</label>
            <select value={form.plant} onChange={e => setForm(f => ({ ...f, plant: e.target.value }))}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
              {PLANT_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Head Email *</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="head@example.com"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Optional display name"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
          </div>
        </div>
      </Modal>
    </div>
  );
}
