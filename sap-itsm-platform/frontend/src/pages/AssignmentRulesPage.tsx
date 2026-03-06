import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assignmentRulesApi, customersApi, sapModulesApi } from '../api/services';
import { getErrorMessage } from '../api/client';
import { PageHeader, Button } from '../components/ui/Forms';
import { Modal } from '../components/ui/Modal';
import { Plus, Pencil, Trash2, Zap, Users, ToggleRight, ToggleLeft } from 'lucide-react';
import toast from 'react-hot-toast';

const MODE_COLORS: Record<string,string> = {
  AUTO_ASSIGN: 'bg-green-100 text-green-700', RECOMMEND: 'bg-blue-100 text-blue-700', ROUND_ROBIN: 'bg-purple-100 text-purple-700',
};
const MODE_LABELS: Record<string,string> = { AUTO_ASSIGN: 'Auto-Assign', RECOMMEND: 'Recommend', ROUND_ROBIN: 'Round Robin' };
const RECORD_TYPES = [{ value: '', label: 'All Types' }, { value: 'INCIDENT', label: 'Incident' }, { value: 'REQUEST', label: 'Request' }, { value: 'PROBLEM', label: 'Problem' }, { value: 'CHANGE', label: 'Change' }];
const PRIORITIES = [{ value: '', label: 'Any Priority' }, { value: 'P1', label: 'P1 — Critical' }, { value: 'P2', label: 'P2 — High' }, { value: 'P3', label: 'P3 — Medium' }, { value: 'P4', label: 'P4 — Low' }];
const LEVELS = [{ value: '', label: 'Auto (by priority)' }, { value: 'L1', label: 'L1 — First Line' }, { value: 'L2', label: 'L2 — Advanced' }, { value: 'L3', label: 'L3 — Expert' }, { value: 'L4', label: 'L4 — Specialist' }];

const blank = { customerId: '', name: '', recordType: '', priority: '', sapModuleId: '', assignmentMode: 'RECOMMEND', preferredLevel: '', sortOrder: 0 };

export default function AssignmentRulesPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editRule, setEditRule] = useState<any>(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [filterCustomer, setFilterCustomer] = useState('');

  const { data: rulesData, isLoading } = useQuery({
    queryKey: ['assignment-rules', filterCustomer],
    queryFn: () => assignmentRulesApi.list(filterCustomer ? { customerId: filterCustomer } : {}).then(r => r.data.rules || []),
  });
  const { data: customersData } = useQuery({
    queryKey: ['customers-assignment'],
    queryFn: () => customersApi.list({ limit: 100 }).then(r => r.data.data || []),
  });
  const { data: modulesData } = useQuery({
    queryKey: ['sap-modules-active'],
    queryFn: () => sapModulesApi.active().then(r => r.data.data || []),
  });

  const rules: any[] = rulesData || [];
  const customers: any[] = customersData || [];
  const modules: any[] = modulesData || [];
  const ic = 'w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white';

  const openCreate = () => { setForm({...blank}); setEditRule(null); setShowModal(true); };
  const openEdit = (r: any) => {
    setForm({
      customerId: r.customerId || '', name: r.name, recordType: r.recordType || '',
      priority: r.priority || '', sapModuleId: r.sapModuleId || '',
      assignmentMode: r.assignmentMode, preferredLevel: r.preferredLevel || '',
      sortOrder: r.sortOrder || 0,
    });
    setEditRule(r);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.customerId || !form.name || !form.assignmentMode) {
      toast.error('Customer, name, and assignment mode are required');
      return;
    }
    setSaving(true);
    try {
      if (editRule) {
        await assignmentRulesApi.update(editRule.id, form);
        toast.success('Rule updated');
      } else {
        await assignmentRulesApi.create(form);
        toast.success('Rule created');
      }
      queryClient.invalidateQueries({ queryKey: ['assignment-rules'] });
      setShowModal(false);
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this assignment rule?')) return;
    try {
      await assignmentRulesApi.delete(id);
      toast.success('Rule deleted');
      queryClient.invalidateQueries({ queryKey: ['assignment-rules'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  const handleToggle = async (rule: any) => {
    try {
      await assignmentRulesApi.update(rule.id, { isActive: !rule.isActive });
      queryClient.invalidateQueries({ queryKey: ['assignment-rules'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  // Group by customer
  const grouped: Record<string, any[]> = {};
  rules.forEach(r => {
    const key = r.customer?.companyName || 'Unknown';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  });

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <PageHeader title="Smart Agent Assignment" subtitle="Configure automatic agent assignment rules per customer" />

      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
        <p className="text-sm font-semibold text-blue-700 mb-1">Smart Agent Assignment Engine</p>
        <p className="text-xs text-blue-600">Agents are scored on a 100-point scale based on 5 factors:</p>
        <div className="grid grid-cols-5 gap-2 mt-2">
          <div className="bg-white rounded-lg px-2 py-1.5 border border-blue-100 text-center">
            <p className="text-lg font-bold text-blue-700">30</p>
            <p className="text-[10px] text-blue-500">Module Match</p>
          </div>
          <div className="bg-white rounded-lg px-2 py-1.5 border border-blue-100 text-center">
            <p className="text-lg font-bold text-blue-700">25</p>
            <p className="text-[10px] text-blue-500">Level Match</p>
          </div>
          <div className="bg-white rounded-lg px-2 py-1.5 border border-blue-100 text-center">
            <p className="text-lg font-bold text-blue-700">20</p>
            <p className="text-[10px] text-blue-500">Sub-Module</p>
          </div>
          <div className="bg-white rounded-lg px-2 py-1.5 border border-blue-100 text-center">
            <p className="text-lg font-bold text-blue-700">15</p>
            <p className="text-[10px] text-blue-500">Workload</p>
          </div>
          <div className="bg-white rounded-lg px-2 py-1.5 border border-blue-100 text-center">
            <p className="text-lg font-bold text-blue-700">10</p>
            <p className="text-[10px] text-blue-500">Availability</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white min-w-[200px]">
          <option value="">All Customers</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
        </select>
        <div className="ml-auto">
          <Button onClick={openCreate}><Plus className="w-4 h-4"/> Add Rule</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : rules.length === 0 ? (
        <div className="text-center py-16">
          <Users className="w-12 h-12 mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500 font-medium">No assignment rules configured</p>
          <p className="text-sm text-gray-400 mt-1">Create rules to enable smart agent assignment</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([customerName, customerRules]) => (
            <div key={customerName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-800">{customerName}</span>
                <span className="text-xs text-gray-400">{customerRules.length} rule{customerRules.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="divide-y divide-gray-100">
                {customerRules.map(rule => (
                  <div key={rule.id} className={`flex items-center gap-3 px-5 py-3 group ${!rule.isActive ? 'opacity-50' : ''}`}>
                    <span className="text-xs text-gray-400 font-mono w-6">#{rule.sortOrder}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">{rule.name}</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${MODE_COLORS[rule.assignmentMode] || 'bg-gray-100'}`}>
                          {MODE_LABELS[rule.assignmentMode] || rule.assignmentMode}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        <span>{rule.recordType || 'All Types'}</span>
                        <span>·</span>
                        <span>{rule.priority || 'Any Priority'}</span>
                        {rule.sapModule && <><span>·</span><span className="font-mono text-blue-600">{rule.sapModule.code}</span></>}
                        {rule.preferredLevel && <><span>·</span><span>Prefer {rule.preferredLevel}</span></>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleToggle(rule)} className={`p-1.5 rounded-lg ${rule.isActive ? 'text-green-500' : 'text-gray-400'}`}>
                        {rule.isActive ? <ToggleRight className="w-4 h-4"/> : <ToggleLeft className="w-4 h-4"/>}
                      </button>
                      <button onClick={() => openEdit(rule)} className="p-1.5 text-orange-400 hover:bg-orange-50 rounded-lg"><Pencil className="w-4 h-4"/></button>
                      <button onClick={() => handleDelete(rule.id)} className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4"/></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={editRule ? 'Edit Assignment Rule' : 'Create Assignment Rule'} size="lg"
        footer={<>
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button loading={saving} onClick={handleSave}>{editRule ? 'Save' : 'Create'}</Button>
        </>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer *</label>
              <select value={form.customerId} onChange={e => setForm(f => ({...f, customerId: e.target.value}))}
                disabled={!!editRule} className={`${ic} disabled:bg-gray-100`}>
                <option value="">Select customer…</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rule Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
                placeholder="e.g., P1 Auto-Assign L3" className={ic}/>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Record Type</label>
              <select value={form.recordType} onChange={e => setForm(f => ({...f, recordType: e.target.value}))} className={ic}>
                {RECORD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select value={form.priority} onChange={e => setForm(f => ({...f, priority: e.target.value}))} className={ic}>
                {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SAP Module</label>
              <select value={form.sapModuleId} onChange={e => setForm(f => ({...f, sapModuleId: e.target.value}))} className={ic}>
                <option value="">Any Module</option>
                {modules.map((m: any) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Assignment Mode *</label>
              <select value={form.assignmentMode} onChange={e => setForm(f => ({...f, assignmentMode: e.target.value}))} className={ic}>
                <option value="AUTO_ASSIGN">Auto-Assign (automatic)</option>
                <option value="RECOMMEND">Recommend (show suggestions)</option>
                <option value="ROUND_ROBIN">Round Robin (load balance)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Preferred Agent Level</label>
              <select value={form.preferredLevel} onChange={e => setForm(f => ({...f, preferredLevel: e.target.value}))} className={ic}>
                {LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
              <input type="number" value={form.sortOrder} onChange={e => setForm(f => ({...f, sortOrder: Number(e.target.value)}))}
                className={ic} min={0}/>
              <p className="text-xs text-gray-400 mt-1">Lower = evaluated first</p>
            </div>
          </div>

          <div className={`p-3 rounded-xl border text-sm ${
            form.assignmentMode === 'AUTO_ASSIGN' ? 'bg-green-50 border-green-200 text-green-700' :
            form.assignmentMode === 'ROUND_ROBIN' ? 'bg-purple-50 border-purple-200 text-purple-700' :
            'bg-blue-50 border-blue-200 text-blue-700'
          }`}>
            {form.assignmentMode === 'AUTO_ASSIGN' && '⚡ Auto-Assign: System scores all eligible agents (module match 30pts + level 25pts + sub-module 20pts + workload 15pts + availability 10pts) and assigns the highest-scoring available agent instantly.'}
            {form.assignmentMode === 'RECOMMEND' && '💡 Recommend: Agents are ranked by score and shown as suggestions during ticket creation. The creator or admin makes the final selection.'}
            {form.assignmentMode === 'ROUND_ROBIN' && '🔄 Round Robin: Tickets are distributed to the agent with the fewest open tickets among those assigned to this customer. Ensures even load distribution regardless of specialization.'}
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs text-gray-500">
            <p className="font-semibold text-gray-600 mb-1">Preferred Level — "Auto" means:</p>
            <p>P1 Critical → prefers L3/L4 experts (25pts) over L1 (5pts)</p>
            <p>P2 High → prefers L3 (25pts), then L4 (20pts)</p>
            <p>P3 Medium → prefers L2 (25pts), then L1 (20pts)</p>
            <p>P4 Low → prefers L1 (25pts), then L2 (20pts)</p>
            <p className="mt-1 italic">Setting a specific level overrides this: exact match = 25pts, adjacent = 15pts, others = 5pts.</p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
