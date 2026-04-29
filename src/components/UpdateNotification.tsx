import { useState, useEffect, useRef } from 'react'

type TransientStatus = 'checking' | 'not-available' | 'downloading' | 'error'

interface TransientState {
  status: TransientStatus
  version?: string
  error?: string
}

export function UpdateNotification() {
  const [downloadedVersion, setDownloadedVersion] = useState<string | null>(null)
  const [transient, setTransient] = useState<TransientState | null>(null)
  const manualRef = useRef(false)

  useEffect(() => {
    window.electronAPI?.onUpdateDownloaded((v) => {
      manualRef.current = false
      setTransient(null)
      setDownloadedVersion(v)
    })

    window.electronAPI?.onUpdateStatus?.((s) => {
      if (s.status === 'downloaded') return // handled by onUpdateDownloaded
      if (!manualRef.current) return // ignore background-check chatter

      if (s.status === 'available') {
        setTransient({ status: 'downloading', version: s.version })
        return
      }
      if (s.status === 'downloading') return // suppress progress flicker for now

      setTransient({ status: s.status, version: s.version, error: s.error })
      if (s.status === 'not-available' || s.status === 'error') {
        manualRef.current = false
      }
    })

    const onCheck = () => {
      manualRef.current = true
      setTransient({ status: 'checking' })
      window.electronAPI?.checkForUpdates?.()
    }
    window.addEventListener('app:check-update', onCheck)

    return () => {
      window.electronAPI?.removeAllListeners('update:downloaded')
      window.electronAPI?.removeAllListeners('update:status')
      window.removeEventListener('app:check-update', onCheck)
    }
  }, [])

  // Auto-dismiss terminal transient states
  useEffect(() => {
    if (!transient) return
    if (transient.status === 'checking' || transient.status === 'downloading') return
    const t = setTimeout(() => setTransient(null), 4000)
    return () => clearTimeout(t)
  }, [transient])

  if (downloadedVersion) {
    return (
      <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 bg-[var(--color-primary)]/15 border border-[var(--color-primary)]/30 rounded-full px-3 py-1.5 animate-slide-up backdrop-blur-md shadow-lg">
        <span className="material-symbols-outlined text-[var(--color-primary)] text-base">system_update</span>
        <span className="text-xs text-[var(--color-on-surface)]">Update v{downloadedVersion} ready</span>
        <button
          onClick={() => window.electronAPI?.installUpdate()}
          className="px-2.5 py-0.5 text-xs font-semibold rounded-full
                     bg-[var(--color-primary)] text-[var(--color-surface)]
                     hover:brightness-110 transition-all cursor-pointer"
        >
          Restart
        </button>
        <button
          onClick={() => setDownloadedVersion(null)}
          className="text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-sm">close</span>
        </button>
      </div>
    )
  }

  if (!transient) return null

  const labels: Record<TransientStatus, string> = {
    checking: 'Checking for updates…',
    'not-available': "You're on the latest version",
    downloading: transient.version ? `Update v${transient.version} downloading…` : 'Downloading update…',
    error: transient.error ? `Update check failed: ${transient.error}` : 'Update check failed',
  }
  const icons: Record<TransientStatus, string> = {
    checking: 'progress_activity',
    'not-available': 'check_circle',
    downloading: 'cloud_download',
    error: 'error',
  }
  const spinning = transient.status === 'checking'

  return (
    <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 bg-[var(--color-primary)]/15 border border-[var(--color-primary)]/30 rounded-full px-3 py-1.5 animate-slide-up backdrop-blur-md shadow-lg">
      <span className={`material-symbols-outlined text-[var(--color-primary)] text-base ${spinning ? 'animate-spin' : ''}`}>
        {icons[transient.status]}
      </span>
      <span className="text-xs text-[var(--color-on-surface)]">{labels[transient.status]}</span>
      <button
        onClick={() => setTransient(null)}
        className="text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] transition-colors cursor-pointer"
      >
        <span className="material-symbols-outlined text-sm">close</span>
      </button>
    </div>
  )
}
