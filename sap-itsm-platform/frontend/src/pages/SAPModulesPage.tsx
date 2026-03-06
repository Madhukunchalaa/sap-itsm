import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sapModulesApi } from '../api/services';
import { getErrorMessage } from '../api/client';
import { PageHeader, Button } from '../components/ui/Forms';
import { Modal } from '../components/ui/Modal';
import {
  Plus, Pencil, Trash2, ChevronDown, ChevronRight, Layers,
  Zap, ToggleLeft, ToggleRight, Package,
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function SAPModulesPage() {
  const queryClient = useQueryClient();
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [showModuleModal, setShowModuleModal] = useState(false);
  const [showSubModal, setShowSubModal] = useState(false);
  const [editModule, setEditModule] = useState<any>(null);
  const [editSub, setEditSub] = useState<any>(null);
  const [parentModuleId, setParentModuleId] = useState('');
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const [moduleForm, setModuleForm] = useState({ code: '', name: '', description: '', sortOrder: 0 });
  const [subForm, setSubForm] = useState({ code: '', name: '', description: '', sortOrder: 0 });

  const { data: modules, isLoading } = useQuery({
    queryKey: ['sap-modules'],
    queryFn: () => sapModulesApi.list().then(r => r.data.data),
  });

  const toggleModule = (id: string) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await sapModulesApi.seed();
      toast.success(res.data.message || 'SAP modules seeded');
      queryClient.invalidateQueries({ queryKey: ['sap-modules'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSeeding(false); }
  };

  // Module CRUD
  const openCreateModule = () => {
    setModuleForm({ code: '', name: '', description: '', sortOrder: 0 });
    setEditModule(null);
    setShowModuleModal(true);
  };

  const openEditModule = (mod: any) => {
    setModuleForm({ code: mod.code, name: mod.name, description: mod.description || '', sortOrder: mod.sortOrder || 0 });
    setEditModule(mod);
    setShowModuleModal(true);
  };

  const handleSaveModule = async () => {
    if (!moduleForm.code || !moduleForm.name) { toast.error('Code and Name are required'); return; }
    setSaving(true);
    try {
      if (editModule) {
        await sapModulesApi.update(editModule.id, { name: moduleForm.name, description: moduleForm.description, sortOrder: moduleForm.sortOrder });
        toast.success('Module updated');
      } else {
        await sapModulesApi.create(moduleForm);
        toast.success('Module created');
      }
      queryClient.invalidateQueries({ queryKey: ['sap-modules'] });
      setShowModuleModal(false);
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const handleDeleteModule = async (id: string) => {
    if (!confirm('Delete this module and all its sub-modules?')) return;
    try {
      await sapModulesApi.delete(id);
      toast.success('Module deleted');
      queryClient.invalidateQueries({ queryKey: ['sap-modules'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  const handleToggleModule = async (mod: any) => {
    try {
      await sapModulesApi.update(mod.id, { isActive: !mod.isActive });
      queryClient.invalidateQueries({ queryKey: ['sap-modules'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  // Sub-Module CRUD
  const openCreateSub = (moduleId: string) => {
    setSubForm({ code: '', name: '', description: '', sortOrder: 0 });
    setParentModuleId(moduleId);
    setEditSub(null);
    setShowSubModal(true);
  };

  const openEditSub = (sub: any, moduleId: string) => {
    setSubForm({ code: sub.code, name: sub.name, description: sub.description || '', sortOrder: sub.sortOrder || 0 });
    setParentModuleId(moduleId);
    setEditSub(sub);
    setShowSubModal(true);
  };

  const handleSaveSub = async () => {
    if (!subForm.code || !subForm.name) { toast.error('Code and Name are required'); return; }
    setSaving(true);
    try {
      if (editSub) {
        await sapModulesApi.updateSubModule(editSub.id, { name: subForm.name, description: subForm.description, sortOrder: subForm.sortOrder });
        toast.success('Sub-module updated');
      } else {
        await sapModulesApi.createSubModule(parentModuleId, subForm);
        toast.success('Sub-module created');
      }
      queryClient.invalidateQueries({ queryKey: ['sap-modules'] });
      setShowSubModal(false);
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const handleDeleteSub = async (id: string) => {
    if (!confirm('Delete this sub-module?')) return;
    try {
      await sapModulesApi.deleteSubModule(id);
      toast.success('Sub-module deleted');
      queryClient.invalidateQueries({ queryKey: ['sap-modules'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  const handleToggleSub = async (sub: any) => {
    try {
      await sapModulesApi.updateSubModule(sub.id, { isActive: !sub.isActive });
      queryClient.invalidateQueries({ queryKey: ['sap-modules'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  const allModules: any[] = modules || [];

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <PageHeader title="SAP Modules" subtitle="Manage SAP functional modules and sub-modules for ticket categorization" />

      <div className="flex items-center gap-3">
        {allModules.length === 0 && (
          <Button variant="secondary" onClick={handleSeed} loading={seeding}>
            <Zap className="w-4 h-4"/> Seed Default Modules
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          {allModules.length > 0 && (
            <Button variant="secondary" onClick={handleSeed} loading={seeding}>
              <Zap className="w-4 h-4"/> Seed Missing
            </Button>
          )}
          <Button onClick={openCreateModule}><Plus className="w-4 h-4"/> Add Module</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : allModules.length === 0 ? (
        <div className="text-center py-16">
          <Layers className="w-12 h-12 mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500 font-medium">No SAP modules configured</p>
          <p className="text-sm text-gray-400 mt-1">Click "Seed Default Modules" to create the standard SAP module hierarchy</p>
        </div>
      ) : (
        <div className="space-y-2">
          {allModules.map(mod => {
            const isExpanded = expandedModules.has(mod.id);
            const subModules = mod.subModules || [];
            return (
              <div key={mod.id} className={`bg-white rounded-xl border border-gray-200 overflow-hidden ${!mod.isActive ? 'opacity-50' : ''}`}>
                {/* Module row */}
                <div className="flex items-center gap-3 px-5 py-3 group">
                  <button onClick={() => toggleModule(mod.id)} className="flex-shrink-0">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400"/> : <ChevronRight className="w-4 h-4 text-gray-400"/>}
                  </button>
                  <span className="text-lg font-mono font-bold text-indigo-600 w-16">{mod.code}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{mod.name}</p>
                    {mod.description && <p className="text-xs text-gray-400 truncate">{mod.description}</p>}
                  </div>
                  <span className="text-xs text-gray-400">{subModules.length} sub-module{subModules.length !== 1 ? 's' : ''}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openCreateSub(mod.id)} className="p-1.5 text-green-500 hover:bg-green-50 rounded-lg" title="Add sub-module">
                      <Plus className="w-4 h-4"/>
                    </button>
                    <button onClick={() => handleToggleModule(mod)} className={`p-1.5 rounded-lg ${mod.isActive ? 'text-green-500 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                      {mod.isActive ? <ToggleRight className="w-4 h-4"/> : <ToggleLeft className="w-4 h-4"/>}
                    </button>
                    <button onClick={() => openEditModule(mod)} className="p-1.5 text-orange-400 hover:bg-orange-50 rounded-lg">
                      <Pencil className="w-4 h-4"/>
                    </button>
                    <button onClick={() => handleDeleteModule(mod.id)} className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg">
                      <Trash2 className="w-4 h-4"/>
                    </button>
                  </div>
                </div>

                {/* Sub-modules */}
                {isExpanded && subModules.length > 0 && (
                  <div className="border-t border-gray-100 bg-gray-50/50">
                    {subModules.map((sub: any) => (
                      <div key={sub.id} className={`flex items-center gap-3 px-5 py-2.5 pl-14 group/sub border-b border-gray-100 last:border-0 ${!sub.isActive ? 'opacity-50' : ''}`}>
                        <Package className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"/>
                        <span className="text-xs font-mono font-bold text-gray-500 w-14">{sub.code}</span>
                        <p className="text-sm text-gray-700 flex-1">{sub.name}</p>
                        <div className="flex items-center gap-1 opacity-0 group-hover/sub:opacity-100 transition-opacity">
                          <button onClick={() => handleToggleSub(sub)} className={`p-1 rounded-lg ${sub.isActive ? 'text-green-500' : 'text-gray-400'}`}>
                            {sub.isActive ? <ToggleRight className="w-3.5 h-3.5"/> : <ToggleLeft className="w-3.5 h-3.5"/>}
                          </button>
                          <button onClick={() => openEditSub(sub, mod.id)} className="p-1 text-orange-400 hover:bg-orange-50 rounded-lg">
                            <Pencil className="w-3.5 h-3.5"/>
                          </button>
                          <button onClick={() => handleDeleteSub(sub.id)} className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg">
                            <Trash2 className="w-3.5 h-3.5"/>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {isExpanded && subModules.length === 0 && (
                  <div className="border-t border-gray-100 px-14 py-6 text-center text-gray-400 text-sm">
                    No sub-modules yet.{' '}
                    <button onClick={() => openCreateSub(mod.id)} className="text-blue-600 hover:underline">Add one</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Module Modal */}
      <Modal open={showModuleModal} onClose={() => setShowModuleModal(false)}
        title={editModule ? 'Edit SAP Module' : 'Create SAP Module'}
        footer={<>
          <Button variant="secondary" onClick={() => setShowModuleModal(false)}>Cancel</Button>
          <Button loading={saving} onClick={handleSaveModule}>{editModule ? 'Save' : 'Create'}</Button>
        </>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
              <input value={moduleForm.code} onChange={e => setModuleForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                disabled={!!editModule} placeholder="MM" maxLength={10}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-100"/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
              <input type="number" value={moduleForm.sortOrder} onChange={e => setModuleForm(f => ({ ...f, sortOrder: Number(e.target.value) }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input value={moduleForm.name} onChange={e => setModuleForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Materials Management"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input value={moduleForm.description} onChange={e => setModuleForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional description"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
          </div>
        </div>
      </Modal>

      {/* Sub-Module Modal */}
      <Modal open={showSubModal} onClose={() => setShowSubModal(false)}
        title={editSub ? 'Edit Sub-Module' : 'Create Sub-Module'}
        footer={<>
          <Button variant="secondary" onClick={() => setShowSubModal(false)}>Cancel</Button>
          <Button loading={saving} onClick={handleSaveSub}>{editSub ? 'Save' : 'Create'}</Button>
        </>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
              <input value={subForm.code} onChange={e => setSubForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                disabled={!!editSub} placeholder="INV" maxLength={10}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-100"/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
              <input type="number" value={subForm.sortOrder} onChange={e => setSubForm(f => ({ ...f, sortOrder: Number(e.target.value) }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input value={subForm.name} onChange={e => setSubForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Inventory Management"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input value={subForm.description} onChange={e => setSubForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional description"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
          </div>
        </div>
      </Modal>
    </div>
  );
}
