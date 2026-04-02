import { useState, useEffect } from 'react'

export function UpdateNotification() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI?.onUpdateDownloaded((v) => setVersion(v))
    return () => { window.electronAPI?.removeAllListeners('update:downloaded') }
  }, [])

  if (!version) return null

  return (
    <div className="flex items-center gap-2 bg-[var(--color-primary)]/15 border border-[var(--color-primary)]/30 rounded-full px-3 py-1.5 animate-slide-up">
      <span className="material-symbols-outlined text-[var(--color-primary)] text-base">system_update</span>
      <span className="text-xs text-[var(--color-on-surface)]">Update v{version} ready</span>
      <button
        onClick={() => window.electronAPI?.installUpdate()}
        className="px-2.5 py-0.5 text-xs font-semibold rounded-full
                   bg-[var(--color-primary)] text-[var(--color-surface)]
                   hover:brightness-110 transition-all cursor-pointer"
      >
        Restart
      </button>
      <button
        onClick={() => setVersion(null)}
        className="text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] transition-colors cursor-pointer"
      >
        <span className="material-symbols-outlined text-sm">close</span>
      </button>
    </div>
  )
}
