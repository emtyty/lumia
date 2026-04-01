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

  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null)
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

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
      window.electronAPI?.cancelRegion()
    }
  }, [])

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
    await window.electronAPI?.confirmRegion(rect)
  }

  const rect = getRect()

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 select-none"
      style={{ cursor: 'crosshair', background: 'rgba(0,0,0,0.35)' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Instruction hint */}
      {!isDrawing && (
        <div
          className="absolute top-8 left-1/2 -translate-x-1/2 glass-refractive rounded-full px-6 py-3 text-sm text-white font-semibold pointer-events-none"
          style={{ fontFamily: 'Manrope, sans-serif' }}
        >
          <span className="material-symbols-outlined text-sm mr-2 align-middle">crop_free</span>
          Drag to select region · ESC to cancel
        </div>
      )}

      {/* Selection rectangle */}
      {rect && rect.width > 0 && rect.height > 0 && (
        <>
          {/* Highlight (clear area) */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              background: 'transparent',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
              border: '2px solid rgba(182,160,255,0.8)',
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
