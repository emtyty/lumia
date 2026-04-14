import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AnnotationCanvas, {
  type CanvasHandle,
  Tool,
} from '../../components/AnnotationCanvas/Canvas'
import ShareDialog from '../../components/ShareDialog'
import { WorkflowSelector } from '../../components/WorkflowSelector'
import type { WorkflowTemplate, HistoryItem } from '../../types'

const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: 'select',  icon: 'arrow_selector_tool', label: 'Select',    key: 'V' },
  { id: 'pen',     icon: 'draw',                label: 'Pen',       key: 'P' },
  { id: 'rect',    icon: 'rectangle',           label: 'Rectangle', key: 'R' },
  { id: 'ellipse', icon: 'circle',              label: 'Ellipse',   key: 'E' },
  { id: 'arrow',   icon: 'north_east',          label: 'Arrow',     key: 'A' },
  { id: 'text',    icon: 'text_fields',         label: 'Text',      key: 'T' },
  { id: 'blur',    icon: 'blur_on',             label: 'Blur',      key: 'B' },
]

const COLORS = [
  '#b6a0ff', '#00e3fd', '#ff6c95', '#fbbf24',
  '#34d399', '#f87171', '#ffffff', '#000000',
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
  const [color, setColor] = useState('#b6a0ff')
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [exportTrigger, setExportTrigger] = useState(0)
  const [exportedDataUrl, setExportedDataUrl] = useState<string>('')
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [shareAction, setShareAction] = useState<'workflow' | 'direct'>('direct')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [copyToast, setCopyToast] = useState(false)
  const canvasRef = useRef<CanvasHandle>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [clipboardHistory, setClipboardHistory] = useState<
    { id: string; dataUrl: string; name: string; timestamp: number }[]
  >([])
  const [showClipPanel, setShowClipPanel] = useState(false)

  useEffect(() => {
    const state = location.state as { dataUrl?: string } | null
    if (state?.dataUrl) {
      setImageDataUrl(state.dataUrl)
      setExportTrigger(0)
    }
  }, [location.state])

  useEffect(() => {
    window.electronAPI?.onCaptureReady(({ dataUrl }) => { setExportTrigger(0); setImageDataUrl(dataUrl) })
    Promise.all([
      window.electronAPI?.getTemplates(),
      window.electronAPI?.getSettings(),
    ]).then(([t, s]) => {
      if (!t) return
      setTemplates(t)
      const activeId = s?.activeWorkflowId
      const defaultId = (activeId && t.find(x => x.id === activeId)) ? activeId : t[0]?.id
      if (defaultId) setSelectedTemplateId(defaultId)
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

  // Keyboard shortcuts for tools + zoom
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      // Zoom: Ctrl/Cmd + / - / 0
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); canvasRef.current?.zoomIn(); return }
        if (e.key === '-')                  { e.preventDefault(); canvasRef.current?.zoomOut(); return }
        if (e.key === '0')                  { e.preventDefault(); canvasRef.current?.zoomReset(); return }
      }

      const t = TOOLS.find(t => t.key?.toLowerCase() === e.key.toLowerCase())
      if (t) setTool(t.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleExport = useCallback((dataUrl: string) => {
    setExportedDataUrl(dataUrl)
    setShowShareDialog(true)
    setExportTrigger(0)
  }, [])

  const triggerExport = () => setExportTrigger((n) => n + 1)

  const handleHistoryChange = useCallback((u: boolean, r: boolean) => {
    setCanUndo(u)
    setCanRedo(r)
  }, [])

  /* ── Empty state ── */
  if (!imageDataUrl) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-6">
        {/* Decorative gradient orb */}
        <div className="relative">
          <div className="absolute -inset-8 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative p-7 rounded-3xl bg-white/[0.03] border border-white/[0.06] shadow-2xl">
            <span className="material-symbols-outlined text-5xl text-slate-500" style={{ fontVariationSettings: "'FILL' 0, 'wght' 300" }}>
              photo_camera
            </span>
          </div>
        </div>
        <div className="text-center space-y-2">
          <p className="text-lg font-bold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Ready to annotate
          </p>
          <p className="text-sm text-slate-500 max-w-[260px]">
            Capture your screen or pick a recent screenshot to start editing
          </p>
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
      {copyToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-2 px-4 py-2.5 bg-secondary/20 backdrop-blur-xl border border-secondary/30 rounded-xl shadow-lg animate-slide-up">
          <span className="material-symbols-outlined text-secondary text-sm">check_circle</span>
          <span className="text-xs font-semibold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>Copied to clipboard</span>
        </div>
      )}

      {/* ── Toolbar Header ── */}
      <header className="h-11 liquid-glass flex items-center px-2.5 border-b border-white/5 flex-shrink-0 gap-1.5">
        {/* Back */}
        <button
          onClick={() => navigate('/dashboard')}
          className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all flex-shrink-0"
          title="Back to Dashboard"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        </button>

        <div className="w-px h-5 bg-white/10" />

        {/* Tools */}
        <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-xl p-0.5 border border-white/5">
          {TOOLS.map(({ id, icon, label, key }) => (
            <button
              key={id}
              title={`${label} (${key})`}
              onClick={() => setTool(id)}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                tool === id
                  ? 'bg-primary/20 text-primary shadow-[0_0_10px_rgba(182,160,255,0.15)]'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{icon}</span>
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-white/10" />

        {/* Colors */}
        <div className="flex items-center gap-1 px-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-5 h-5 rounded-full transition-all hover:scale-110 flex-shrink-0 border-2 ${
                color === c
                  ? 'border-white scale-110 shadow-[0_0_6px_rgba(255,255,255,0.2)]'
                  : 'border-transparent hover:border-white/30'
              }`}
              style={{ background: c }}
            />
          ))}
          {/* Custom color */}
          <label className="relative w-5 h-5 flex-shrink-0 cursor-pointer group">
            <div
              className="w-5 h-5 rounded-full border-2 border-dashed border-white/20 group-hover:border-white/40 transition-colors flex items-center justify-center"
            >
              <span className="material-symbols-outlined text-[11px] text-slate-500 group-hover:text-slate-300">colorize</span>
            </div>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
          </label>
        </div>

        <div className="w-px h-5 bg-white/10" />

        {/* Stroke width */}
        <div className="flex items-center gap-1.5 px-1">
          <div
            className="rounded-full flex-shrink-0"
            style={{
              background: color,
              width: Math.max(4, Math.min(strokeWidth, 12)),
              height: Math.max(4, Math.min(strokeWidth, 12)),
            }}
          />
          <input
            type="range"
            min={1}
            max={20}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            className="w-16 accent-primary h-1"
          />
          <span className="text-[10px] text-slate-500 font-mono w-4 text-right flex-shrink-0 tabular-nums">
            {strokeWidth}
          </span>
        </div>

        <div className="w-px h-5 bg-white/10" />

        {/* Undo / Redo / Clear */}
        <div className="flex items-center gap-0.5">
          <HeaderBtn icon="undo" label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => canvasRef.current?.undo()} />
          <HeaderBtn icon="redo" label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => canvasRef.current?.redo()} />
          <HeaderBtn icon="delete_sweep" label="Clear all" onClick={() => canvasRef.current?.clear()} variant="danger" />
        </div>

        <div className="w-px h-5 bg-white/10" />

        {/* Zoom controls */}
        <div className="flex items-center gap-0.5">
          <HeaderBtn icon="remove" label="Zoom out (Ctrl+-)" onClick={() => canvasRef.current?.zoomOut()} />
          <button
            onClick={() => canvasRef.current?.zoomReset()}
            className="h-7 px-1.5 rounded-lg text-[10px] font-bold text-slate-400 hover:text-white hover:bg-white/10 transition-all tabular-nums"
            title="Reset zoom (Ctrl+0)"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            {Math.round(zoomLevel * 100)}%
          </button>
          <HeaderBtn icon="add" label="Zoom in (Ctrl+=)" onClick={() => canvasRef.current?.zoomIn()} />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side actions */}
        <button
          onClick={() => window.electronAPI?.captureScreenshot('region')}
          className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-secondary transition-all flex-shrink-0"
          title="New capture"
        >
          <span className="material-symbols-outlined text-[16px]">screenshot_region</span>
        </button>

        <button
          onClick={() => setShowClipPanel(p => !p)}
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all flex-shrink-0 ${
            showClipPanel
              ? 'bg-primary/20 text-primary'
              : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
          }`}
          title="Recent captures"
        >
          <span className="material-symbols-outlined text-[16px]">photo_library</span>
        </button>

        {/* Workflow selector */}
        <WorkflowSelector
          templates={templates}
          selectedId={selectedTemplateId}
          onSelect={setSelectedTemplateId}
        />

        {/* Run button */}
        <button
          onClick={() => { triggerExport(); setShareAction('workflow') }}
          className="flex items-center gap-1.5 h-8 px-3.5 primary-gradient rounded-xl text-slate-900 font-bold text-[12px] hover:brightness-110 active:scale-95 transition-all shadow-[0_0_14px_rgba(182,160,255,0.25)] flex-shrink-0"
          title="Run workflow"
          style={{ fontFamily: 'Manrope, sans-serif' }}
        >
          <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
          Run
        </button>
      </header>

      {/* ── Main area: canvas + clip panel ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Canvas container ── */}
        <div
          className="flex-1 relative overflow-hidden"
          style={{
            background: 'radial-gradient(circle at 30% 40%, rgba(15, 23, 42, 0.8) 0%, #020617 100%)',
          }}
        >
          {/* Subtle grid pattern */}
          <div
            className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{
              backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)`,
              backgroundSize: '24px 24px',
            }}
          />

          {/* Canvas */}
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

        {/* ── Clipboard history panel ── */}
        {showClipPanel && (
          <aside className="w-60 flex-shrink-0 glass-refractive border-l border-white/5 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-shrink-0">
              <span
                className="text-[10px] font-bold uppercase tracking-widest text-slate-500"
                style={{ fontFamily: 'Manrope, sans-serif' }}
              >
                Recent Captures
              </span>
              <button
                onClick={() => setShowClipPanel(false)}
                className="text-slate-500 hover:text-white transition-colors"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {clipboardHistory.length === 0 ? (
                <div className="flex flex-col items-center py-10 gap-3">
                  <span className="material-symbols-outlined text-2xl text-slate-700">collections</span>
                  <p className="text-xs text-slate-600 text-center px-4">
                    Your recent captures will appear here
                  </p>
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
                    onClick={() => { setExportTrigger(0); setImageDataUrl(item.dataUrl) }}
                  >
                    <img
                      src={item.dataUrl}
                      className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-white/10"
                      draggable={false}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-slate-300 truncate font-medium">{item.name}</p>
                      <p className="text-[9px] text-slate-600 mt-0.5">{relativeTime(item.timestamp)}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        window.electronAPI?.runWorkflow('builtin-clipboard', item.dataUrl)
                        setCopyToast(true)
                        setTimeout(() => setCopyToast(false), 2000)
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

      {/* ── Share dialog ── */}
      {showShareDialog && exportedDataUrl && (
        <ShareDialog
          imageDataUrl={exportedDataUrl}
          templateId={shareAction === 'workflow' ? selectedTemplateId : undefined}
          onClose={() => setShowShareDialog(false)}
        />
      )}
    </div>
  )
}

/* ── Header icon button ── */

function HeaderBtn({
  icon, label, disabled, onClick, variant,
}: {
  icon: string
  label: string
  disabled?: boolean
  onClick: () => void
  variant?: 'danger'
}) {
  return (
    <button
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-25 disabled:cursor-not-allowed ${
        variant === 'danger'
          ? 'text-slate-400 hover:text-red-400 hover:bg-red-400/10'
          : 'text-slate-400 hover:text-white hover:bg-white/10'
      }`}
    >
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
    </button>
  )
}
