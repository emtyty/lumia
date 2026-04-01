export function TitleBar() {
  const isMac = window.electronAPI?.platform === 'darwin'

  return (
    <div
      className="titlebar h-10 flex-shrink-0 flex items-center px-3 gap-2 z-[60] select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* macOS: leave room for traffic lights (positioned at x:18) */}
      {isMac && <div className="w-[72px] flex-shrink-0" />}

      <img
        src="/logo.png"
        alt="Lumia"
        className="h-5 object-contain flex-shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        draggable={false}
      />

      {/* Draggable spacer fills middle */}
      <div className="flex-1" />

      {/* Hamburger menu */}
      <button
        onClick={() => window.electronAPI?.showAppMenu()}
        className="flex items-center justify-center w-8 h-7 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        title="Menu"
      >
        <span className="material-symbols-outlined text-[18px]">menu</span>
      </button>

      {/* Windows: reserve space for native overlay controls (min/max/close) */}
      {!isMac && <div className="w-32 flex-shrink-0" />}
    </div>
  )
}
