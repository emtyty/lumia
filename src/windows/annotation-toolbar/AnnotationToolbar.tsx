import { useEffect, useState } from 'react'

type Tool = 'none' | 'pen' | 'arrow' | 'rect' | 'ellipse' | 'highlighter'

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  // 'none' is the interact mode — overlay flips to click-through so the
  // user can drive the recorded app with the cursor again. Picking any of
  // the actual drawing tools below re-locks the overlay for ink.
  { id: 'none',        icon: 'arrow_selector_tool', label: 'Cursor (interact with app)' },
  { id: 'pen',         icon: 'draw',          label: 'Pen' },
  { id: 'arrow',       icon: 'arrow_forward', label: 'Arrow' },
  { id: 'rect',        icon: 'crop_square',   label: 'Rectangle' },
  { id: 'ellipse',     icon: 'circle',        label: 'Ellipse' },
  { id: 'highlighter', icon: 'highlight',     label: 'Highlighter' },
]

const COLORS = [
  '#f87171', // red
  '#fbbf24', // amber
  '#34d399', // emerald
  '#60a5fa', // blue
  '#a78bfa', // violet
  '#ffffff', // white
  '#000000', // black
]

const STROKE_PRESETS = [2, 4, 8, 14] as const

export default function AnnotationToolbar() {
  const [tool, setTool] = useState<Tool>('none')
  const [color, setColor] = useState('#f87171')
  const [strokeWidth, setStrokeWidth] = useState<number>(4)

  useEffect(() => {
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
  }, [])

  // Sync from main on mount so re-opening the palette restores the user's
  // last selection rather than always resetting to pen/red.
  useEffect(() => {
    window.electronAPI?.annotationGetState?.().then((s) => {
      if (!s) return
      setTool(s.tool as Tool)
      setColor(s.color)
      setStrokeWidth(s.strokeWidth)
    }).catch(() => {})
  }, [])

  const pickTool = (t: Tool) => { setTool(t); window.electronAPI?.annotationSetTool?.(t) }
  const pickColor = (c: string) => { setColor(c); window.electronAPI?.annotationSetColor?.(c) }
  const pickStroke = (n: number) => { setStrokeWidth(n); window.electronAPI?.annotationSetStroke?.(n) }
  const onUndo = () => window.electronAPI?.annotationUndo?.()
  const onClear = () => window.electronAPI?.annotationClear?.()
  const onClose = () => window.electronAPI?.annotationClose?.()

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ fontFamily: 'Manrope, sans-serif' }}>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        style={{
          WebkitAppRegion: 'drag',
          background: 'rgba(20,20,28,0.92)',
          border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(20px)',
        } as React.CSSProperties}
      >
        {/* Tool buttons */}
        {TOOLS.map(t => (
          <ToolBtn key={t.id} icon={t.icon} label={t.label} active={tool === t.id} onClick={() => pickTool(t.id)} />
        ))}

        <Sep />

        {/* Stroke size */}
        {STROKE_PRESETS.map(n => (
          <button
            key={n}
            onClick={() => pickStroke(n)}
            title={`Stroke ${n}px`}
            aria-label={`Stroke ${n}px`}
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
              strokeWidth === n ? 'bg-white/20' : 'hover:bg-white/10'
            }`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <span
              className="rounded-full bg-white"
              style={{
                width: Math.min(18, Math.max(3, n * 1.2)),
                height: Math.min(18, Math.max(3, n * 1.2)),
              }}
            />
          </button>
        ))}

        <Sep />

        {/* Color swatches */}
        {COLORS.map(c => (
          <button
            key={c}
            onClick={() => pickColor(c)}
            title={c}
            aria-label={`Color ${c}`}
            className={`w-6 h-6 rounded-full transition-all ${
              color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-[rgb(20,20,28)]' : 'hover:scale-110'
            }`}
            style={{
              WebkitAppRegion: 'no-drag',
              backgroundColor: c,
              border: c === '#ffffff' || c === '#000000' ? '1px solid rgba(255,255,255,0.2)' : 'none',
            } as React.CSSProperties}
          />
        ))}

        <Sep />

        {/* Undo + Clear + Close */}
        <ToolBtn icon="undo"         label="Undo"             onClick={onUndo} />
        <ToolBtn icon="delete_sweep" label="Clear all"        onClick={onClear} />
        <ToolBtn icon="close"        label="Close annotation" onClick={onClose} accent="red" />
      </div>
    </div>
  )
}

function Sep() {
  return <div className="w-px h-5 bg-white/10 mx-0.5" />
}

function ToolBtn({
  icon, label, onClick, active = false, accent,
}: {
  icon: string
  label: string
  onClick: () => void
  active?: boolean
  accent?: 'red'
}) {
  let cls = 'text-slate-300 hover:text-white hover:bg-white/10'
  if (active) cls = 'bg-white/20 text-white'
  if (accent === 'red') cls = 'text-slate-300 hover:text-white hover:bg-red-500/70'
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${cls}`}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
    </button>
  )
}
