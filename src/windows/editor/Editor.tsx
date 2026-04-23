import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AnnotationCanvas, {
  type CanvasHandle,
  Tool,
} from '../../components/AnnotationCanvas/Canvas'
import type { WorkflowTemplate, HistoryItem, AfterCaptureStep, UploadDestination, SensitiveRegion } from '../../types'
import { AutoBlurPanel } from '../../components/AutoBlurPanel'

interface ActionBtn {
  key: string
  icon: string
  label: string
  templateId: string
  destinationIndex?: number
  primary?: boolean
  actionType?: 'clipboard' | 'save'
}

const DEST_META: Record<string, { icon: string; label: string }> = {
  imgur:          { icon: 'link',         label: 'Imgur' },
  'google-drive': { icon: 'add_to_drive', label: 'Google Drive' },
  r2:            { icon: 'cloud_upload',  label: 'R2' },
  custom:        { icon: 'upload',        label: 'Upload' },
}

function deriveActions(tpl: WorkflowTemplate | undefined): ActionBtn[] {
  if (!tpl) return []
  const btns: ActionBtn[] = []
  for (const step of tpl.afterCapture) {
    if (step.type === 'clipboard') {
      btns.push({ key: 'clipboard', icon: 'content_paste', label: 'Copy', templateId: tpl.id, actionType: 'clipboard' })
    } else if (step.type === 'save') {
      btns.push({ key: 'save', icon: 'save', label: 'Save', templateId: tpl.id, actionType: 'save' })
    }
  }
  for (let i = 0; i < tpl.destinations.length; i++) {
    const dest = tpl.destinations[i]
    const meta = DEST_META[dest.type] ?? { icon: 'cloud_upload', label: dest.type }
    btns.push({
      key: `dest-${i}-${dest.type}`,
      icon: meta.icon,
      label: meta.label,
      templateId: tpl.id,
      destinationIndex: i,
      primary: true,
    })
  }
  return btns
}

type ToolGroup = 'draw' | 'shape' | 'select'

const TOOL_GROUPS: { group: ToolGroup; label: string; tools: { id: Tool; icon: string; label: string; key: string }[] }[] = [
  {
    group: 'draw',
    label: 'Draw',
    tools: [
      { id: 'pen',    icon: 'edit',       label: 'Pen',    key: 'P' },
      { id: 'blur',   icon: 'blur_on',    label: 'Blur',   key: 'B' },
      { id: 'text',   icon: 'title',      label: 'Text',   key: 'T' },
    ],
  },
  {
    group: 'shape',
    label: 'Shape',
    tools: [
      { id: 'rect',    icon: 'crop_square',   label: 'Rectangle', key: 'R' },
      { id: 'ellipse', icon: 'circle',        label: 'Ellipse',   key: 'E' },
      { id: 'arrow',   icon: 'north_east',    label: 'Arrow',     key: 'A' },
    ],
  },
  {
    group: 'select',
    label: 'Select',
    tools: [
      { id: 'select', icon: 'arrow_selector_tool', label: 'Select', key: 'V' },
    ],
  },
]

const ALL_TOOLS = TOOL_GROUPS.flatMap(g => g.tools)

const COLORS = [
  '#f87171', '#fb923c', '#fbbf24', '#34d399',
  '#60a5fa', '#a78bfa', '#f472b6', '#ffffff', '#000000',
]

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24) return `${hrs}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function Editor() {
  const location = useLocation()
  const navigate = useNavigate()
  const [imageDataUrl, setImageDataUrl] = useState<string>(
    (location.state as { dataUrl?: string })?.dataUrl ?? '',
  )
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#f87171')
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [exportTrigger, setExportTrigger] = useState(0)
  const [, setExportedDataUrl] = useState<string>('')
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [activeWorkflowId, setActiveWorkflowId] = useState<string>('')
  const [toast, setToast] = useState<{ message: string; icon: string; type: 'success' | 'error' } | null>(null)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const pendingAction = useRef<string | null>(null)
  const canvasRef = useRef<CanvasHandle>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [clipboardHistory, setClipboardHistory] = useState<
    { id: string; dataUrl: string; name: string; timestamp: number }[]
  >([])
  const [showClipPanel, setShowClipPanel] = useState(false)
  const [showAutoBlur, setShowAutoBlur] = useState(false)
  const [autoBlurScanning, setAutoBlurScanning] = useState(false)
  const [autoBlurRegions, setAutoBlurRegions] = useState<SensitiveRegion[]>([])
  const [autoBlurSelected, setAutoBlurSelected] = useState<Set<string>>(new Set())
  const [autoBlurOcrTime, setAutoBlurOcrTime] = useState<number>()
  const [, setAutoBlurDetectTime] = useState<number>()
  const [autoBlurHistory, setAutoBlurHistory] = useState<string[]>([])

  const resetForNewImage = useCallback((dataUrl: string) => {
    setImageDataUrl(dataUrl)
    setExportTrigger(0)
    canvasRef.current?.clear()
    setAutoBlurRegions([])
    setAutoBlurSelected(new Set())
    setAutoBlurHistory([])
    setAutoBlurScanning(false)
    setAutoBlurOcrTime(undefined)
    setAutoBlurDetectTime(undefined)
    setShowAutoBlur(false)
  }, [])

  const activeTemplate = useMemo(() => {
    const found = templates.find(t => t.id === activeWorkflowId)
    if (found) return found
    return templates.find(t => t.id === 'builtin-r2') ?? templates[0]
  }, [templates, activeWorkflowId])
  const actionBtns = useMemo(() => deriveActions(activeTemplate), [activeTemplate])

  useEffect(() => {
    const state = location.state as { dataUrl?: string } | null
    if (state?.dataUrl) resetForNewImage(state.dataUrl)
  }, [location.state])

  useEffect(() => {
    window.electronAPI?.onCaptureReady(({ dataUrl }) => { resetForNewImage(dataUrl) })
    Promise.all([
      window.electronAPI?.getTemplates(),
      window.electronAPI?.getSettings(),
    ]).then(([t, s]) => {
      if (t) setTemplates(t)
      if (s?.activeWorkflowId) setActiveWorkflowId(s.activeWorkflowId)
    })
    return () => { window.electronAPI?.removeAllListeners('capture:ready') }
  }, [])

  useEffect(() => {
    window.electronAPI?.getHistory().then((items: HistoryItem[]) => {
      setClipboardHistory(
        items
          .filter((i) => i.type === 'screenshot' && i.dataUrl)
          .slice(0, 20)
          .map((i) => ({ id: i.id, dataUrl: i.dataUrl!, name: i.name, timestamp: i.timestamp })),
      )
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); canvasRef.current?.zoomIn(); return }
        if (e.key === '-')                  { e.preventDefault(); canvasRef.current?.zoomOut(); return }
        if (e.key === '0')                  { e.preventDefault(); canvasRef.current?.zoomReset(); return }
      }
      const t = ALL_TOOLS.find(t => t.key?.toLowerCase() === e.key.toLowerCase())
      if (t) setTool(t.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const showToast = useCallback((message: string, icon: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, icon, type })
    setTimeout(() => setToast(null), 2500)
  }, [])

  const handleExport = useCallback((dataUrl: string) => {
    setExportedDataUrl(dataUrl)
    setExportTrigger(0)
    const pending = pendingAction.current
    pendingAction.current = null
    if (!pending) return
    const { key, templateId, destinationIndex, actionType } = JSON.parse(pending) as {
      key: string; templateId: string; destinationIndex?: number; actionType?: 'clipboard' | 'save'
    }
    setActionBusy(key)
    if (actionType) {
      window.electronAPI?.runInlineAction(actionType, dataUrl)
        .then(() => showToast(actionType === 'clipboard' ? 'Copied to clipboard' : 'Saved to file', 'check_circle'))
        .catch(() => showToast('Action failed', 'error', 'error'))
        .finally(() => setActionBusy(null))
      return
    }
    window.electronAPI?.runWorkflow(templateId, dataUrl, destinationIndex)
      .then((r) => {
        if (r?.uploads?.some(u => u.url))  showToast('Uploaded — link copied', 'check_circle')
        else if (r?.copiedToClipboard)     showToast('Copied to clipboard', 'check_circle')
        else if (r?.savedPath)             showToast('Saved to file', 'check_circle')
        else                               showToast('Done', 'check_circle')
      })
      .catch(() => showToast('Action failed', 'error', 'error'))
      .finally(() => setActionBusy(null))
  }, [showToast])

  const triggerAction = (key: string, templateId: string, destinationIndex?: number, actionType?: 'clipboard' | 'save') => {
    pendingAction.current = JSON.stringify({ key, templateId, destinationIndex, actionType })
    setExportTrigger((n) => n + 1)
  }

  const handleHistoryChange = useCallback((u: boolean, r: boolean) => {
    setCanUndo(u)
    setCanRedo(r)
  }, [])

  const handleAutoBlurScan = useCallback(async () => {
    if (!imageDataUrl || autoBlurScanning) return
    setAutoBlurScanning(true)
    setShowAutoBlur(true)
    try {
      const result = await window.electronAPI?.ocrScan(imageDataUrl)
      if (result) {
        setAutoBlurRegions(result.regions)
        setAutoBlurSelected(new Set(result.regions.map(r => r.id)))
        setAutoBlurOcrTime(result.ocrTimeMs)
        setAutoBlurDetectTime(result.detectTimeMs)
        if (result.regions.length === 0) showToast('No sensitive info detected', 'verified_user')
      }
    } catch {
      showToast('OCR scan failed', 'error', 'error')
    } finally {
      setAutoBlurScanning(false)
    }
  }, [imageDataUrl, autoBlurScanning, showToast])

  const handleApplyAutoBlur = useCallback(async () => {
    const selected = autoBlurRegions.filter(r => autoBlurSelected.has(r.id))
    if (selected.length === 0) return
    try {
      const blurred = await window.electronAPI?.ocrApplyBlur(imageDataUrl, selected, 10)
      if (blurred) {
        setAutoBlurHistory(prev => [...prev, imageDataUrl])
        setImageDataUrl(blurred)
        setAutoBlurRegions([])
        setAutoBlurSelected(new Set())
        showToast(`Blurred ${selected.length} region${selected.length > 1 ? 's' : ''}`, 'blur_on')
      }
    } catch {
      showToast('Failed to apply blur', 'error', 'error')
    }
  }, [autoBlurRegions, autoBlurSelected, imageDataUrl, showToast])

  const handleAutoBlurUndo = useCallback(() => {
    setAutoBlurHistory(prev => {
      if (prev.length === 0) return prev
      const next = [...prev]
      const restored = next.pop()!
      setImageDataUrl(restored)
      setAutoBlurRegions([])
      setAutoBlurSelected(new Set())
      showToast('Blur undone', 'undo')
      return next
    })
  }, [showToast])

  /* ── Empty state ── */
  if (!imageDataUrl) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-6">
        <div className="relative">
          <div className="absolute -inset-8 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative p-7 rounded-3xl bg-white/[0.03] border border-white/[0.06] shadow-2xl">
            <span className="material-symbols-outlined text-5xl text-slate-500" style={{ fontVariationSettings: "'FILL' 0, 'wght' 300" }}>
              photo_camera
            </span>
          </div>
        </div>
        <div className="text-center space-y-2">
          <p className="text-lg font-bold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>Ready to annotate</p>
          <p className="text-sm text-slate-500 max-w-[260px]">Capture your screen or pick a recent screenshot to start editing</p>
        </div>
        <div className="flex gap-3 mt-1">
          <button
            onClick={() => navigate('/dashboard')}
            className="px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            Dashboard
          </button>
          <button
            onClick={() => window.electronAPI?.captureScreenshot('region')}
            className="primary-gradient text-slate-900 font-bold px-5 py-2.5 rounded-xl text-sm hover:scale-[1.02] active:scale-95 transition-transform flex items-center gap-2"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            <span className="material-symbols-outlined text-base">screenshot_region</span>
            New Capture
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed top-12 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-2 px-4 py-2 backdrop-blur-xl border rounded-xl shadow-lg animate-slide-up ${
          toast.type === 'error' ? 'bg-red-500/20 border-red-500/30' : 'bg-emerald-500/20 border-emerald-500/30'
        }`}>
          <span className={`material-symbols-outlined text-sm ${toast.type === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>{toast.icon}</span>
          <span className="text-xs font-semibold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>{toast.message}</span>
        </div>
      )}

      {/* ── Top bar: title + actions ── */}
      <header className="h-10 liquid-glass flex items-center px-3 border-b border-white/5 flex-shrink-0 gap-2">
        {/* Back */}
        <button
          onClick={() => navigate('/dashboard')}
          className="h-7 w-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all flex-shrink-0"
          title="Back"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        </button>

        <div className="w-px h-5 bg-white/10" />

        {/* Zoom */}
        <div className="flex items-center gap-0.5">
          <TinyBtn icon="remove" title="Zoom out (Ctrl+-)" onClick={() => canvasRef.current?.zoomOut()} />
          <button
            onClick={() => canvasRef.current?.zoomReset()}
            className="h-7 px-2 rounded-lg text-[11px] font-bold text-slate-400 hover:text-white hover:bg-white/10 transition-all tabular-nums min-w-[44px] text-center"
            title="Reset zoom (Ctrl+0)"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            {Math.round(zoomLevel * 100)}%
          </button>
          <TinyBtn icon="add" title="Zoom in (Ctrl+=)" onClick={() => canvasRef.current?.zoomIn()} />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* New capture */}
        <button
          onClick={() => window.electronAPI?.captureScreenshot('region')}
          className="h-7 px-2.5 rounded-lg bg-white/5 hover:bg-white/10 flex items-center gap-1.5 text-slate-400 hover:text-white transition-all flex-shrink-0"
          title="New capture"
        >
          <span className="material-symbols-outlined text-[15px]">add_a_photo</span>
          <span className="text-[11px] font-semibold" style={{ fontFamily: 'Manrope, sans-serif' }}>New</span>
        </button>

        {/* Auto-blur */}
        <button
          onClick={() => { setShowAutoBlur(p => !p); if (!showAutoBlur && autoBlurRegions.length === 0) setShowAutoBlur(true) }}
          className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 transition-all flex-shrink-0 ${
            showAutoBlur ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-white/5 text-slate-400 hover:text-orange-400 hover:bg-orange-500/10'
          }`}
          title="Auto-blur sensitive info"
        >
          <span className="material-symbols-outlined text-[15px]">security</span>
          <span className="text-[11px] font-semibold" style={{ fontFamily: 'Manrope, sans-serif' }}>Blur</span>
        </button>

        {/* Recent captures */}
        <button
          onClick={() => setShowClipPanel(p => !p)}
          className={`h-7 w-7 rounded-lg flex items-center justify-center transition-all flex-shrink-0 ${
            showClipPanel ? 'bg-primary/20 text-primary' : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
          }`}
          title="Recent captures"
        >
          <span className="material-symbols-outlined text-[16px]">photo_library</span>
        </button>

        {actionBtns.length > 0 && <div className="w-px h-5 bg-white/10" />}

        {/* Action buttons */}
        {actionBtns.map((btn) => (
          <button
            key={btn.key}
            onClick={() => triggerAction(btn.key, btn.templateId, btn.destinationIndex, btn.actionType)}
            disabled={!!actionBusy}
            title={btn.label}
            className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 transition-all flex-shrink-0 disabled:opacity-40 text-[11px] font-semibold ${
              actionBusy === btn.key
                ? 'bg-primary/20 text-primary'
                : btn.primary
                  ? 'primary-gradient text-slate-900 hover:brightness-110'
                  : 'bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white'
            }`}
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            {actionBusy === btn.key
              ? <div className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
              : <span className="material-symbols-outlined text-[14px]">{btn.icon}</span>
            }
            {btn.label}
          </button>
        ))}
      </header>

      {/* ── Main area ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Canvas container ── */}
        <div
          className="flex-1 relative overflow-hidden"
          style={{ background: 'radial-gradient(circle at 30% 40%, rgba(15,23,42,0.9) 0%, #020617 100%)' }}
        >
          <div
            className="absolute inset-0 opacity-[0.025] pointer-events-none"
            style={{
              backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)`,
              backgroundSize: '24px 24px',
            }}
          />
          <AnnotationCanvas
            ref={canvasRef}
            key={imageDataUrl}
            imageDataUrl={imageDataUrl}
            tool={tool}
            color={color}
            strokeWidth={strokeWidth}
            onExport={handleExport}
            exportTrigger={exportTrigger}
            onHistoryChange={handleHistoryChange}
            onZoomChange={setZoomLevel}
          />
        </div>

        {/* ── Auto-blur panel ── */}
        {showAutoBlur && (
          <aside className="w-60 flex-shrink-0 glass-refractive border-l border-white/5 flex flex-col overflow-hidden">
            <AutoBlurPanel
              regions={autoBlurRegions}
              selectedIds={autoBlurSelected}
              scanning={autoBlurScanning}
              canUndo={autoBlurHistory.length > 0}
              ocrTimeMs={autoBlurOcrTime}
              onToggleRegion={(id) => setAutoBlurSelected(prev => {
                const next = new Set(prev)
                next.has(id) ? next.delete(id) : next.add(id)
                return next
              })}
              onSelectAll={() => setAutoBlurSelected(new Set(autoBlurRegions.map(r => r.id)))}
              onDeselectAll={() => setAutoBlurSelected(new Set())}
              onApplyBlur={handleApplyAutoBlur}
              onScan={handleAutoBlurScan}
              onUndo={handleAutoBlurUndo}
              onClose={() => setShowAutoBlur(false)}
            />
          </aside>
        )}

        {/* ── Clipboard history panel ── */}
        {showClipPanel && (
          <aside className="w-60 flex-shrink-0 glass-refractive border-l border-white/5 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-shrink-0">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Recent Captures
              </span>
              <button onClick={() => setShowClipPanel(false)} className="text-slate-500 hover:text-white transition-colors">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {clipboardHistory.length === 0 ? (
                <div className="flex flex-col items-center py-10 gap-3">
                  <span className="material-symbols-outlined text-2xl text-slate-700">collections</span>
                  <p className="text-xs text-slate-600 text-center px-4">Your recent captures will appear here</p>
                </div>
              ) : (
                clipboardHistory.map((item) => (
                  <div
                    key={item.id}
                    className={`group/clip flex items-center gap-2.5 p-2 rounded-xl cursor-pointer transition-all ${
                      item.dataUrl === imageDataUrl
                        ? 'bg-primary/10 border border-primary/20'
                        : 'bg-white/[0.02] hover:bg-white/[0.06] border border-transparent'
                    }`}
                    onClick={() => resetForNewImage(item.dataUrl)}
                  >
                    <img src={item.dataUrl} className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-white/10" draggable={false} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-slate-300 truncate font-medium">{item.name}</p>
                      <p className="text-[9px] text-slate-600 mt-0.5">{relativeTime(item.timestamp)}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        window.electronAPI?.runWorkflow('builtin-clipboard', item.dataUrl)
                        showToast('Copied to clipboard', 'check_circle')
                      }}
                      className="opacity-0 group-hover/clip:opacity-100 p-1.5 rounded-lg bg-white/10 hover:bg-primary/20 text-slate-400 hover:text-primary transition-all flex-shrink-0"
                      title="Copy to clipboard"
                    >
                      <span className="material-symbols-outlined text-xs">content_copy</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ── Bottom toolbar (Snipping Tool style) ── */}
      <div className="liquid-glass border-t border-white/5 flex-shrink-0 flex flex-col">

        {/* Tool groups */}
        <div className="flex items-stretch h-14 px-3 gap-1">

          {/* Tool group tabs */}
          {TOOL_GROUPS.map((group) => {
            const isGroupActive = group.tools.some(t => t.id === tool)
            return (
              <div key={group.group} className="flex items-center">
                {/* Group label */}
                <div className={`flex items-center gap-0.5 rounded-xl p-1 ${isGroupActive ? 'bg-white/[0.06]' : ''}`}>
                  {group.tools.map(({ id, icon, label, key }) => (
                    <button
                      key={id}
                      title={`${label} (${key})`}
                      onClick={() => setTool(id)}
                      className={`relative flex flex-col items-center justify-center gap-0.5 w-12 h-10 rounded-lg transition-all ${
                        tool === id
                          ? 'bg-primary/20 text-primary shadow-[0_0_12px_rgba(182,160,255,0.15)]'
                          : 'text-slate-400 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">{icon}</span>
                      <span className="text-[9px] font-medium leading-none" style={{ fontFamily: 'Manrope, sans-serif' }}>{label}</span>
                      {tool === id && (
                        <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
                      )}
                    </button>
                  ))}
                </div>
                <div className="w-px h-8 bg-white/[0.06] mx-1" />
              </div>
            )
          })}

          {/* Color swatches */}
          <div className="flex items-center gap-1 px-1">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="relative flex-shrink-0 transition-all hover:scale-110"
                title={c}
              >
                <div
                  className={`w-5 h-5 rounded-full border-2 transition-all ${
                    color === c ? 'border-white scale-125 shadow-[0_0_8px_rgba(255,255,255,0.3)]' : 'border-transparent hover:border-white/30'
                  }`}
                  style={{ background: c }}
                />
              </button>
            ))}
            {/* Custom color */}
            <label className="relative w-5 h-5 flex-shrink-0 cursor-pointer group" title="Custom color">
              <div className="w-5 h-5 rounded-full border-2 border-dashed border-white/20 group-hover:border-white/50 transition-colors flex items-center justify-center overflow-hidden">
                <div className="w-full h-full rounded-full" style={{ background: `conic-gradient(red, yellow, lime, cyan, blue, magenta, red)` }} />
              </div>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
            </label>
          </div>

          <div className="w-px h-8 bg-white/[0.06] self-center" />

          {/* Stroke width */}
          <div className="flex items-center gap-2 px-2">
            <div className="flex items-center gap-1">
              {[2, 4, 8].map((w) => (
                <button
                  key={w}
                  onClick={() => setStrokeWidth(w)}
                  className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all ${
                    strokeWidth === w ? 'bg-primary/20 text-primary' : 'text-slate-500 hover:text-white hover:bg-white/10'
                  }`}
                  title={`Stroke ${w}px`}
                >
                  <div
                    className="rounded-full flex-shrink-0"
                    style={{ background: 'currentColor', width: w + 4, height: w + 4 }}
                  />
                </button>
              ))}
            </div>
            <input
              type="range"
              min={1}
              max={20}
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
              className="w-20 accent-primary h-1"
            />
            <span className="text-[10px] text-slate-500 font-mono w-5 tabular-nums">{strokeWidth}</span>
          </div>

          <div className="w-px h-8 bg-white/[0.06] self-center" />

          {/* Undo / Redo / Clear */}
          <div className="flex items-center gap-0.5 px-1">
            <BottomBtn icon="undo" label="Undo" disabled={!canUndo} onClick={() => canvasRef.current?.undo()} />
            <BottomBtn icon="redo" label="Redo" disabled={!canRedo} onClick={() => canvasRef.current?.redo()} />
            <BottomBtn icon="delete_sweep" label="Clear" onClick={() => canvasRef.current?.clear()} variant="danger" />
          </div>

        </div>
      </div>

    </div>
  )
}

/* ── Tiny icon button (top bar) ── */
function TinyBtn({ icon, title, onClick, disabled }: { icon: string; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all disabled:opacity-25 disabled:cursor-not-allowed"
    >
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
    </button>
  )
}

/* ── Bottom toolbar button ── */
function BottomBtn({ icon, label, disabled, onClick, variant }: {
  icon: string; label: string; disabled?: boolean; onClick: () => void; variant?: 'danger'
}) {
  return (
    <button
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-0.5 w-10 h-10 rounded-lg transition-all disabled:opacity-25 disabled:cursor-not-allowed ${
        variant === 'danger'
          ? 'text-slate-500 hover:text-red-400 hover:bg-red-400/10'
          : 'text-slate-500 hover:text-white hover:bg-white/10'
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      <span className="text-[9px] font-medium leading-none" style={{ fontFamily: 'Manrope, sans-serif' }}>{label}</span>
    </button>
  )
}
