import { useState, useEffect } from 'react'
import type { WorkflowTemplate, UploadDestination, AfterCaptureStep, AfterUploadStep } from '../../types'
import { v4 as uuidv4 } from 'uuid'

const STEP_META: Record<string, { icon: string; label: string; color: string }> = {
  annotate:  { icon: 'draw',          label: 'Annotate',           color: 'primary' },
  save:      { icon: 'save',          label: 'Save to Disk',       color: 'primary' },
  clipboard: { icon: 'content_copy',  label: 'Copy to Clipboard',  color: 'primary' },
  imgur:     { icon: 'cloud_upload',   label: 'Imgur',              color: 'secondary' },
  custom:    { icon: 'api',           label: 'Custom Endpoint',    color: 'secondary' },
  copyUrl:   { icon: 'link',          label: 'Copy URL',           color: 'tertiary' },
  notify:    { icon: 'notifications', label: 'Notification',       color: 'tertiary' },
  openUrl:   { icon: 'open_in_new',   label: 'Open URL',           color: 'tertiary' },
  osShare:   { icon: 'share',         label: 'OS Share',           color: 'tertiary' },
}

const PHASE_CONFIG = [
  { key: 'afterCapture',  title: 'After Capture',      accent: 'primary',   icon: 'auto_fix_high', num: '1' },
  { key: 'destinations',  title: 'Upload Destinations', accent: 'secondary', icon: 'cloud_upload',  num: '2' },
  { key: 'afterUpload',   title: 'After Upload',        accent: 'tertiary',  icon: 'task_alt',      num: '3' },
] as const

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
      icon: 'bolt',
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
    const step: AfterCaptureStep = type === 'save' ? { type: 'save', path: '' } : { type }
    setSelected({ ...selected, afterCapture: [...selected.afterCapture, step] })
  }

  const moveStep = (field: 'afterCapture' | 'destinations' | 'afterUpload', from: number, to: number) => {
    if (!selected) return
    const next = [...selected[field]] as unknown[]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setSelected({ ...selected, [field]: next })
  }

  const removeStep = (field: 'afterCapture' | 'afterUpload', idx: number) => {
    if (!selected) return
    setSelected({ ...selected, [field]: (selected[field] as unknown[]).filter((_, i) => i !== idx) })
  }

  const addAfterUpload = (type: AfterUploadStep['type']) => {
    if (!selected) return
    const step: AfterUploadStep = type === 'copyUrl' ? { type: 'copyUrl', which: 'first' } : { type }
    setSelected({ ...selected, afterUpload: [...selected.afterUpload, step] })
  }

  /* ── helpers for phase rendering ── */
  const getPhaseSteps = (phase: typeof PHASE_CONFIG[number]) => {
    if (!selected) return []
    if (phase.key === 'afterCapture') return selected.afterCapture.map((s, i) => ({ ...s, _idx: i }))
    if (phase.key === 'destinations') return selected.destinations.map((s, i) => ({ ...s, _idx: i }))
    return selected.afterUpload.map((s, i) => ({ ...s, _idx: i }))
  }

  const accentClass = (accent: string, part: 'text' | 'bg' | 'border') => {
    const map: Record<string, Record<string, string>> = {
      primary:   { text: 'text-primary',   bg: 'bg-primary/10',   border: 'border-primary/20' },
      secondary: { text: 'text-secondary', bg: 'bg-secondary/10', border: 'border-secondary/20' },
      tertiary:  { text: 'text-tertiary',  bg: 'bg-tertiary/10',  border: 'border-tertiary/20' },
    }
    return map[accent]?.[part] ?? ''
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-14 liquid-glass flex items-center justify-between px-6 flex-shrink-0 border-b border-white/5">
        <div>
          <h2 className="text-sm font-bold text-white leading-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>Destinations & Automation</h2>
          <p className="text-[11px] text-slate-500 leading-tight">Define where your captures go and what happens next</p>
        </div>
        <div className="flex items-center gap-3">
          {activeId && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/10 border border-secondary/20 rounded-lg">
              <span className="material-symbols-outlined text-secondary text-xs">star</span>
              <span className="text-[11px] font-semibold text-secondary" style={{ fontFamily: 'Manrope, sans-serif' }}>
                {templates.find(t => t.id === activeId)?.name ?? 'Default'}
              </span>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: Workflow list ── */}
        <div className="w-64 flex-shrink-0 border-r border-white/5 flex flex-col">
          <div className="flex items-center justify-between px-5 py-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500" style={{ fontFamily: 'Manrope, sans-serif' }}>Workflows</span>
            <button
              onClick={handleNewTemplate}
              className="w-6 h-6 rounded-lg bg-white/5 hover:bg-primary/10 flex items-center justify-center text-slate-400 hover:text-primary transition-all"
              title="New workflow"
            >
              <span className="material-symbols-outlined text-sm">add</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
            {templates.map(t => {
              const isActive = activeId === t.id
              const isSel = selected?.id === t.id
              return (
                <div
                  key={t.id}
                  onClick={() => handleSelect(t)}
                  className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
                    isSel
                      ? 'active-nav-bg border border-primary/20'
                      : 'border border-transparent hover:bg-white/[0.04] hover:border-white/5'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isSel ? 'bg-primary/15 text-primary' : 'bg-white/5 text-slate-400'
                  }`}>
                    <span className="material-symbols-outlined text-base">{t.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-semibold text-white truncate" style={{ fontFamily: 'Manrope, sans-serif' }}>{t.name}</p>
                      {isActive && (
                        <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-secondary" title="Active workflow" />
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {t.destinations.length} dest · {t.afterCapture.length + t.afterUpload.length} steps
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={e => { e.stopPropagation(); handleSetActive(t.id) }}
                      className={`p-1 rounded-md transition-all ${isActive ? 'text-secondary' : 'text-slate-600 hover:text-secondary hover:bg-secondary/10'}`}
                      title={isActive ? 'Default workflow' : 'Set as default'}
                    >
                      <span className="material-symbols-outlined text-sm">{isActive ? 'star' : 'star_outline'}</span>
                    </button>
                    {!t.builtIn && (
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(t.id) }}
                        className="p-1 rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
                      >
                        <span className="material-symbols-outlined text-sm">delete</span>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}

            {templates.length === 0 && (
              <div className="text-center py-8">
                <span className="material-symbols-outlined text-2xl text-slate-700">inbox</span>
                <p className="text-[11px] text-slate-600 mt-2">No workflows yet</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Pipeline editor ── */}
        {selected ? (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Template name + actions */}
            <div className="flex items-center gap-4">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                activeId === selected.id ? 'bg-secondary/15 text-secondary' : 'bg-white/5 text-slate-400'
              } border border-white/10`}>
                <span className="material-symbols-outlined text-lg">{selected.icon}</span>
              </div>
              <input
                value={selected.name}
                onChange={e => setSelected({ ...selected, name: e.target.value })}
                className="flex-1 bg-transparent text-white text-base font-bold focus:outline-none border-b border-transparent focus:border-primary/30 pb-0.5 transition-colors"
                style={{ fontFamily: 'Manrope, sans-serif' }}
                disabled={selected.builtIn}
              />
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleSetActive(selected.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                    activeId === selected.id
                      ? 'bg-secondary/15 text-secondary border border-secondary/25'
                      : 'bg-white/5 text-slate-500 hover:text-secondary hover:bg-secondary/10 border border-white/10'
                  }`}
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  <span className="material-symbols-outlined text-xs">{activeId === selected.id ? 'star' : 'star_outline'}</span>
                  {activeId === selected.id ? 'Active' : 'Set Active'}
                </button>
                {!selected.builtIn && (
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="primary-gradient text-slate-900 font-bold px-4 py-1.5 rounded-lg text-[11px] flex items-center gap-1.5 hover:scale-[1.02] transition-transform disabled:opacity-50"
                    style={{ fontFamily: 'Manrope, sans-serif' }}
                  >
                    <span className="material-symbols-outlined text-xs">save</span>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                )}
              </div>
            </div>

            {/* ── 3 Phase Pipeline ── */}
            {PHASE_CONFIG.map((phase) => {
              const steps = getPhaseSteps(phase)
              const field = phase.key
              return (
                <div key={phase.key} className="glass-refractive rounded-2xl overflow-hidden">
                  {/* Phase header */}
                  <div className={`flex items-center gap-3 px-4 py-3 border-b border-white/5`}>
                    <div className={`w-6 h-6 rounded-md ${accentClass(phase.accent, 'bg')} flex items-center justify-center`}>
                      <span className={`material-symbols-outlined text-xs ${accentClass(phase.accent, 'text')}`}>{phase.icon}</span>
                    </div>
                    <div className="flex-1">
                      <span className="text-[11px] font-bold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>{phase.title}</span>
                      <span className="text-[10px] text-slate-600 ml-2">
                        {steps.length === 0 ? 'No steps' : `${steps.length} step${steps.length > 1 ? 's' : ''}`}
                      </span>
                    </div>
                    <span className={`text-[10px] font-black ${accentClass(phase.accent, 'text')} opacity-40`}>{phase.num}</span>
                  </div>

                  {/* Steps */}
                  <div className="p-3 space-y-1.5">
                    {steps.length === 0 && (
                      <div className="text-center py-3">
                        <p className="text-[10px] text-slate-600">No steps configured</p>
                      </div>
                    )}

                    {steps.map((step, i) => {
                      const meta = STEP_META[step.type] ?? { icon: 'help', label: step.type, color: phase.accent }
                      return (
                        <div key={i}>
                          <div className="group flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5 hover:border-white/10 transition-all">
                            <div className={`w-6 h-6 rounded-md ${accentClass(meta.color, 'bg')} flex items-center justify-center flex-shrink-0`}>
                              <span className={`material-symbols-outlined text-xs ${accentClass(meta.color, 'text')}`}>{meta.icon}</span>
                            </div>
                            <span className="text-xs font-medium text-slate-300 flex-1" style={{ fontFamily: 'Manrope, sans-serif' }}>
                              {field === 'destinations' && step.type === 'imgur' ? 'Upload to Imgur' :
                               field === 'destinations' && step.type === 'custom' ? `Upload to ${(step as { url?: string }).url || 'Custom'}` :
                               meta.label}
                            </span>
                            {!selected.builtIn && (
                              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                {i > 0 && (
                                  <button onClick={() => moveStep(field, i, i - 1)} className="p-0.5 text-slate-600 hover:text-white rounded transition-colors">
                                    <span className="material-symbols-outlined text-xs">arrow_upward</span>
                                  </button>
                                )}
                                {i < steps.length - 1 && (
                                  <button onClick={() => moveStep(field, i, i + 1)} className="p-0.5 text-slate-600 hover:text-white rounded transition-colors">
                                    <span className="material-symbols-outlined text-xs">arrow_downward</span>
                                  </button>
                                )}
                                <button
                                  onClick={() => field === 'destinations' ? removeDestination(i) : removeStep(field as 'afterCapture' | 'afterUpload', i)}
                                  className="p-0.5 text-slate-600 hover:text-red-400 rounded transition-colors"
                                >
                                  <span className="material-symbols-outlined text-xs">close</span>
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Inline config for destinations */}
                          {field === 'destinations' && step.type === 'imgur' && !selected.builtIn && (
                            <div className="ml-9 mt-1.5 mb-1">
                              <input
                                value={(step as { clientId?: string }).clientId ?? ''}
                                onChange={e => updateDestination(i, { clientId: e.target.value } as Partial<UploadDestination>)}
                                placeholder="Imgur Client ID (optional — uses built-in key)"
                                className="w-full bg-white/[0.03] border border-white/5 rounded-lg px-3 py-1.5 text-[11px] text-white placeholder-slate-600 focus:outline-none focus:border-primary/30 transition-colors"
                              />
                            </div>
                          )}
                          {field === 'destinations' && step.type === 'custom' && !selected.builtIn && (
                            <div className="ml-9 mt-1.5 mb-1">
                              <input
                                value={(step as { url?: string }).url ?? ''}
                                onChange={e => updateDestination(i, { url: e.target.value } as Partial<UploadDestination>)}
                                placeholder="https://your-server.com/upload"
                                className="w-full bg-white/[0.03] border border-white/5 rounded-lg px-3 py-1.5 text-[11px] text-white placeholder-slate-600 focus:outline-none focus:border-primary/30 transition-colors"
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Add step buttons — inline per phase */}
                    {!selected.builtIn && (
                      <div className="flex flex-wrap gap-1.5 pt-1.5">
                        {field === 'afterCapture' && (
                          <>
                            <AddChip label="Annotate" icon="draw" accent={phase.accent} onClick={() => addAfterCapture('annotate')} />
                            <AddChip label="Save" icon="save" accent={phase.accent} onClick={() => addAfterCapture('save')} />
                            <AddChip label="Clipboard" icon="content_copy" accent={phase.accent} onClick={() => addAfterCapture('clipboard')} />
                          </>
                        )}
                        {field === 'destinations' && (
                          <>
                            <AddChip label="Imgur" icon="cloud_upload" accent={phase.accent} onClick={() => addDestination('imgur')} />
                            <AddChip label="Custom URL" icon="api" accent={phase.accent} onClick={() => addDestination('custom')} />
                          </>
                        )}
                        {field === 'afterUpload' && (
                          <>
                            <AddChip label="Copy URL" icon="link" accent={phase.accent} onClick={() => addAfterUpload('copyUrl')} />
                            <AddChip label="Notify" icon="notifications" accent={phase.accent} onClick={() => addAfterUpload('notify')} />
                            <AddChip label="Open URL" icon="open_in_new" accent={phase.accent} onClick={() => addAfterUpload('openUrl')} />
                            <AddChip label="Share" icon="share" accent={phase.accent} onClick={() => addAfterUpload('osShare')} />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          /* ── Empty state ── */
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 max-w-[240px] text-center">
              <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-center">
                <span className="material-symbols-outlined text-3xl text-slate-600">rocket_launch</span>
              </div>
              <p className="text-sm font-bold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>Select a workflow</p>
              <p className="text-[11px] text-slate-500 leading-relaxed">Choose from the list or create a new one to configure its pipeline</p>
              <button
                onClick={handleNewTemplate}
                className="mt-1 flex items-center gap-1.5 px-3.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-primary/30 rounded-lg text-[11px] font-semibold text-slate-400 hover:text-white transition-all"
                style={{ fontFamily: 'Manrope, sans-serif' }}
              >
                <span className="material-symbols-outlined text-sm">add</span>
                New Workflow
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Add-step chip ── */
function AddChip({ label, icon, accent, onClick }: { label: string; icon: string; accent: string; onClick: () => void }) {
  const colorMap: Record<string, string> = {
    primary:   'hover:border-primary/30 hover:text-primary',
    secondary: 'hover:border-secondary/30 hover:text-secondary',
    tertiary:  'hover:border-tertiary/30 hover:text-tertiary',
  }
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 border border-dashed border-white/10 rounded-lg text-[10px] font-medium text-slate-500 transition-all ${colorMap[accent] ?? ''}`}
      style={{ fontFamily: 'Manrope, sans-serif' }}
    >
      <span className="material-symbols-outlined text-xs">{icon}</span>
      {label}
    </button>
  )
}
