import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cmdbApi, customersApi } from '../api/services';
import { getErrorMessage } from '../api/client';
import { PageHeader, Button } from '../components/ui/Forms';
import { Modal } from '../components/ui/Modal';
import { Plus, Pencil, Trash2, Server, Zap, Search } from 'lucide-react';
import toast from 'react-hot-toast';

const CI_TYPES = ['SYSTEM','CLIENT','SERVER','INTERFACE','BTP_INSTANCE','DATABASE','NETWORK','APPLICATION'];
const CI_STATUSES = ['ACTIVE','INACTIVE','MAINTENANCE','DECOMMISSIONED'];
const ENV_OPTIONS = ['DEV','QAS','PRD','SBX','DR','TRAIN'];

const TYPE_COLORS: Record<string,string> = {
  SYSTEM: 'bg-blue-100 text-blue-700', CLIENT: 'bg-purple-100 text-purple-700',
  SERVER: 'bg-green-100 text-green-700', INTERFACE: 'bg-orange-100 text-orange-700',
  BTP_INSTANCE: 'bg-cyan-100 text-cyan-700', DATABASE: 'bg-red-100 text-red-700',
  NETWORK: 'bg-yellow-100 text-yellow-700', APPLICATION: 'bg-indigo-100 text-indigo-700',
};
const STATUS_COLORS: Record<string,string> = {
  ACTIVE: 'bg-green-100 text-green-700', INACTIVE: 'bg-gray-100 text-gray-500',
  MAINTENANCE: 'bg-amber-100 text-amber-700', DECOMMISSIONED: 'bg-red-100 text-red-700',
};
const ENV_COLORS: Record<string,string> = {
  DEV: 'bg-blue-50 text-blue-600', QAS: 'bg-amber-50 text-amber-600',
  PRD: 'bg-red-50 text-red-600', SBX: 'bg-gray-50 text-gray-500',
  DR: 'bg-purple-50 text-purple-600', TRAIN: 'bg-green-50 text-green-600',
};

const blankForm = { ciType: 'SYSTEM', name: '', environment: '', sid: '', hostname: '', version: '', status: 'ACTIVE', customerId: '' };

export default function CMDBPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterEnv, setFilterEnv] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editCI, setEditCI] = useState<any>(null);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const { data: ciData, isLoading } = useQuery({
    queryKey: ['cmdb'],
    queryFn: () => cmdbApi.list().then(r => r.data.data || r.data),
  });
  const { data: customersData } = useQuery({
    queryKey: ['customers-cmdb'],
    queryFn: () => customersApi.list({ limit: 100 }).then(r => r.data.data || []),
  });
  const customers: any[] = customersData || [];
  const allCIs: any[] = Array.isArray(ciData) ? ciData : [];

  const filtered = allCIs.filter(ci => {
    if (filterType && ci.ciType !== filterType) return false;
    if (filterEnv && ci.environment !== filterEnv) return false;
    if (search) {
      const q = search.toLowerCase();
      return ci.name.toLowerCase().includes(q) || (ci.sid||'').toLowerCase().includes(q) || (ci.hostname||'').toLowerCase().includes(q);
    }
    return true;
  });

  const openCreate = () => { setForm({...blankForm}); setEditCI(null); setShowModal(true); };
  const openEdit = (ci: any) => {
    setForm({ ciType: ci.ciType, name: ci.name, environment: ci.environment || '', sid: ci.sid || '', hostname: ci.hostname || '', version: ci.version || '', status: ci.status, customerId: ci.customerId || '' });
    setEditCI(ci);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      if (editCI) {
        await cmdbApi.update(editCI.id, form);
        toast.success('CI updated');
      } else {
        await cmdbApi.create(form);
        toast.success('CI created');
      }
      queryClient.invalidateQueries({ queryKey: ['cmdb'] });
      setShowModal(false);
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this configuration item?')) return;
    try {
      await cmdbApi.delete(id);
      toast.success('CI deleted');
      queryClient.invalidateQueries({ queryKey: ['cmdb'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await cmdbApi.seed();
      toast.success(res.data.message || 'CMDB seeded');
      queryClient.invalidateQueries({ queryKey: ['cmdb'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSeeding(false); }
  };

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const ic = 'w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none';

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <PageHeader title="CMDB" subtitle={`${allCIs.length} configuration items`} />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, SID, hostname…"
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
          <option value="">All Types</option>
          {CI_TYPES.map(t => <option key={t} value={t}>{t.replace('_',' ')}</option>)}
        </select>
        <select value={filterEnv} onChange={e => setFilterEnv(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
          <option value="">All Environments</option>
          {ENV_OPTIONS.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={handleSeed} loading={seeding}><Zap className="w-4 h-4"/> Seed SAP Environments</Button>
          <Button onClick={openCreate}><Plus className="w-4 h-4"/> Add CI</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Server className="w-12 h-12 mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500 font-medium">{allCIs.length === 0 ? 'No configuration items' : 'No items match filters'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Type','Name','Customer','Env','SID','Hostname','Version','Status',''].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-xs text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(ci => (
                <tr key={ci.id} className="hover:bg-gray-50 group">
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[ci.ciType] || 'bg-gray-100'}`}>{ci.ciType.replace('_',' ')}</span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{ci.name}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{ci.customer?.companyName || <span className="text-gray-300">Global</span>}</td>
                  <td className="px-4 py-3">
                    {ci.environment && <span className={`text-xs font-bold px-2 py-0.5 rounded ${ENV_COLORS[ci.environment] || 'bg-gray-50'}`}>{ci.environment}</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{ci.sid || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{ci.hostname || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{ci.version || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[ci.status] || 'bg-gray-100'}`}>{ci.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                      <button onClick={() => openEdit(ci)} className="p-1.5 text-orange-400 hover:bg-orange-50 rounded-lg"><Pencil className="w-4 h-4"/></button>
                      <button onClick={() => handleDelete(ci.id)} className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4"/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={editCI ? 'Edit Configuration Item' : 'Create Configuration Item'}
        footer={<>
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button loading={saving} onClick={handleSave}>{editCI ? 'Save' : 'Create'}</Button>
        </>}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
            <select value={form.customerId} onChange={e => setF('customerId', e.target.value)} className={ic}>
              <option value="">— Global (no customer) —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CI Type *</label>
              <select value={form.ciType} onChange={e => setF('ciType', e.target.value)} className={ic}>
                {CI_TYPES.map(t => <option key={t} value={t}>{t.replace('_',' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select value={form.status} onChange={e => setF('status', e.target.value)} className={ic}>
                {CI_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input value={form.name} onChange={e => setF('name', e.target.value)} className={ic} placeholder="SAP ECC Production"/>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Environment</label>
              <select value={form.environment} onChange={e => setF('environment', e.target.value)} className={ic}>
                <option value="">—</option>
                {ENV_OPTIONS.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SID</label>
              <input value={form.sid} onChange={e => setF('sid', e.target.value.toUpperCase())} className={ic} placeholder="EP1" maxLength={10}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
              <input value={form.version} onChange={e => setF('version', e.target.value)} className={ic} placeholder="EHP8"/>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Hostname</label>
            <input value={form.hostname} onChange={e => setF('hostname', e.target.value)} className={ic} placeholder="sapecc-prd.company.local"/>
          </div>
        </div>
      </Modal>
    </div>
  );
}
