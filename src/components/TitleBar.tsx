import { useState, useRef } from 'react'
import { AppMenu } from './AppMenu'

export function TitleBar() {
  const isMac = window.electronAPI?.platform === 'darwin'
  const [menuOpen, setMenuOpen] = useState(false)
  const menuBtnRef = useRef<HTMLButtonElement>(null)

  return (
    <div
      className="titlebar h-10 flex-shrink-0 flex items-center px-3 gap-2 z-[60] select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Draggable spacer fills middle */}
      <div className="flex-1" />

      {/* Hamburger menu */}
      <button
        ref={menuBtnRef}
        onClick={() => setMenuOpen(prev => !prev)}
        className="flex items-center justify-center w-8 h-7 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        title="Menu"
      >
        <span className="material-symbols-outlined text-[18px]">menu</span>
      </button>

      {/* Windows: reserve space for native overlay controls (min/max/close) */}
      {!isMac && <div className="w-32 flex-shrink-0" />}

      <AppMenu open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={menuBtnRef} />
    </div>
  )
}
