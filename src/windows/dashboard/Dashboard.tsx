import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { HistoryItem } from '../../types'
import VideoRecorder from '../../components/VideoRecorder'
import { UpdateNotification } from '../../components/UpdateNotification'

type CaptureMode = 'region' | 'window' | 'fullscreen' | 'active-monitor'

const CAPTURE_MODES: { mode: CaptureMode; icon: string; label: string; shortcut: string }[] = [
  { mode: 'region',         icon: 'crop_free',       label: 'Region',        shortcut: 'Ctrl+Shift+4' },
  { mode: 'window',         icon: 'layers',          label: 'Window',        shortcut: 'Ctrl+Shift+2' },
  { mode: 'fullscreen',     icon: 'desktop_windows', label: 'Fullscreen',    shortcut: 'Ctrl+Shift+3' },
  { mode: 'active-monitor', icon: 'monitor',         label: 'Active Screen', shortcut: 'Ctrl+Shift+1' },
]

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Late night session'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24) return `${hrs}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [recentItems, setRecentItems] = useState<HistoryItem[]>([])
  const [showRecorder, setShowRecorder] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    window.electronAPI?.getHistory().then(items => setRecentItems(items.slice(0, 12)))

    window.electronAPI?.onCaptureReady(({ dataUrl, source }) => {
      navigate('/editor', { state: { dataUrl, source } })
    })

    window.electronAPI?.onRecorderOpen(() => setShowRecorder(true))
    window.electronAPI?.onRecorderOpenGif(() => setShowRecorder(true))

    return () => {
      window.electronAPI?.removeAllListeners('capture:ready')
      window.electronAPI?.removeAllListeners('recorder:open')
      window.electronAPI?.removeAllListeners('recorder:open-gif')
    }
  }, [navigate])

  const handleCapture = async (mode: CaptureMode) => {
    if (mode === 'region') {
      await window.electronAPI?.captureScreenshot('region')
    } else {
      const dataUrl = await window.electronAPI?.captureScreenshot(mode) as string
      if (dataUrl) navigate('/editor', { state: { dataUrl, source: mode } })
    }
  }

  const screenshots = recentItems.filter(i => i.type === 'screenshot')
  const recordings = recentItems.filter(i => i.type === 'recording')

  const filtered = recentItems.filter(item =>
    !search || item.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="h-full overflow-y-auto p-8 pb-16 space-y-8">

      {/* ── Greeting + Update ── */}
      <header className="flex items-start justify-between">
        <div>
          <h1
            className="text-3xl font-extrabold tracking-tight text-white"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            {getGreeting()}
          </h1>
          <p className="text-sm text-slate-500 mt-1.5" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {recentItems.length === 0
              ? 'Start your first capture to get going'
              : `${screenshots.length} screenshot${screenshots.length !== 1 ? 's' : ''} · ${recordings.length} recording${recordings.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <UpdateNotification />
      </header>

      {/* ── Capture Actions ── */}
      <section className="card-organic p-6">
        <h2
          className="text-[11px] font-bold tracking-[0.15em] uppercase text-slate-500 mb-4"
          style={{ fontFamily: 'Manrope, sans-serif' }}
        >
          Capture
        </h2>

        <div className="flex items-center gap-3">
          {CAPTURE_MODES.map(({ mode, icon, label, shortcut }) => (
            <button
              key={mode}
              onClick={() => handleCapture(mode)}
              title={shortcut}
              className="flex items-center gap-2.5 px-4 py-3 bg-white/5 rounded-xl
                         hover:bg-white/10 transition-all border border-transparent
                         hover:border-primary/20 group"
            >
              <span className="material-symbols-outlined text-primary text-xl group-hover:scale-110 transition-transform">
                {icon}
              </span>
              <div className="text-left">
                <span
                  className="block text-[11px] font-semibold text-slate-300 group-hover:text-white"
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  {label}
                </span>
                <span className="block text-[9px] text-slate-600">{shortcut}</span>
              </div>
            </button>
          ))}

          <div className="w-px self-stretch bg-white/10 mx-1" />

          <button
            onClick={() => setShowRecorder(true)}
            title="Ctrl+Shift+R"
            className="flex items-center gap-2.5 px-4 py-3 bg-white/5 rounded-xl
                       hover:bg-white/10 transition-all border border-transparent
                       hover:border-tertiary/20 group"
          >
            <span className="material-symbols-outlined text-tertiary text-xl group-hover:scale-110 transition-transform">
              videocam
            </span>
            <div className="text-left">
              <span
                className="block text-[11px] font-semibold text-slate-300 group-hover:text-white"
                style={{ fontFamily: 'Manrope, sans-serif' }}
              >
                Record
              </span>
              <span className="block text-[9px] text-slate-600">Ctrl+Shift+R</span>
            </div>
          </button>
        </div>
      </section>

      {/* ── Recent Captures ── */}
      <section>
        <div className="flex items-center justify-between mb-5">
          <h2
            className="text-lg font-bold text-white"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            Recent
          </h2>
          <div className="flex items-center gap-3">
            {recentItems.length > 0 && (
              <div className="flex items-center bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg hover:border-primary/30 transition-all focus-within:border-primary/40">
                <span className="material-symbols-outlined text-slate-500 text-sm">search</span>
                <input
                  className="bg-transparent border-none outline-none text-xs w-40 placeholder-slate-600 text-white ml-2"
                  placeholder="Filter captures..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button onClick={() => setSearch('')} className="text-slate-500 hover:text-white transition-colors">
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                )}
              </div>
            )}
            <button
              onClick={() => navigate('/history')}
              className="text-xs text-slate-500 hover:text-primary transition-colors font-semibold"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              View all &rarr;
            </button>
          </div>
        </div>

        {filtered.length === 0 && !search ? (
          <div className="card-organic text-center py-16">
            <span className="material-symbols-outlined text-4xl text-slate-700 mb-3 block">add_a_photo</span>
            <p
              className="text-sm text-slate-500 font-medium"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              No captures yet
            </p>
            <p className="text-xs text-slate-600 mt-1.5">
              Use the buttons above or press{' '}
              <kbd className="px-1.5 py-0.5 bg-white/5 rounded text-slate-400 text-[10px] font-mono">
                Ctrl+Shift+4
              </kbd>{' '}
              to capture a region
            </p>
          </div>
        ) : filtered.length === 0 && search ? (
          <div className="text-center py-16">
            <span className="material-symbols-outlined text-3xl text-slate-700 mb-2 block">search_off</span>
            <p className="text-sm text-slate-500">
              No captures match &ldquo;{search}&rdquo;
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-5">
            {filtered.map(item => (
              <CaptureCard
                key={item.id}
                item={item}
                onOpen={() => {
                  if (item.type === 'recording') {
                    navigate('/video-annotator', { state: { filePath: item.filePath, name: item.name } })
                  } else {
                    navigate('/editor', { state: { dataUrl: item.dataUrl, source: 'history' } })
                  }
                }}
              />
            ))}
          </div>
        )}
      </section>

      {showRecorder && <VideoRecorder onClose={() => setShowRecorder(false)} />}
    </div>
  )
}

/* ── Capture Card ── */

function CaptureCard({ item, onOpen }: { item: HistoryItem; onOpen: () => void }) {
  const isUploaded = item.uploads.some(u => u.success)

  return (
    <div className="group cursor-pointer" onClick={onOpen}>
      <div className="aspect-video bg-slate-900/50 rounded-xl overflow-hidden relative border border-white/5 group-hover:border-primary/30 transition-all">
        {item.dataUrl ? (
          <img
            src={item.dataUrl}
            className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="material-symbols-outlined text-slate-700 text-2xl">
              {item.type === 'recording' ? 'videocam' : 'image'}
            </span>
          </div>
        )}

        {/* Type badge */}
        {item.type === 'recording' && (
          <span className="absolute top-2 left-2 text-[9px] font-bold uppercase tracking-wider text-tertiary bg-tertiary/15 backdrop-blur-sm px-2 py-0.5 rounded-md border border-tertiary/20">
            Video
          </span>
        )}

        {/* Upload status */}
        {isUploaded && (
          <span className="absolute top-2 right-2 text-[9px] font-bold uppercase tracking-wider text-secondary bg-secondary/15 backdrop-blur-sm px-2 py-0.5 rounded-md border border-secondary/20">
            Synced
          </span>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
          <span className="p-1.5 glass-refractive rounded-lg text-white/80 hover:text-white transition-colors">
            <span className="material-symbols-outlined text-sm">open_in_new</span>
          </span>
        </div>
      </div>

      <div className="mt-2.5 px-0.5">
        <p
          className="text-[13px] font-semibold text-white truncate"
          style={{ fontFamily: 'Manrope, sans-serif' }}
        >
          {item.name}
        </p>
        <p className="text-[11px] text-slate-500 mt-0.5">{relativeTime(item.timestamp)}</p>
      </div>
    </div>
  )
}
