import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AnnotationCanvas, {
  type CanvasHandle,
  Tool,
} from '../../components/AnnotationCanvas/Canvas'
import ShareDialog from '../../components/ShareDialog'
import { WorkflowSelector } from '../../components/WorkflowSelector'
import type { WorkflowTemplate, HistoryItem } from '../../types'

const TOOLS: { id: Tool; icon: string; label: string; key?: string }[] = [
  { id: 'select',  icon: 'arrow_selector_tool', label: 'Select',    key: 'V' },
  { id: 'pen',     icon: 'draw',                label: 'Pen',       key: 'P' },
  { id: 'rect',    icon: 'rectangle',           label: 'Rectangle', key: 'R' },
  { id: 'ellipse', icon: 'circle',              label: 'Ellipse',   key: 'E' },
  { id: 'arrow',   icon: 'arrow_forward',       label: 'Arrow',     key: 'A' },
  { id: 'text',    icon: 'text_fields',         label: 'Text',      key: 'T' },
  { id: 'blur',    icon: 'blur_on',             label: 'Blur',      key: 'B' },
]

const COLORS = [
  '#b6a0ff', '#00e3fd', '#ff6c95', '#ffffff',
  '#fbbf24', '#34d399', '#f87171', '#000000',
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
    window.electronAPI?.getTemplates().then((t) => {
      setTemplates(t)
      if (t.length > 0) setSelectedTemplateId(t[0].id)
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

  // Keyboard shortcuts for tools
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const t = TOOLS.find(t => t.key?.toLowerCase() === e.key.toLowerCase())
      if (t) setTool(t.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleExport = useCallback(async (dataUrl: string) => {
    setExportedDataUrl(dataUrl)
    try {
      await window.electronAPI?.runWorkflow('builtin-clipboard', dataUrl)
      setCopyToast(true)
      setTimeout(() => setCopyToast(false), 2000)
    } catch { /* silent */ }
    setShowShareDialog(true)
  }, [])

  const triggerExport = () => setExportTrigger((n) => n + 1)

  const handleHistoryChange = useCallback((u: boolean, r: boolean) => {
    setCanUndo(u)
    setCanRedo(r)
  }, [])

  /* ── Empty state ── */
  if (!imageDataUrl) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5">
        <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/5">
          <span className="material-symbols-outlined text-5xl text-slate-600">add_a_photo</span>
        </div>
        <div className="text-center">
          <p className="text-base font-bold text-white mb-1" style={{ fontFamily: 'Manrope, sans-serif' }}>
            No capture loaded
          </p>
          <p className="text-xs text-slate-500">Take a screenshot or select one from history</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/dashboard')}
            className="px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            Dashboard
          </button>
          <button
            onClick={() => window.electronAPI?.captureScreenshot('region')}
            className="primary-gradient text-slate-900 font-bold px-5 py-2.5 rounded-xl text-sm hover:scale-[1.02] active:scale-95 transition-transform"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
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

      {/* ── Header / Toolbar ── */}
      <header className="h-12 liquid-glass flex items-center px-3 border-b border-white/5 flex-shrink-0 gap-2">
        {/* Back */}
        <button
          onClick={() => navigate('/dashboard')}
          className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all flex-shrink-0"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        </button>

        <div className="w-px h-5 bg-white/10" />

        {/* Tools — horizontal segmented group */}
        <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-xl p-0.5 border border-white/5">
          {TOOLS.map(({ id, icon, label, key }) => (
            <button
              key={id}
              title={`${label}${key ? ` (${key})` : ''}`}
              onClick={() => setTool(id)}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                tool === id
                  ? 'bg-primary/20 text-primary shadow-[0_0_10px_rgba(182,160,255,0.15)]'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <span className="material-symbols-outlined text-[17px]">{icon}</span>
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-white/10" />

        {/* Undo / Redo / Clear */}
        <div className="flex items-center gap-0.5">
          <HeaderBtn icon="undo" label="Undo" disabled={!canUndo} onClick={() => canvasRef.current?.undo()} />
          <HeaderBtn icon="redo" label="Redo" disabled={!canRedo} onClick={() => canvasRef.current?.redo()} />
          <HeaderBtn icon="delete_sweep" label="Clear all" onClick={() => canvasRef.current?.clear()} variant="danger" />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: history toggle + workflow + share */}
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

        <div className="w-px h-5 bg-white/10" />

        <WorkflowSelector
          templates={templates}
          selectedId={selectedTemplateId}
          onSelect={setSelectedTemplateId}
        />
        <button
          onClick={() => { triggerExport(); setShareAction('workflow') }}
          className="primary-gradient text-slate-900 font-bold text-[11px] px-4 py-1.5 rounded-lg flex items-center gap-1.5 hover:scale-[1.02] active:scale-95 transition-transform flex-shrink-0"
          style={{ fontFamily: 'Manrope, sans-serif' }}
        >
          <span className="material-symbols-outlined text-sm">share</span>
          Share
        </button>
      </header>

      {/* ── Main area ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Canvas container */}
        <div
          className="flex-1 relative overflow-hidden flex items-center justify-center"
          style={{ background: 'radial-gradient(circle, #0f172a 0%, #020617 100%)' }}
        >
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
          />

          {/* Floating color + stroke bar — bottom */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2.5 px-4 py-2.5 glass-refractive rounded-2xl shadow-2xl">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-6 h-6 rounded-full transition-all hover:scale-125 flex-shrink-0 ${
                  color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110' : ''
                }`}
                style={{ background: c }}
              />
            ))}

            <div className="w-px h-5 bg-white/10 mx-0.5" />

            <div
              className="w-5 h-5 rounded-full border-2 flex-shrink-0"
              style={{ borderColor: color, transform: `scale(${0.5 + (strokeWidth / 20) * 0.5})` }}
            />
            <input
              type="range"
              min={1}
              max={20}
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
              className="w-20 accent-primary"
            />
            <span className="text-[10px] text-slate-400 font-mono w-5 text-right flex-shrink-0">
              {strokeWidth}
            </span>
          </div>
        </div>

        {/* ── Clipboard history panel (toggleable) ── */}
        {showClipPanel && (
          <aside className="w-56 flex-shrink-0 glass-refractive border-l border-white/5 flex flex-col overflow-hidden">
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

            <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
              {clipboardHistory.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-6">No recent captures</p>
              ) : (
                clipboardHistory.map((item) => (
                  <div
                    key={item.id}
                    className={`group/clip flex items-center gap-2.5 p-2 rounded-xl cursor-pointer transition-all ${
                      item.dataUrl === imageDataUrl
                        ? 'bg-primary/10 border border-primary/20'
                        : 'bg-white/[0.03] hover:bg-white/[0.07] border border-transparent'
                    }`}
                    onClick={() => { setExportTrigger(0); setImageDataUrl(item.dataUrl) }}
                  >
                    <img
                      src={item.dataUrl}
                      className="w-9 h-9 rounded-lg object-cover flex-shrink-0 border border-white/10"
                      draggable={false}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-slate-300 truncate font-medium">{item.name}</p>
                      <p className="text-[9px] text-slate-600">{relativeTime(item.timestamp)}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        window.electronAPI?.runWorkflow('builtin-clipboard', item.dataUrl)
                        setCopyToast(true)
                        setTimeout(() => setCopyToast(false), 2000)
                      }}
                      className="opacity-0 group-hover/clip:opacity-100 p-1 rounded-md bg-white/10 hover:bg-primary/20 text-slate-400 hover:text-primary transition-all flex-shrink-0"
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
