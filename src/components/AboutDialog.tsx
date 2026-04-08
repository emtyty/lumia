import { useState, useEffect } from 'react'
import logo from '../assets/logo.png'

export function AboutDialog() {
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.electronAPI?.getAppVersion().then((v: string) => setVersion(v))
    window.electronAPI?.onAbout(() => setOpen(true))
    const handleShowAbout = () => setOpen(true)
    window.addEventListener('app:show-about', handleShowAbout)
    return () => {
      window.electronAPI?.removeAllListeners('app:about')
      window.removeEventListener('app:show-about', handleShowAbout)
    }
  }, [])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div className="glass-card rounded-2xl p-8 flex flex-col items-center gap-4 min-w-[280px] shadow-2xl border border-white/10" onClick={e => e.stopPropagation()}>
        <img src={logo} alt="Lumia" className="w-20 h-20 rounded-2xl" />
        <div className="text-center">
          <h2 className="text-xl font-bold text-[var(--color-on-surface)]">Lumia</h2>
          <p className="text-sm text-[var(--color-on-surface-variant)] mt-1">Version {version}</p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="mt-2 px-6 py-1.5 text-sm rounded-lg bg-white/10 text-[var(--color-on-surface)] hover:bg-white/20 transition-colors cursor-pointer"
        >
          OK
        </button>
      </div>
    </div>
  )
}
