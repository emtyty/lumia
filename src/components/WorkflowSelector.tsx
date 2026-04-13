import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { WorkflowTemplate } from '../types'

interface WorkflowSelectorProps {
  templates: WorkflowTemplate[]
  selectedId: string
  onSelect: (id: string) => void
}

export function WorkflowSelector({ templates, selectedId, onSelect }: WorkflowSelectorProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const selected = templates.find(t => t.id === selectedId)

  // Compute position from trigger
  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left })
    requestAnimationFrame(() => setVisible(true))
    return () => setVisible(false)
  }, [open])

  // Escape key & window blur
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onBlur = () => setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [open])

  const handleSelect = (id: string) => {
    onSelect(id)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 h-full bg-white/[0.04] hover:bg-white/[0.08] text-white text-xs pl-3 pr-2 transition-colors cursor-pointer"
      >
        <span className="material-symbols-outlined text-[15px] text-secondary">rocket_launch</span>
        <span className="font-medium" style={{ fontFamily: 'Manrope, sans-serif' }}>{selected?.name ?? 'Select workflow'}</span>
        <span className="material-symbols-outlined text-[14px] text-slate-500">expand_more</span>
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[89]" onClick={() => setOpen(false)} />
          <div
            className={`fixed z-[90] min-w-[200px] max-h-[280px] overflow-y-auto py-1.5 rounded-xl shadow-2xl
              glass-refractive border border-white/10
              transition-all duration-150 origin-top-left
              ${visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
            style={{ top: pos.top, left: pos.left, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {templates.map(t => (
              <button
                key={t.id}
                onClick={() => handleSelect(t.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors cursor-pointer ${
                  t.id === selectedId ? 'bg-white/10 text-white' : 'text-[var(--color-on-surface)] hover:bg-white/10'
                }`}
              >
                <span className="material-symbols-outlined text-[18px] text-[var(--color-on-surface-variant)]">{t.icon}</span>
                <span className="flex-1 text-left text-xs">{t.name}</span>
                {t.id === selectedId && (
                  <span className="material-symbols-outlined text-sm text-secondary">check</span>
                )}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
