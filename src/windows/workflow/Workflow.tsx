import { useState, useEffect } from 'react'
import type { WorkflowTemplate, UploadDestination, AfterCaptureStep, AfterUploadStep } from '../../types'
import { v4 as uuidv4 } from 'uuid'

const SERVICE_ICONS: Record<string, string> = {
  imgur: 'image',
  custom: 'api',
  disk: 'save',
  clipboard: 'content_copy'
}

export default function Workflow() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [selected, setSelected] = useState<WorkflowTemplate | null>(null)
  const [saving, setSaving] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [activeId, setActiveId] = useState('')

  useEffect(() => {
    window.electronAPI?.getTemplates().then(setTemplates)
    window.electronAPI?.getSettings().then(s => setActiveId(s.activeWorkflowId ?? ''))
  }, [])

  const handleSetActive = async (id: string) => {
    setActiveId(id)
    await window.electronAPI?.setSetting('activeWorkflowId', id)
  }

  const handleSelect = (t: WorkflowTemplate) => {
    setSelected({ ...t })
    setShowNewForm(false)
  }

  const handleSave = async () => {
    if (!selected) return
    setSaving(true)
    const saved = await window.electronAPI?.saveTemplate(selected)
    if (saved) {
      setTemplates(prev => {
        const idx = prev.findIndex(t => t.id === saved.id)
        if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next }
        return [...prev, saved]
      })
      setSelected(saved)
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    await window.electronAPI?.deleteTemplate(id)
    setTemplates(prev => prev.filter(t => t.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  const handleNewTemplate = () => {
    const blank: WorkflowTemplate = {
      id: uuidv4(),
      name: 'New Workflow',
      icon: '⚡',
      afterCapture: [],
      destinations: [],
      afterUpload: [{ type: 'notify' }]
    }
    setSelected(blank)
    setShowNewForm(true)
  }

  const addDestination = (type: UploadDestination['type']) => {
    if (!selected) return
    const dest: UploadDestination = type === 'imgur'
      ? { type: 'imgur', clientId: '' }
      : { type: 'custom', url: '', headers: {} }
    setSelected({ ...selected, destinations: [...selected.destinations, dest] })
  }

  const removeDestination = (idx: number) => {
    if (!selected) return
    setSelected({ ...selected, destinations: selected.destinations.filter((_, i) => i !== idx) })
  }

  const updateDestination = (idx: number, patch: Partial<UploadDestination>) => {
    if (!selected) return
    const next = [...selected.destinations]
    next[idx] = { ...next[idx], ...patch } as UploadDestination
    setSelected({ ...selected, destinations: next })
  }

  const addAfterCapture = (type: AfterCaptureStep['type']) => {
    if (!selected) return
    const step: AfterCaptureStep = type === 'save'
      ? { type: 'save', path: '' }
      : { type }
    setSelected({ ...selected, afterCapture: [...selected.afterCapture, step] })
  }

  const moveAfterCapture = (from: number, to: number) => {
    if (!selected) return
    const next = [...selected.afterCapture]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setSelected({ ...selected, afterCapture: next })
  }

  const moveDestination = (from: number, to: number) => {
    if (!selected) return
    const next = [...selected.destinations]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setSelected({ ...selected, destinations: next })
  }

  const moveAfterUpload = (from: number, to: number) => {
    if (!selected) return
    const next = [...selected.afterUpload]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setSelected({ ...selected, afterUpload: next })
  }

  const addAfterUpload = (type: AfterUploadStep['type']) => {
    if (!selected) return
    const step: AfterUploadStep = type === 'copyUrl'
      ? { type: 'copyUrl', which: 'first' }
      : { type }
    setSelected({ ...selected, afterUpload: [...selected.afterUpload, step] })
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden pt-[6.5rem]">
      {/* Top bar */}
      <header
        className="fixed top-10 right-0 h-16 liquid-glass flex items-center justify-between px-8 z-40"
        style={{ left: '16rem' }}
      >
        <div>
          <h2 className="text-base font-bold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>Destinations & Automation</h2>
          <p className="text-[11px] text-slate-400">Define where your captures go and what happens next</p>
        </div>
        {activeId && (
          <div className="flex items-center gap-2 px-4 py-2 bg-secondary/10 border border-secondary/20 rounded-xl">
            <span className="material-symbols-outlined text-secondary text-sm">star</span>
            <span className="text-xs font-bold text-secondary" style={{ fontFamily: 'Manrope, sans-serif' }}>
              {templates.find(t => t.id === activeId)?.name ?? 'Default'} is active
            </span>
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden p-8 gap-8">
        {/* Connected services / template list */}
        <div className="w-72 flex flex-col gap-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500" style={{ fontFamily: 'Manrope, sans-serif' }}>Workflows</h3>
            <button
              onClick={handleNewTemplate}
              className="text-xs text-primary hover:text-white transition-colors flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              New
            </button>
          </div>

          <div className="space-y-2">
            {templates.map(t => (
              <div
                key={t.id}
                onClick={() => handleSelect(t)}
                className={`flex items-center justify-between p-4 rounded-2xl cursor-pointer transition-all group ${
                  selected?.id === t.id
                    ? 'active-nav-bg border border-primary/20'
                    : 'bg-white/3 hover:bg-white/5 border border-white/5'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xl flex-shrink-0">{t.icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-white truncate" style={{ fontFamily: 'Manrope, sans-serif' }}>{t.name}</p>
                      {activeId === t.id && (
                        <span className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest text-secondary bg-secondary/10 px-2 py-0.5 rounded-full">Active</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500">
                      {t.destinations.length} dest · {t.afterCapture.length + t.afterUpload.length} steps
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); handleSetActive(t.id) }}
                    className={`opacity-0 group-hover:opacity-100 p-1 transition-all ${activeId === t.id ? 'text-secondary opacity-100' : 'text-slate-500 hover:text-secondary'}`}
                    title={activeId === t.id ? 'Default workflow' : 'Set as default'}
                  >
                    <span className="material-symbols-outlined text-sm">{activeId === t.id ? 'star' : 'star_outline'}</span>
                  </button>
                  {!t.builtIn && (
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(t.id) }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-all"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pipeline editor */}
        {selected ? (
          <div className="flex-1 overflow-y-auto space-y-6">
            {/* Template header */}
            <div className="glass-refractive rounded-3xl p-6 flex items-center gap-4">
              <input
                value={selected.icon}
                onChange={e => setSelected({ ...selected, icon: e.target.value })}
                className="w-12 h-12 text-2xl bg-white/5 rounded-2xl text-center border border-white/10 focus:outline-none focus:border-primary/40"
                maxLength={2}
                disabled={selected.builtIn}
              />
              <input
                value={selected.name}
                onChange={e => setSelected({ ...selected, name: e.target.value })}
                className="flex-1 bg-transparent text-white text-xl font-bold focus:outline-none border-b border-transparent focus:border-primary/40 pb-1 transition-colors"
                style={{ fontFamily: 'Manrope, sans-serif' }}
                disabled={selected.builtIn}
              />
              <button
                onClick={() => handleSetActive(selected.id)}
                className={`flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-bold transition-all ${
                  activeId === selected.id
                    ? 'bg-secondary/20 text-secondary border border-secondary/30'
                    : 'bg-white/5 text-slate-400 hover:text-secondary hover:bg-secondary/10 border border-white/10'
                }`}
                style={{ fontFamily: 'Manrope, sans-serif' }}
              >
                <span className="material-symbols-outlined text-sm">{activeId === selected.id ? 'star' : 'star_outline'}</span>
                {activeId === selected.id ? 'Default' : 'Set Default'}
              </button>
              {!selected.builtIn && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="primary-gradient text-slate-900 font-bold px-6 py-3 rounded-2xl text-sm flex items-center gap-2 hover:scale-105 transition-transform disabled:opacity-50"
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  <span className="material-symbols-outlined text-sm">save</span>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>

            {/* Pipeline timeline */}
            <div className="glass-refractive rounded-3xl p-6">
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-6" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Active Workflow Pipeline
              </h4>

              <div className="relative pl-8">
                <div className="absolute left-2.5 top-2 bottom-2 w-0.5 bg-gradient-to-b from-primary via-secondary to-primary opacity-30" />

                {/* After-capture steps */}
                {selected.afterCapture.map((step, i) => (
                  <PipelineStep
                    key={i}
                    icon={step.type === 'annotate' ? 'draw' : step.type === 'save' ? 'save' : 'content_copy'}
                    label={step.type === 'annotate' ? 'Annotate' : step.type === 'save' ? 'Save to Disk' : 'Copy to Clipboard'}
                    active
                    canMoveUp={!selected.builtIn && i > 0}
                    canMoveDown={!selected.builtIn && i < selected.afterCapture.length - 1}
                    onMoveUp={() => moveAfterCapture(i, i - 1)}
                    onMoveDown={() => moveAfterCapture(i, i + 1)}
                    onRemove={!selected.builtIn ? () => setSelected({ ...selected, afterCapture: selected.afterCapture.filter((_, j) => j !== i) }) : undefined}
                  />
                ))}

                {/* Destinations */}
                {selected.destinations.map((dest, i) => (
                  <div key={i} className="relative mb-4">
                    <PipelineStep
                      icon={SERVICE_ICONS[dest.type] ?? 'cloud_upload'}
                      label={dest.type === 'imgur' ? 'Upload to Imgur' : `Upload to ${(dest as { url: string }).url || 'Custom'}`}
                      active
                      canMoveUp={!selected.builtIn && i > 0}
                      canMoveDown={!selected.builtIn && i < selected.destinations.length - 1}
                      onMoveUp={() => moveDestination(i, i - 1)}
                      onMoveDown={() => moveDestination(i, i + 1)}
                      onRemove={!selected.builtIn ? () => removeDestination(i) : undefined}
                    />
                    {dest.type === 'imgur' && !selected.builtIn && (
                      <div className="mt-2 mb-4 ml-2">
                        <input
                          value={dest.clientId}
                          onChange={e => updateDestination(i, { clientId: e.target.value } as Partial<UploadDestination>)}
                          placeholder="Imgur Client ID (optional)"
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary/40"
                        />
                      </div>
                    )}
                    {dest.type === 'custom' && !selected.builtIn && (
                      <div className="mt-2 mb-4 ml-2">
                        <input
                          value={(dest as { url: string }).url}
                          onChange={e => updateDestination(i, { url: e.target.value } as Partial<UploadDestination>)}
                          placeholder="Upload endpoint URL"
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary/40"
                        />
                      </div>
                    )}
                  </div>
                ))}

                {/* After-upload steps */}
                {selected.afterUpload.map((step, i) => (
                  <PipelineStep
                    key={i}
                    icon={step.type === 'copyUrl' ? 'link' : step.type === 'notify' ? 'notifications' : step.type === 'openUrl' ? 'open_in_new' : 'share'}
                    label={step.type === 'copyUrl' ? 'Copy URL to Clipboard' : step.type === 'notify' ? 'Show Notification' : step.type === 'openUrl' ? 'Open URL' : 'OS Share'}
                    active
                    canMoveUp={!selected.builtIn && i > 0}
                    canMoveDown={!selected.builtIn && i < selected.afterUpload.length - 1}
                    onMoveUp={() => moveAfterUpload(i, i - 1)}
                    onMoveDown={() => moveAfterUpload(i, i + 1)}
                    onRemove={!selected.builtIn ? () => setSelected({ ...selected, afterUpload: selected.afterUpload.filter((_, j) => j !== i) }) : undefined}
                  />
                ))}

                {/* Add controls */}
                {!selected.builtIn && (
                  <div className="mt-6 space-y-3">
                    <p className="text-[10px] uppercase tracking-widest text-slate-600 font-bold" style={{ fontFamily: 'Manrope, sans-serif' }}>Add Step</p>
                    <div className="flex flex-wrap gap-2">
                      <AddStepButton label="Annotate" icon="draw" onClick={() => addAfterCapture('annotate')} />
                      <AddStepButton label="Save to Disk" icon="save" onClick={() => addAfterCapture('save')} />
                      <AddStepButton label="Clipboard" icon="content_copy" onClick={() => addAfterCapture('clipboard')} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <AddStepButton label="+ Imgur" icon="image" onClick={() => addDestination('imgur')} />
                      <AddStepButton label="+ Custom URL" icon="api" onClick={() => addDestination('custom')} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <AddStepButton label="Copy URL" icon="link" onClick={() => addAfterUpload('copyUrl')} />
                      <AddStepButton label="Notify" icon="notifications" onClick={() => addAfterUpload('notify')} />
                      <AddStepButton label="Open URL" icon="open_in_new" onClick={() => addAfterUpload('openUrl')} />
                      <AddStepButton label="OS Share" icon="share" onClick={() => addAfterUpload('osShare')} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-600 flex-col gap-4">
            <span className="material-symbols-outlined text-5xl">rocket_launch</span>
            <p className="text-sm font-medium" style={{ fontFamily: 'Manrope, sans-serif' }}>Select a workflow to edit</p>
          </div>
        )}
      </div>
    </div>
  )
}

function PipelineStep({
  icon, label, active, onRemove, canMoveUp, canMoveDown, onMoveUp, onMoveDown
}: {
  icon: string; label: string; active: boolean
  onRemove?: () => void
  canMoveUp?: boolean; canMoveDown?: boolean
  onMoveUp?: () => void; onMoveDown?: () => void
}) {
  return (
    <div className={`flex items-center justify-between p-4 rounded-2xl mb-3 border transition-all group ${active ? 'bg-white/5 border-white/10' : 'bg-white/2 border-white/5 opacity-50'}`}>
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${active ? 'bg-secondary/10 text-secondary' : 'bg-white/5 text-slate-600'}`}>
          <span className="material-symbols-outlined text-sm">{icon}</span>
        </div>
        <span className="text-sm font-semibold text-slate-200" style={{ fontFamily: 'Manrope, sans-serif' }}>{label}</span>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
        {canMoveUp && (
          <button onClick={onMoveUp} className="p-1 text-slate-500 hover:text-white transition-colors" title="Move up">
            <span className="material-symbols-outlined text-sm">arrow_upward</span>
          </button>
        )}
        {canMoveDown && (
          <button onClick={onMoveDown} className="p-1 text-slate-500 hover:text-white transition-colors" title="Move down">
            <span className="material-symbols-outlined text-sm">arrow_downward</span>
          </button>
        )}
        {onRemove && (
          <button onClick={onRemove} className="p-1 text-slate-500 hover:text-red-400 transition-colors" title="Remove">
            <span className="material-symbols-outlined text-sm">remove_circle</span>
          </button>
        )}
      </div>
    </div>
  )
}

function AddStepButton({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-primary/30 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-all"
      style={{ fontFamily: 'Manrope, sans-serif' }}
    >
      <span className="material-symbols-outlined text-sm">{icon}</span>
      {label}
    </button>
  )
}
