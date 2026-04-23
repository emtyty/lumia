import { useState, useEffect, useRef, useCallback } from 'react'

interface Rect { x: number; y: number; width: number; height: number }

function HintCard({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div
      className="absolute top-8 left-1/2 -translate-x-1/2 glass-refractive rounded-full px-6 py-3 text-sm text-white font-semibold pointer-events-none"
      style={{ fontFamily: 'Manrope, sans-serif' }}
    >
      <span className="material-symbols-outlined text-sm mr-2 align-middle">{icon}</span>
      {children}
    </div>
  )
}

/** Floating top bar: mode switcher (Region/Window) + hint. Only visible when the
 *  overlay is the active one for the user's cursor display. */
type SwitchableMode = 'region' | 'window-pick' | 'monitor-pick'
function ModeBar({
  mode, hint, icon,
}: {
  mode: SwitchableMode
  hint: string
  icon: string
}) {
  const switchTo = (next: SwitchableMode) => {
    if (next === mode) return
    window.electronAPI?.switchOverlayMode?.(next)
  }
  const TabBtn = ({ value, label, tabIcon }: { value: SwitchableMode; label: string; tabIcon: string }) => (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); switchTo(value) }}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1 transition-all ${
        mode === value
          ? 'bg-primary text-slate-900 shadow-[0_0_12px_rgba(182,160,255,0.35)]'
          : 'text-slate-300 hover:text-white hover:bg-white/10'
      }`}
      style={{ fontFamily: 'Manrope, sans-serif' }}
    >
      <span className="material-symbols-outlined text-[14px]">{tabIcon}</span>
      {label}
    </button>
  )
  return (
    <div
      className="absolute top-8 left-1/2 -translate-x-1/2 flex items-center gap-3 glass-refractive rounded-full pl-1.5 pr-5 py-1.5"
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{ fontFamily: 'Manrope, sans-serif' }}
    >
      <div className="flex items-center gap-1">
        <TabBtn value="region" label="Region" tabIcon="crop" />
        <TabBtn value="window-pick" label="Window" tabIcon="web_asset" />
        <TabBtn value="monitor-pick" label="Screen" tabIcon="monitor" />
      </div>
      <div className="w-px h-4 bg-white/10" />
      <span className="text-sm font-semibold text-white flex items-center gap-2">
        <span className="material-symbols-outlined text-sm">{icon}</span>
        {hint}
      </span>
    </div>
  )
}

export default function Overlay() {
  useEffect(() => {
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'
    return () => {
      document.body.style.background = ''
      document.documentElement.style.background = ''
    }
  }, [])

  const [mode, setMode] = useState<'region' | 'scroll-region' | 'window-pick' | 'monitor-pick'>('region')
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null)
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [isActive, setIsActive] = useState(true)
  const [hoveredWindow, setHoveredWindow] = useState<Rect | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveredWindowRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)

  useEffect(() => {
    window.electronAPI?.getOverlayMode().then(m => setMode(m as any))
  }, [])

  useEffect(() => {
    window.electronAPI?.onOverlaySetActive((active: boolean) => setIsActive(active))
    window.electronAPI?.onOverlayModeChanged?.((m) => {
      setMode(m as any)
      setStartPos(null)
      setCurrentPos(null)
      setIsDrawing(false)
      setHoveredWindow(null)
    })
    return () => {
      window.electronAPI?.removeAllListeners('overlay:set-active')
      window.electronAPI?.removeAllListeners('overlay:mode-changed')
    }
  }, [])

  // Window-pick: poll window under cursor (throttled 80ms)
  const pollWindowAt = useCallback(async (x: number, y: number) => {
    if (mode !== 'window-pick' || !isActive) return
    const rect = await window.electronAPI?.getWindowAt(x, y)
    hoveredWindowRef.current = rect ?? null
    setHoveredWindow(rect ?? null)
  }, [mode, isActive])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (mode === 'scroll-region') window.electronAPI?.cancelScrollRegion()
      else if (mode === 'window-pick') window.electronAPI?.cancelWindowPick()
      else if (mode === 'monitor-pick') window.electronAPI?.cancelMonitorPick()
      else window.electronAPI?.cancelRegion()
    }
  }, [mode])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // ── Region / scroll-region handlers ──────────────────────────────────────
  const getRect = (): Rect | null => {
    if (!startPos || !currentPos) return null
    return {
      x: Math.min(startPos.x, currentPos.x),
      y: Math.min(startPos.y, currentPos.y),
      width: Math.abs(currentPos.x - startPos.x),
      height: Math.abs(currentPos.y - startPos.y),
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isActive) return
    if (mode === 'window-pick') {
      const x = e.clientX
      const y = e.clientY
      if (pollRef.current) clearTimeout(pollRef.current)
      window.electronAPI?.getWindowAt(x, y).then(rect => {
        if (rect) window.electronAPI?.confirmWindowPick(rect)
      })
      return
    }
    setStartPos({ x: e.clientX, y: e.clientY })
    setCurrentPos({ x: e.clientX, y: e.clientY })
    setIsDrawing(true)
    window.electronAPI?.overlayDrawing(true)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (mode === 'window-pick') {
      const x = e.clientX
      const y = e.clientY
      if (pollRef.current) clearTimeout(pollRef.current)
      pollRef.current = setTimeout(() => pollWindowAt(x, y), 80)
      return
    }
    if (!isDrawing) return
    setCurrentPos({ x: e.clientX, y: e.clientY })
  }

  const handleMouseUp = async () => {
    if (mode === 'window-pick') return
    if (!isDrawing) return
    setIsDrawing(false)
    window.electronAPI?.overlayDrawing(false)
    const rect = getRect()
    if (!rect || rect.width < 10 || rect.height < 10) return
    if (mode === 'scroll-region') {
      await window.electronAPI?.confirmScrollRegion(rect)
    } else {
      await window.electronAPI?.confirmRegion({ dataUrl: '', rect })
    }
  }

  const rect = getRect()

  // ── Monitor-pick UI ───────────────────────────────────────────────────────
  if (mode === 'monitor-pick') {
    return (
      <div
        className="fixed inset-0 select-none"
        style={{
          cursor: isActive ? 'pointer' : 'default',
          background: isActive ? 'rgba(59,130,246,0.15)' : 'rgba(0,0,0,0.4)',
        }}
        onClick={() => { if (isActive) window.electronAPI?.confirmMonitorPick() }}
      >
        {isActive && (
          <>
            <div
              className="absolute inset-4 pointer-events-none"
              style={{
                border: '3px solid rgba(96,165,250,0.9)',
                borderRadius: 8,
                boxShadow: 'inset 0 0 0 1px rgba(96,165,250,0.3)',
              }}
            />
            <ModeBar mode="monitor-pick" icon="monitor" hint="Click to capture this monitor · ESC to cancel" />
          </>
        )}
      </div>
    )
  }

  // ── Window-pick UI ────────────────────────────────────────────────────────
  if (mode === 'window-pick') {
    return (
      <div
        className="fixed inset-0 select-none"
        style={{
          cursor: isActive ? 'crosshair' : 'default',
          background: isActive ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.4)',
        }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
      >
        {!isActive && (
          <div className="fixed inset-0" style={{ background: 'rgba(0,0,0,0.4)' }} />
        )}

        {isActive && (
          <ModeBar mode="window-pick" icon="window" hint="Click a window · ESC to cancel" />
        )}

        {hoveredWindow && isActive && (
          <>
            {/* Highlight border */}
            <div
              className="absolute pointer-events-none"
              style={{
                left: hoveredWindow.x,
                top: hoveredWindow.y,
                width: hoveredWindow.width,
                height: hoveredWindow.height,
                border: '2px solid rgba(96,165,250,0.9)',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.25), inset 0 0 0 1px rgba(96,165,250,0.3)',
                borderRadius: 4,
                background: 'rgba(96,165,250,0.06)',
              }}
            />
            {/* Size label */}
            <div
              className="absolute glass-refractive text-xs text-white px-3 py-1.5 rounded-full pointer-events-none font-mono"
              style={{
                left: hoveredWindow.x + hoveredWindow.width / 2,
                top: hoveredWindow.y + hoveredWindow.height + 10,
                transform: 'translateX(-50%)',
                fontFamily: 'Manrope, sans-serif',
              }}
            >
              {hoveredWindow.width} × {hoveredWindow.height}
            </div>
          </>
        )}
      </div>
    )
  }

  // ── Region / scroll-region UI ─────────────────────────────────────────────
  const hint = mode === 'scroll-region'
    ? 'Drag to select scroll region · ESC to cancel'
    : 'Drag to select region · ESC to cancel'

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 select-none"
      style={{
        cursor: isActive ? 'crosshair' : 'default',
        background: isActive ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.55)',
        transition: 'background 0.15s ease'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <style>{`
        @keyframes scroll-region-border-pulse {
          0%, 100% { border-color: rgba(56, 189, 248, 0.8); box-shadow: 0 0 0 9999px rgba(0,0,0,0.45); }
          50% { border-color: rgba(56, 189, 248, 0.4); box-shadow: 0 0 0 9999px rgba(0,0,0,0.45), 0 0 12px 2px rgba(56, 189, 248, 0.3); }
        }
        .scroll-region-pulse { animation: scroll-region-border-pulse 1.5s ease-in-out infinite; }
      `}</style>

      {isActive && mode === 'region' && (
        <ModeBar mode="region" icon="crop_free" hint={hint} />
      )}
      {isActive && mode === 'scroll-region' && (
        <HintCard icon="swipe_down">{hint}</HintCard>
      )}

      {rect && rect.width > 0 && rect.height > 0 && (
        <>
          <div
            className={`absolute pointer-events-none${mode === 'scroll-region' ? ' scroll-region-pulse' : ''}`}
            style={{
              left: rect.x, top: rect.y, width: rect.width, height: rect.height,
              background: 'transparent',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
              border: mode === 'scroll-region'
                ? '2px solid rgba(56, 189, 248, 0.8)'
                : '2px solid rgba(182,160,255,0.8)',
              borderRadius: 4,
            }}
          />
          <div
            className="absolute glass-refractive text-xs text-white px-3 py-1.5 rounded-full pointer-events-none font-mono"
            style={{
              left: rect.x + rect.width / 2,
              top: rect.y + rect.height + 10,
              transform: 'translateX(-50%)',
              fontFamily: 'Manrope, sans-serif',
            }}
          >
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
        </>
      )}
    </div>
  )
}
