import { useState, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AnnotationCanvas, { Tool } from '../../components/AnnotationCanvas/Canvas'
import ShareDialog from '../../components/ShareDialog'
import type { WorkflowTemplate, HistoryItem } from '../../types'

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: 'select',  icon: 'arrow_selector_tool', label: 'Select' },
  { id: 'pen',     icon: 'draw',                label: 'Pen' },
  { id: 'rect',    icon: 'rectangle',           label: 'Rectangle' },
  { id: 'ellipse', icon: 'circle',              label: 'Ellipse' },
  { id: 'arrow',   icon: 'arrow_forward',       label: 'Arrow' },
  { id: 'text',    icon: 'text_fields',         label: 'Text' },
  { id: 'blur',    icon: 'blur_on',             label: 'Blur' },
]

const COLORS = ['#b6a0ff', '#00e3fd', '#ff6c95', '#ffffff', '#fbbf24', '#34d399', '#f87171', '#000000']

export default function Editor() {
  const location = useLocation()
  const navigate = useNavigate()
  const [imageDataUrl, setImageDataUrl] = useState<string>((location.state as { dataUrl?: string })?.dataUrl ?? '')
  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState('#b6a0ff')
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [exportTrigger, setExportTrigger] = useState(0)
  const [exportedDataUrl, setExportedDataUrl] = useState<string>('')
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [shareAction, setShareAction] = useState<'workflow' | 'direct'>('direct')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [copyToast, setCopyToast] = useState(false)
  const [clipboardHistory, setClipboardHistory] = useState<{ id: string; dataUrl: string; name: string; timestamp: number }[]>([])
  const [showClipHistory, setShowClipHistory] = useState(true)

  // Update image whenever location.state changes — handles repeated hotkey captures
  // while the Editor is already mounted (navigate() to same route doesn't remount)
  useEffect(() => {
    const state = location.state as { dataUrl?: string } | null
    if (state?.dataUrl) setImageDataUrl(state.dataUrl)
  }, [location.state])

  useEffect(() => {
    window.electronAPI?.onCaptureReady(({ dataUrl }) => setImageDataUrl(dataUrl))
    window.electronAPI?.getTemplates().then(t => {
      setTemplates(t)
      if (t.length > 0) setSelectedTemplateId(t[0].id)
    })
    return () => { window.electronAPI?.removeAllListeners('capture:ready') }
  }, [])

  // Load clipboard history (recent screenshots from history store)
  useEffect(() => {
    window.electronAPI?.getHistory().then((items: HistoryItem[]) => {
      setClipboardHistory(
        items
          .filter(i => i.type === 'screenshot' && i.dataUrl)
          .slice(0, 20)
          .map(i => ({ id: i.id, dataUrl: i.dataUrl!, name: i.name, timestamp: i.timestamp }))
      )
    })
  }, [])

  const handleExport = useCallback(async (dataUrl: string) => {
    setExportedDataUrl(dataUrl)
    // Auto-copy to clipboard on every export
    try {
      await window.electronAPI?.runWorkflow('builtin-clipboard', dataUrl)
      setCopyToast(true)
      setTimeout(() => setCopyToast(false), 2000)
    } catch { /* silent */ }
    setShowShareDialog(true)
  }, [])

  const triggerExport = () => setExportTrigger(n => n + 1)

  const handleCopyToClipboard = async () => {
    triggerExport()
    // share dialog handles the actual copy after export
  }

  if (!imageDataUrl) {
    return (
      <div className="h-screen flex flex-col items-center justify-center text-slate-600 gap-6 pt-16">
        <span className="material-symbols-outlined text-6xl">add_a_photo</span>
        <p className="text-lg font-semibold" style={{ fontFamily: 'Manrope, sans-serif' }}>No capture loaded</p>
        <button
          onClick={() => navigate('/dashboard')}
          className="primary-gradient text-slate-900 font-bold px-8 py-3 rounded-2xl hover:scale-105 transition-transform"
        >
          Go to Dashboard
        </button>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden pt-0">
      {/* Auto-copy toast */}
      {copyToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-5 py-3 bg-secondary/20 backdrop-blur-xl border border-secondary/30 rounded-2xl shadow-lg">
          <span className="material-symbols-outlined text-secondary text-sm">check_circle</span>
          <span className="text-sm font-semibold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>Copied to clipboard</span>
        </div>
      )}
      {/* Top bar */}
      <header className="h-14 liquid-glass flex items-center justify-between px-6 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')} className="text-slate-400 hover:text-white transition-colors">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h2 className="text-sm font-bold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>Annotation Editor</h2>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedTemplateId}
            onChange={e => setSelectedTemplateId(e.target.value)}
            className="bg-white/5 border border-white/10 text-white text-xs px-3 py-2 rounded-xl focus:outline-none focus:border-primary/40"
          >
            {templates.map(t => (
              <option key={t.id} value={t.id} className="bg-slate-900">{t.icon} {t.name}</option>
            ))}
          </select>
          <button
            onClick={() => { triggerExport(); setShareAction('workflow') }}
            className="primary-gradient text-slate-900 font-bold text-xs px-5 py-2 rounded-xl flex items-center gap-2 hover:scale-105 transition-transform"
          >
            <span className="material-symbols-outlined text-sm">rocket_launch</span>
            Share
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas area */}
        <div className="flex-1 overflow-hidden flex items-center justify-center canvas-vignette" style={{ background: 'radial-gradient(circle, #0f172a 0%, #020617 100%)' }}>
          <AnnotationCanvas
            key={imageDataUrl}
            imageDataUrl={imageDataUrl}
            tool={tool}
            color={color}
            strokeWidth={strokeWidth}
            onExport={handleExport}
            exportTrigger={exportTrigger}
          />
        </div>

        {/* Right panel */}
        <aside className="w-64 glass-refractive border-l border-white/5 flex flex-col p-4 gap-6 overflow-y-auto">
          {/* Tool palette */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3" style={{ fontFamily: 'Manrope, sans-serif' }}>Tools</p>
            <div className="grid grid-cols-4 gap-2">
              {TOOLS.map(({ id, icon, label }) => (
                <button
                  key={id}
                  title={label}
                  onClick={() => setTool(id)}
                  className={`p-2.5 rounded-xl flex items-center justify-center transition-all ${
                    tool === id
                      ? 'bg-primary/20 text-primary border border-primary/30'
                      : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">{icon}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Color palette */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3" style={{ fontFamily: 'Manrope, sans-serif' }}>Color</p>
            <div className="grid grid-cols-4 gap-2">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-full aspect-square rounded-xl transition-all hover:scale-110 ${color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-slate-900 scale-110' : ''}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          {/* Stroke width */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Stroke — {strokeWidth}px
            </p>
            <input
              type="range" min={1} max={20} value={strokeWidth}
              onChange={e => setStrokeWidth(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>

          {/* Clipboard History */}
          <div>
            <button
              onClick={() => setShowClipHistory(prev => !prev)}
              className="flex items-center justify-between w-full mb-3 group"
            >
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Clipboard History
              </p>
              <span className={`material-symbols-outlined text-slate-500 text-sm transition-transform ${showClipHistory ? "rotate-180" : ""}`}>
                expand_more
              </span>
            </button>
            {showClipHistory && (
              <div className="space-y-2 max-h-48 overflow-y-auto hide-scrollbar">
                {clipboardHistory.length === 0 ? (
                  <p className="text-xs text-slate-600 text-center py-3">No recent captures</p>
                ) : (
                  clipboardHistory.map(item => (
                    <button
                      key={item.id}
                      onClick={() => setImageDataUrl(item.dataUrl)}
                      className="w-full flex items-center gap-3 p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-all"
                    >
                      <img src={item.dataUrl} className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-white/10" />
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-xs text-slate-300 truncate">{item.name}</p>
                        <p className="text-[10px] text-slate-600">
                          {new Date(item.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="mt-auto space-y-2">
            <button
              onClick={() => { triggerExport(); setShareAction('direct') }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              <span className="material-symbols-outlined text-sm">content_copy</span>
              Copy to Clipboard
            </button>
            <button
              onClick={() => { triggerExport(); setShareAction('direct') }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              <span className="material-symbols-outlined text-sm">save</span>
              Save Capture
            </button>
            <button
              onClick={() => { triggerExport(); setShareAction('workflow') }}
              className="w-full primary-gradient text-slate-900 font-bold px-4 py-3 rounded-xl flex items-center justify-center gap-2 text-sm hover:scale-[1.02] transition-transform"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              <span className="material-symbols-outlined text-sm">rocket_launch</span>
              Upload
            </button>
          </div>
        </aside>
      </div>

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
