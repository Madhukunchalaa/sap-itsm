import React, { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageSquare, Timer, Paperclip, Save, X, Send, Lock, Edit2, History, Trash2, Upload, Download, ExternalLink, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { useRecord, useUpdateRecord, useAddComment, useAddTimeEntry, useAgents, useDeleteRecord } from '../hooks/useApi';
import { auditApi, recordsApi } from '../api/services';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { PriorityBadge, StatusBadge, TypeBadge } from '../components/ui/Badges';
import { Button, Card, Textarea } from '../components/ui/Forms';
import { Modal } from '../components/ui/Modal';
import { useAuthStore } from '../store/auth.store';
import { formatDistanceToNow, format } from 'date-fns';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';

const STATUS_TRANSITIONS: Record<string, string[]> = {
  NEW:               ['OPEN','IN_PROGRESS','AWAITING_CUSTOMER','CANCELLED'],
  OPEN:              ['IN_PROGRESS','PENDING','AWAITING_CUSTOMER','RESOLVED','CANCELLED'],
  IN_PROGRESS:       ['PENDING','AWAITING_CUSTOMER','RESOLVED','CLOSED'],
  PENDING:           ['IN_PROGRESS','AWAITING_CUSTOMER','RESOLVED','CLOSED'],
  AWAITING_CUSTOMER: ['IN_PROGRESS','OPEN','RESOLVED','CLOSED'],
  WITH_SAP:          ['IN_PROGRESS','PENDING','RESOLVED','CLOSED'],
  RESOLVED:          ['CLOSED','IN_PROGRESS','REOPEN'],
  CLOSED:            ['REOPEN'], 
  CANCELLED:         ['REOPEN'],
  REOPEN:            ['IN_PROGRESS','AWAITING_CUSTOMER','RESOLVED','CLOSED'],
};

const SUPER_ADMIN_ALL_STATUSES = ['NEW','OPEN','IN_PROGRESS','PENDING','AWAITING_CUSTOMER','WITH_SAP','RESOLVED','CLOSED','CANCELLED','REOPEN'];

const PRIORITY_COLORS: Record<string,string> = {
  P1:'border-l-red-500', P2:'border-l-orange-500',
  P3:'border-l-yellow-500', P4:'border-l-green-500',
};

export default function RecordDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const { data: record, isLoading } = useRecord(id!);
  const updateRecord = useUpdateRecord();
  const deleteRecord = useDeleteRecord();
  const addComment = useAddComment();
  const addTimeEntry = useAddTimeEntry();
  const { data: agentsData } = useAgents({ limit: 100 });
  const agents = agentsData?.data || [];

  const [activeTab, setActiveTab] = useState<'comments'|'time'|'changelog'>('comments');
  const [changeLog, setChangeLog] = React.useState<any[]>([]);
  const [logLoading, setLogLoading] = React.useState(false);
  const [commentText, setCommentText] = useState('');
  const [internalFlag, setInternal] = useState(false);
  const [timeModal, setTimeModal] = useState(false);
  const [timeForm, setTimeForm] = useState({ hours:'', description:'', workDate: format(new Date(),'yyyy-MM-dd') });
  const [deleteModal, setDeleteModal] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [editedStatus, setEditedStatus] = useState('');
  const [editedPriority, setEditedPriority] = useState('');
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [editedAgentId, setEditedAgentId] = useState('');
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [attachmentsLoaded, setAttachmentsLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');

  const loadAttachments = async () => {
    if (attachmentsLoaded) return;
    try {
      const res = await recordsApi.getAttachments(id!);
      setAttachments(res.data.attachments || []);
      setAttachmentsLoaded(true);
    } catch {}
  };

  React.useEffect(() => { if (record) loadAttachments(); }, [record?.id]);

  if (isLoading) return <LoadingSpinner fullscreen label="Loading ticket…"/>;
  if (!record) return <div className="p-8 text-center text-gray-400">Ticket not found.</div>;

  const canEdit = ['SUPER_ADMIN','COMPANY_ADMIN','AGENT','PROJECT_MANAGER','USER'].includes(user?.role||'');
  const canAssign = ['SUPER_ADMIN','COMPANY_ADMIN','PROJECT_MANAGER'].includes(user?.role||'');
  const canSeeInternal = ['SUPER_ADMIN', 'AGENT'].includes(user?.role||'');
  const isAgent = ['SUPER_ADMIN','COMPANY_ADMIN','AGENT','PROJECT_MANAGER'].includes(user?.role||'');
  const canLogTime = ['SUPER_ADMIN','AGENT','PROJECT_MANAGER'].includes(user?.role||'');

  const handleEnterEdit = () => {
    setEditedStatus(record.status);
    setEditedPriority(record.priority);
    setEditedTitle(record.title);
    setEditedDescription(record.description);
    setEditedAgentId(record.assignedAgent?.id || '');
    setEditMode(true);
  };

  const handleCancelEdit = () => setEditMode(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: any = {};
      if (editedStatus !== record.status) updates.status = editedStatus;
      if (editedPriority !== record.priority) updates.priority = editedPriority;
      if (editedTitle !== record.title) updates.title = editedTitle;
      if (editedDescription !== record.description) updates.description = editedDescription;
      if (editedAgentId !== (record.assignedAgent?.id||'')) updates.assignedAgentId = editedAgentId || null;
      if (Object.keys(updates).length > 0) {
        await updateRecord.mutateAsync({ id: record.id, data: updates });
      }
      setEditMode(false);
    } finally { setSaving(false); }
  };

  const handleComment = async () => {
    const stripped = commentText.replace(/<[^>]*>/g, '').trim();
    if (!stripped) return;
    await addComment.mutateAsync({ recordId: record.id, text: commentText, internalFlag });
    setCommentText(''); setInternal(false);
  };

  const handleTimeEntry = async () => {
    if (!timeForm.hours || !timeForm.description) return;
    await addTimeEntry.mutateAsync({
      recordId: record.id, hours: parseFloat(timeForm.hours),
      description: timeForm.description, workDate: new Date(timeForm.workDate).toISOString(),
    });
    setTimeModal(false);
    setTimeForm({ hours:'', description:'', workDate: format(new Date(),'yyyy-MM-dd') });
  };

  const handleDelete = async () => {
    await deleteRecord.mutateAsync(record.id);
    navigate('/records');
  };

  const attachmentNames: string[] = record.metadata?.attachmentNames || [];
  const sla = record.slaTracking;

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button onClick={() => navigate('/records')} className="text-gray-400 hover:text-gray-600 mt-1">
          <ArrowLeft className="w-5 h-5"/>
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-mono text-sm text-gray-400">{record.recordNumber}</span>
            <TypeBadge type={record.recordType}/>
          </div>
          {editMode && user?.role !== 'USER'
            ? <input value={editedTitle} onChange={e=>setEditedTitle(e.target.value)}
                className="w-full text-xl font-bold text-gray-900 border-b-2 border-blue-500 focus:outline-none bg-transparent pb-1"/>
            : <h1 className="text-xl font-bold text-gray-900">{record.title}</h1>
          }
        </div>
        {canEdit && !editMode && (
          <div className="flex gap-2">
            {user?.role === 'SUPER_ADMIN' && (
              <button onClick={() => setDeleteModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-red-200 rounded-lg text-red-600 hover:bg-red-50">
                <Trash2 className="w-4 h-4"/> Delete
              </button>
            )}
            <button onClick={handleEnterEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">
              <Edit2 className="w-4 h-4"/> Edit
            </button>
          </div>
        )}
        {editMode && (
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={handleCancelEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">
              <X className="w-4 h-4"/> Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-60">
              <Save className="w-4 h-4"/> {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: Main Content */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <div className={`p-5 border-l-4 ${PRIORITY_COLORS[record.priority]||'border-l-gray-300'}`}>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Description</h3>
              {editMode && user?.role !== 'USER'
                ? <textarea value={editedDescription} onChange={e=>setEditedDescription(e.target.value)}
                    rows={5} className="w-full text-sm text-gray-600 border border-blue-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"/>
                : <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{record.description}</p>
              }
            </div>
          </Card>

          <Card>
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Paperclip className="w-4 h-4"/> Attachments ({attachments.length})
                </h3>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5"/> {uploading ? 'Uploading…' : 'Upload'}
                </button>
                <input ref={fileInputRef} type="file" className="hidden" multiple
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    if (!files.length) return;
                    setUploading(true);
                    try {
                      for (const file of files) {
                        const res = await recordsApi.uploadAttachment(record.id, file);
                        const att = res.data.attachment;
                        const urlRes = await recordsApi.getAttachments(record.id);
                        setAttachments(urlRes.data.attachments || []);
                      }
                    } finally { setUploading(false); e.target.value = ''; }
                  }}
                />
              </div>
              {attachments.length === 0
                ? <p className="text-sm text-gray-400 text-center py-3">No attachments yet.</p>
                : <div className="space-y-2">
                    {attachments.map((a: any) => (
                      <div key={a.key} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg text-sm text-gray-600">
                        <Paperclip className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"/>
                        <span className="flex-1 truncate">{a.name}</span>
                        <span className="text-xs text-gray-400">{(a.size/1024).toFixed(0)}KB</span>
                        <a href={a.url} target="_blank" rel="noreferrer"
                          className="text-blue-500 hover:text-blue-700 flex-shrink-0">
                          <Download className="w-4 h-4"/>
                        </a>
                        {canEdit && (
                          <button onClick={async () => {
                            await recordsApi.deleteAttachment(record.id, a.key);
                            setAttachments(prev => prev.filter(x => x.key !== a.key));
                          }} className="text-red-400 hover:text-red-600 flex-shrink-0">
                            <X className="w-4 h-4"/>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
              }
            </div>
          </Card>

          {sla && (
            <Card title="SLA Status">
              <div className="p-4 space-y-3">
                <SLAProgressBar label="Response SLA" deadline={sla.responseDeadline}
                  startTime={record.createdAt} breached={sla.breachResponse} responded={sla.respondedAt}/>
                <SLAProgressBar label="Resolution SLA" deadline={sla.resolutionDeadline}
                  startTime={record.createdAt} breached={sla.breachResolution}/>
              </div>
            </Card>
          )}

          <Card>
            <div className="border-b border-gray-100">
              <div className="flex gap-1 px-4">
                {[
                  { key:'comments',   label:`Comments (${record.comments?.length||0})`, icon:MessageSquare },
                  { key:'changelog', label:'Change Log',                               icon:History },
                  ...(canLogTime ? [{ key:'time', label:`Time (${record.timeEntries?.length||0})`, icon:Timer }] : []),
                ].map(tab=>(
                  <button key={tab.key} onClick={async ()=>{ setActiveTab(tab.key as any); if(tab.key==='changelog'){ setLogLoading(true); try{ const r=await recordsApi.getHistory(record.id); setChangeLog(r.data.history||[]); }catch{} setLogLoading(false); } }}
                    className={`flex items-center gap-1.5 px-3 py-3 text-sm font-medium border-b-2 transition-colors ${
                      activeTab===tab.key?'border-blue-600 text-blue-600':'border-transparent text-gray-500 hover:text-gray-700'}`}>
                    <tab.icon className="w-4 h-4"/>{tab.label}
                  </button>
                ))}
              </div>
            </div>

            {activeTab==='comments' && (
              <div className="p-4 space-y-4">
                {(record.comments||[]).length===0 && <p className="text-sm text-center text-gray-400 py-6">No comments yet.</p>}
                {(record.comments||[]).map((c:any) => (
                  <div key={c.id} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-700 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {c.author.firstName[0]}{c.author.lastName[0]}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-gray-900">{c.author.firstName} {c.author.lastName}</span>
                        {c.internalFlag && (
                          <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                            <Lock className="w-3 h-3"/> Internal
                          </span>
                        )}
                        <span className="text-xs text-gray-400 ml-auto">{formatDistanceToNow(new Date(c.createdAt),{addSuffix:true})}</span>
                      </div>
                      <div className={`text-sm text-gray-700 bg-gray-50 rounded-xl px-4 py-3 ${c.internalFlag?'border border-amber-200':''} prose prose-sm max-w-none`}
                        dangerouslySetInnerHTML={{ __html: c.text }}
                      />
                    </div>
                  </div>
                ))}
                <div className="border-t border-gray-100 pt-4">
                  <div className="relative">
                    <ReactQuill
                      value={commentText}
                      onChange={(val) => {
                        setCommentText(val);
                        // Detect trailing @mention pattern to show picker
                        const plain = val.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
                        const atMatch = plain.match(/@([A-Za-z]*)$/);
                        if (atMatch) {
                          setMentionFilter(atMatch[1].toLowerCase());
                          setShowMentionPicker(true);
                        } else {
                          setShowMentionPicker(false);
                          setMentionFilter('');
                        }
                      }}
                      placeholder="Add a comment… (use @name to mention someone)"
                      modules={{
                        toolbar: [
                          ['bold', 'italic', 'underline', 'strike'],
                          [{ list: 'ordered' }, { list: 'bullet' }],
                          ['link', 'blockquote', 'code-block'],
                          ['clean'],
                        ],
                      }}
                      className="rounded-lg"
                      style={{ minHeight: '120px' }}
                    />
                    {showMentionPicker && (() => {
                      const mentionableUsers = agents
                        .filter((a: any) => {
                          if (!a.user) return false;
                          const full = `${a.user.firstName} ${a.user.lastName}`.toLowerCase();
                          const first = (a.user.firstName || '').toLowerCase();
                          return mentionFilter === '' || first.startsWith(mentionFilter) || full.startsWith(mentionFilter);
                        })
                        .slice(0, 8);
                      if (mentionableUsers.length === 0) return null;
                      return (
                        <div className="absolute z-50 bottom-full mb-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[200px] max-h-48 overflow-y-auto">
                          <p className="text-xs text-gray-400 px-3 pt-2 pb-1">Mention a user</p>
                          {mentionableUsers.map((a: any) => (
                            <button
                              key={a.id}
                              type="button"
                              className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 hover:text-indigo-700 flex items-center gap-2"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                const fullName = `${a.user.firstName} ${a.user.lastName}`;
                                // Replace trailing @... with @FullName
                                const withMention = commentText.replace(/@([A-Za-z]*)(<\/[^>]+>)?$/, (m, _partial, closing) => {
                                  return `@${fullName}${closing || ''}`;
                                });
                                // If no replacement happened, append
                                const updated = withMention !== commentText ? withMention : commentText + `@${fullName}`;
                                setCommentText(updated);
                                setShowMentionPicker(false);
                                setMentionFilter('');
                              }}
                            >
                              <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                                {a.user.firstName?.[0]}{a.user.lastName?.[0]}
                              </span>
                              {a.user.firstName} {a.user.lastName}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    {isAgent && (
                      <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                        {canSeeInternal && <input type="checkbox" checked={internalFlag} onChange={e=>setInternal(e.target.checked)} className="rounded"/>}
                        Internal note (not visible to customer)
                      </label>
                    )}
                    <Button onClick={handleComment} loading={addComment.isPending} disabled={!commentText.replace(/<[^>]*>/g,'').trim()} size="sm" className="ml-auto">
                      <Send className="w-3.5 h-3.5"/> Post
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {activeTab==='changelog' && (
              <div className="p-4 space-y-3">
                {logLoading && <p className="text-sm text-center text-gray-400 py-6">Loading change log…</p>}
                {!logLoading && (() => {
                  // Filter: COMPANY_ADMIN and USER cannot see time entries or internal notes in changelog
                  const visibleLogs = changeLog.filter((log:any) => {
                    if (!canLogTime && log.entityType === 'TimeEntry') return false;
                    if (!canSeeInternal && log.entityType === 'Comment' && log.newValues?.internalFlag) return false;
                    return true;
                  });
                  // Human-readable field name map (avoids showing raw UUIDs)
                  const FIELD_LABELS: Record<string,string> = {
                    assignedAgentId: 'Assigned Agent',
                    status: 'Status', priority: 'Priority', title: 'Title',
                    recordType: 'Type', customerId: 'Customer',
                    description: 'Description', resolvedAt: 'Resolved At',
                  };
                  // Fields that are UUIDs - show a short indicator instead of raw UUID
                  const UUID_FIELDS = new Set(['assignedAgentId','customerId','contractId']);
                  const fmtVal = (k:string, v:any) => {
                    if (v == null) return '—';
                    if (k === 'assignedAgentId' && v) {
                      const agent = agents.find((a:any) => a.id === v);
                      return agent ? `${agent.user?.firstName} ${agent.user?.lastName}` : '(assigned)';
                    }
                    if (k === 'assignedAgentId' && !v) return '(unassigned)';
                    if (UUID_FIELDS.has(k)) return v ? '(set)' : '(cleared)';
                    return String(v);
                  };
                  if (visibleLogs.length === 0) return <p className="text-sm text-center text-gray-400 py-6">No changes recorded yet.</p>;
                  return visibleLogs.map((log:any) => {
                    const actionColors: Record<string,string> = {
                      STATUS_CHANGE: 'bg-blue-100 text-blue-700',
                      ASSIGN: 'bg-purple-100 text-purple-700',
                      UPDATE: 'bg-gray-100 text-gray-600',
                      COMMENT: 'bg-amber-100 text-amber-700',
                      CREATE: 'bg-green-100 text-green-700',
                    };
                    const colorClass = actionColors[log.action] || 'bg-gray-100 text-gray-600';
                    const changedKeys = (log.oldValues && log.newValues)
                      ? Object.keys(log.newValues).filter(k =>
                          log.oldValues[k] !== undefined && log.oldValues[k] !== log.newValues[k]
                        )
                      : [];
                    return (
                      <div key={log.id} className="flex gap-3 text-sm border-b border-gray-50 pb-3 last:border-0">
                        <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0 text-xs font-bold text-indigo-600">
                          {log.user ? `${log.user.firstName?.[0]}${log.user.lastName?.[0]}` : '⚙'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900">{log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System'}</span>
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${colorClass}`}>{log.action.replace('_',' ')}</span>
                            <span className="text-xs text-gray-400 ml-auto">{format(new Date(log.createdAt), 'dd MMM yyyy HH:mm')}</span>
                          </div>
                          {changedKeys.length > 0 && (
                            <div className="mt-1 text-xs text-gray-500 space-y-0.5">
                              {changedKeys.map((k:string) => (
                                <div key={k}>
                                  <span className="font-medium text-gray-700">{FIELD_LABELS[k] || k}:</span>
                                  {' '}<span className="line-through text-red-400">{fmtVal(k, log.oldValues[k])}</span>
                                  {' → '}<span className="text-green-600">{fmtVal(k, log.newValues[k])}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {log.newValues?.text && (
                            <p className="mt-1 text-xs text-gray-500 italic">"{String(log.newValues.text).slice(0,120)}{String(log.newValues.text).length>120?'…':''}"</p>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}

            {activeTab==='time' && canLogTime && (
              <div className="p-4">
                {canLogTime && <div className="flex justify-end mb-4"><Button onClick={()=>setTimeModal(true)} size="sm"><Timer className="w-3.5 h-3.5"/> Log Time</Button></div>}
                {(record.timeEntries||[]).length===0
                  ? <p className="text-sm text-center text-gray-400 py-6">No time entries yet.</p>
                  : <div className="space-y-2">{(record.timeEntries||[]).map((te:any) => (
                    <div key={te.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                      <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                        <span className="text-sm font-bold text-blue-700">{te.hours}h</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-gray-900">{te.description}</p>
                        <p className="text-xs text-gray-400">{te.agent?.user.firstName} · {format(new Date(te.workDate),'MMM d, yyyy')}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${te.status==='APPROVED'?'bg-green-100 text-green-700':te.status==='REJECTED'?'bg-red-100 text-red-700':'bg-yellow-100 text-yellow-700'}`}>{te.status}</span>
                    </div>
                  ))}</div>
                }
              </div>
            )}
          </Card>
        </div>

        {/* Right: Details Sidebar */}
        <div className="space-y-4">
          <Card title="Details">
            <div className="p-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</label>
                <div className="mt-1.5">
                  {editMode
                    ? <select value={editedStatus} onChange={e=>setEditedStatus(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                        {(user?.role === 'SUPER_ADMIN' || user?.role === 'PROJECT_MANAGER' || user?.role === 'AGENT'
                          ? SUPER_ADMIN_ALL_STATUSES
                          : [record.status,...(STATUS_TRANSITIONS[record.status]||[])]
                        ).map(s=>(
                          <option key={s} value={s}>{s.replace(/_/g,' ')}</option>
                        ))}
                      </select>
                    : <StatusBadge status={record.status}/>
                  }
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Priority</label>
                <div className="mt-1.5">
                  {editMode && user?.role !== 'USER'
                    ? <select value={editedPriority} onChange={e=>setEditedPriority(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                        {['P1','P2','P3','P4'].map(p=><option key={p}>{p}</option>)}
                      </select>
                    : <PriorityBadge priority={record.priority}/>
                  }
                </div>
              </div>

              <div className="border-t border-gray-100"/>

              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Assigned To</label>
                <div className="mt-1.5">
                  {editMode && canAssign
                    ? <select value={editedAgentId} onChange={e=>setEditedAgentId(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                        <option value="">— Unassigned —</option>
                        {agents.map((a:any) => (
                          <option key={a.id} value={a.id}>
                            {a.user?.firstName} {a.user?.lastName} ({a.level})
                          </option>
                        ))}
                      </select>
                    : record.assignedAgent ? (
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">
                          {record.assignedAgent.user.firstName[0]}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{record.assignedAgent.user.firstName} {record.assignedAgent.user.lastName}</p>
                          <p className="text-xs text-gray-400">{record.assignedAgent.level}</p>
                        </div>
                      </div>
                    ) : <span className="text-sm text-gray-400">Unassigned</span>
                  }
                </div>
              </div>

              {record.customer && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Customer</label>
                  <p className="text-sm text-gray-900 mt-1">{record.customer.companyName}</p>
                </div>
              )}
              {record.ci && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Configuration Item</label>
                  <p className="text-sm text-gray-900 mt-1">{record.ci.name}</p>
                  <p className="text-xs text-gray-400">{record.ci.ciType}</p>
                </div>
              )}
              {record.sapModule && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">SAP Module</label>
                  <p className="text-sm text-gray-900 mt-1">
                    <span className="font-mono font-bold text-indigo-600">{record.sapModule.code}</span>{' '}
                    {record.sapModule.name}
                  </p>
                  {record.sapSubModule && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      <span className="font-mono">{record.sapSubModule.code}</span> — {record.sapSubModule.name}
                    </p>
                  )}
                </div>
              )}

              <div className="border-t border-gray-100 pt-3 space-y-2">
                {record.createdBy && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Created By</span>
                    <span className="text-gray-600 font-medium">{record.createdBy.firstName} {record.createdBy.lastName}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Created</span>
                  <span className="text-gray-600">{format(new Date(record.createdAt),'MMM d, yyyy HH:mm')}</span>
                </div>
                {record.resolvedAt && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Resolved</span>
                    <span className="text-green-600">{format(new Date(record.resolvedAt),'MMM d, yyyy HH:mm')}</span>
                  </div>
                )}
              </div>

              {record.tags?.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Tags</label>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {record.tags.map((tag:string) => (
                      <span key={tag} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{tag}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* SAP Integration Status */}
          {(record.metadata as any)?.sapSyncStatus && (
            <Card title="SAP Mirroring">
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500 uppercase">Sync Status</span>
                  <div className="flex items-center gap-1.5">
                    {(record.metadata as any).sapSyncStatus === 'SUCCESS' ? (
                      <span className="flex items-center gap-1 text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                        <CheckCircle className="w-3 h-3"/> Mirrored
                      </span>
                    ) : (record.metadata as any).sapSyncStatus === 'FAILED' ? (
                      <span className="flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                        <AlertCircle className="w-3 h-3"/> Failed
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full anime-spin">
                        <RefreshCw className="w-3 h-3"/> Syncing...
                      </span>
                    )}
                  </div>
                </div>
                
                {(record.metadata as any).sapIncidentId && (
                  <div className="flex items-center justify-between border-t border-gray-50 pt-3">
                    <span className="text-xs font-medium text-gray-500 uppercase">SAP Reference</span>
                    <a 
                      href={`https://sap-portal.intraedge.com/incident/${(record.metadata as any).sapIncidentId}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-sm font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                    >
                      #{(record.metadata as any).sapIncidentId}
                      <ExternalLink className="w-3.5 h-3.5"/>
                    </a>
                  </div>
                )}

                {(record.metadata as any).sapSyncError && (
                  <p className="text-[10px] text-red-400 mt-2 bg-red-50/50 p-2 rounded border border-red-100 italic">
                    Error: {(record.metadata as any).sapSyncError}
                  </p>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      {canLogTime && <Modal open={timeModal} onClose={()=>setTimeModal(false)} title="Log Time Entry" size="sm"
        footer={<><Button variant="secondary" onClick={()=>setTimeModal(false)}>Cancel</Button><Button onClick={handleTimeEntry} loading={addTimeEntry.isPending}>Save Entry</Button></>}>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">Hours</label>
            <input type="number" step="0.5" min="0.5" max="24" value={timeForm.hours}
              onChange={e=>setTimeForm(f=>({...f,hours:e.target.value}))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. 1.5"/>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">Work Date</label>
            <input type="date" value={timeForm.workDate} onChange={e=>setTimeForm(f=>({...f,workDate:e.target.value}))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          </div>
          <Textarea label="Description" value={timeForm.description}
            onChange={e=>setTimeForm(f=>({...f,description:e.target.value}))} placeholder="What did you work on?" rows={3}/>
        </div>
      </Modal>}

      <Modal open={deleteModal} onClose={()=>setDeleteModal(false)} title="Delete Ticket" size="sm"
        footer={<><Button variant="secondary" onClick={()=>setDeleteModal(false)}>Cancel</Button><Button onClick={handleDelete} loading={deleteRecord.isPending} className="bg-red-600 hover:bg-red-700">Delete Permanently</Button></>}>
        <div className="space-y-3">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trash2 className="w-6 h-6 text-red-600"/>
          </div>
          <p className="text-sm text-gray-600 text-center">Are you sure you want to delete ticket <strong>{record.recordNumber}</strong>?</p>
          <p className="text-xs text-red-500 bg-red-50 p-3 rounded-lg border border-red-100 text-center">
            This action is permanent and will remove all comments, time entries, and history associated with this ticket.
          </p>
        </div>
      </Modal>
    </div>
  );
}

function SLAProgressBar({ label, deadline, startTime, breached, responded }: {
  label:string; deadline:string; startTime:string; breached:boolean; responded?:string;
}) {
  const now = new Date(), start = new Date(startTime), end = new Date(deadline);
  const pct = Math.min(100, Math.max(0, ((now.getTime()-start.getTime())/(end.getTime()-start.getTime()))*100));
  const color = breached?'bg-red-500':pct>=80?'bg-orange-400':'bg-green-500';
  const textColor = breached?'text-red-600':pct>=80?'text-orange-600':'text-green-600';
  const msLeft = end.getTime()-now.getTime();
  const hLeft = Math.floor(Math.abs(msLeft)/3600000);
  const mLeft = Math.floor((Math.abs(msLeft)%3600000)/60000);
  const timeStr = breached?`Breached ${hLeft}h ${mLeft}m ago`:responded?'Responded ✓':`${hLeft}h ${mLeft}m remaining`;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="font-medium text-gray-600">{label}</span>
        <span className={`font-semibold ${textColor}`}>{timeStr}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{width:`${pct}%`}}/>
      </div>
    </div>
  );
}
