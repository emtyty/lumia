import { useState, useEffect, useRef, useCallback } from 'react'

interface Rect { x: number; y: number; width: number; height: number }

export default function Overlay() {
  // Make body fully transparent so the Electron window transparency shows through
  useEffect(() => {
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'
    return () => {
      document.body.style.background = ''
      document.documentElement.style.background = ''
    }
  }, [])

  const [mode, setMode] = useState<'region' | 'scroll-region'>('region')
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null)
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Fetch the overlay mode from main process on mount
  useEffect(() => {
    window.electronAPI?.getOverlayMode().then(m => setMode(m))
  }, [])

  const getRect = (): Rect | null => {
    if (!startPos || !currentPos) return null
    const x = Math.min(startPos.x, currentPos.x)
    const y = Math.min(startPos.y, currentPos.y)
    const width = Math.abs(currentPos.x - startPos.x)
    const height = Math.abs(currentPos.y - startPos.y)
    return { x, y, width, height }
  }

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (mode === 'scroll-region') {
        window.electronAPI?.cancelScrollRegion()
      } else {
        window.electronAPI?.cancelRegion()
      }
    }
  }, [mode])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const handleMouseDown = (e: React.MouseEvent) => {
    setStartPos({ x: e.clientX, y: e.clientY })
    setCurrentPos({ x: e.clientX, y: e.clientY })
    setIsDrawing(true)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing) return
    setCurrentPos({ x: e.clientX, y: e.clientY })
  }

  const handleMouseUp = async () => {
    if (!isDrawing) return
    setIsDrawing(false)
    const rect = getRect()
    if (!rect || rect.width < 10 || rect.height < 10) return
    if (mode === 'scroll-region') {
      await window.electronAPI?.confirmScrollRegion(rect)
    } else {
      await window.electronAPI?.confirmRegion(rect)
    }
  }

  const rect = getRect()

  const hint = mode === 'scroll-region'
    ? 'Drag to select scroll region · ESC to cancel'
    : 'Drag to select region · ESC to cancel'

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 select-none"
      style={{ cursor: 'crosshair', background: 'rgba(0,0,0,0.35)' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Pulse animation for scroll-region mode */}
      <style>{`
        @keyframes scroll-region-border-pulse {
          0%, 100% { border-color: rgba(56, 189, 248, 0.8); box-shadow: 0 0 0 9999px rgba(0,0,0,0.45); }
          50% { border-color: rgba(56, 189, 248, 0.4); box-shadow: 0 0 0 9999px rgba(0,0,0,0.45), 0 0 12px 2px rgba(56, 189, 248, 0.3); }
        }
        .scroll-region-pulse {
          animation: scroll-region-border-pulse 1.5s ease-in-out infinite;
        }
      `}</style>
      {/* Instruction hint */}
      {!isDrawing && (
        <div
          className="absolute top-8 left-1/2 -translate-x-1/2 glass-refractive rounded-full px-6 py-3 text-sm text-white font-semibold pointer-events-none"
          style={{ fontFamily: 'Manrope, sans-serif' }}
        >
          <span className="material-symbols-outlined text-sm mr-2 align-middle">
            {mode === 'scroll-region' ? 'swipe_down' : 'crop_free'}
          </span>
          {hint}
        </div>
      )}

      {/* Selection rectangle */}
      {rect && rect.width > 0 && rect.height > 0 && (
        <>
          {/* Highlight (clear area) */}
          <div
            className={`absolute pointer-events-none${mode === 'scroll-region' ? ' scroll-region-pulse' : ''}`}
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              background: 'transparent',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
              border: mode === 'scroll-region'
                ? '2px solid rgba(56, 189, 248, 0.8)'
                : '2px solid rgba(182,160,255,0.8)',
              borderRadius: 4
            }}
          />

          {/* Size indicator */}
          <div
            className="absolute glass-refractive text-xs text-white px-3 py-1.5 rounded-full pointer-events-none font-mono"
            style={{
              left: rect.x + rect.width / 2,
              top: rect.y + rect.height + 10,
              transform: 'translateX(-50%)',
              fontFamily: 'Manrope, sans-serif'
            }}
          >
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
        </>
      )}
    </div>
  )
}
