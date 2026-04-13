import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { HistoryItem } from '../../types'
import VideoRecorder from '../../components/VideoRecorder'
import { UpdateNotification } from '../../components/UpdateNotification'

type CaptureMode = 'region' | 'window' | 'fullscreen' | 'active-monitor'
type FilterType = 'all' | 'screenshot' | 'recording'

const isMac = navigator.platform.startsWith('Mac')

// Map capture mode → hotkey action name (from electron/hotkeys.ts)
const MODE_ACTION: Record<CaptureMode, string> = {
  region: 'RectangleRegion',
  window: 'ActiveWindow',
  fullscreen: 'PrintScreen',
  'active-monitor': 'ActiveMonitor',
}

const CAPTURE_MODES: { mode: CaptureMode; icon: string; label: string }[] = [
  { mode: 'region',         icon: 'crop',            label: 'Region' },
  { mode: 'window',         icon: 'web_asset',       label: 'Window' },
  { mode: 'fullscreen',     icon: 'desktop_windows', label: 'Fullscreen' },
  { mode: 'active-monitor', icon: 'monitor',         label: 'Active Screen' },
]

/** Parse an Electron accelerator string like "Ctrl+Shift+4" into display keys */
function parseShortcut(accel: string): string[] {
  return accel.split('+').map(k => {
    if (isMac) {
      if (k === 'Ctrl' || k === 'CommandOrControl' || k === 'CmdOrCtrl') return '⌘'
      if (k === 'Command' || k === 'Cmd') return '⌘'
      if (k === 'Alt' || k === 'Option') return '⌥'
    } else {
      if (k === 'CommandOrControl' || k === 'CmdOrCtrl') return 'Ctrl'
    }
    return k
  })
}

function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-0.5 mt-1">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="min-w-[20px] h-5 inline-flex items-center justify-center text-[10px] text-slate-400 font-medium bg-white/[0.06] border border-white/[0.08] rounded px-1 leading-none"
          style={{ fontFamily: 'Inter, sans-serif' }}
        >
          {k}
        </kbd>
      ))}
    </span>
  )
}

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
  const [filter, setFilter] = useState<FilterType>('all')
  const [searchFocused, setSearchFocused] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const [hotkeys, setHotkeys] = useState<Record<string, string>>({})

  useEffect(() => {
    window.electronAPI?.getHistory().then(items => setRecentItems(items.slice(0, 12)))
    window.electronAPI?.getHotkeys().then(h => { if (h) setHotkeys(h) })

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

  // ⌘K / Ctrl+K to focus search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  const filtered = recentItems.filter(item => {
    if (filter !== 'all' && item.type !== filter) return false
    if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

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
      <section className="grid grid-cols-2 gap-6">
        {/* Screenshot group */}
        <div>
          <div className="flex items-center gap-2 mb-2.5 px-0.5">
            <span className="material-symbols-outlined text-primary text-[15px]">photo_camera</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Screenshot
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {CAPTURE_MODES.map(({ mode, icon, label }) => {
              const accel = hotkeys[MODE_ACTION[mode]]
              const keys = accel ? parseShortcut(accel) : []
              return (
                <button
                  key={mode}
                  onClick={() => handleCapture(mode)}
                  className="group flex items-center gap-3 px-3 py-3 rounded-xl
                             bg-white/[0.03] border border-white/[0.05]
                             hover:bg-primary/[0.08] hover:border-primary/20
                             active:scale-[0.98] transition-all duration-200 cursor-pointer"
                >
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0
                                  group-hover:bg-primary/20 transition-colors duration-200">
                    <span className="material-symbols-outlined text-primary text-lg">{icon}</span>
                  </div>
                  <div className="text-left min-w-0">
                    <span
                      className="block text-xs font-semibold text-slate-200 group-hover:text-white transition-colors"
                      style={{ fontFamily: 'Manrope, sans-serif' }}
                    >
                      {label}
                    </span>
                    {keys.length > 0 && <KeyCombo keys={keys} />}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Video group */}
        <div>
          <div className="flex items-center gap-2 mb-2.5 px-0.5">
            <span className="material-symbols-outlined text-tertiary text-[15px]">videocam</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Video
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={() => setShowRecorder(true)}
              className="group flex items-center gap-3 px-3 py-3 rounded-xl
                         bg-white/[0.03] border border-white/[0.05]
                         hover:bg-tertiary/[0.08] hover:border-tertiary/20
                         active:scale-[0.98] transition-all duration-200 cursor-pointer"
            >
              <div className="w-9 h-9 rounded-lg bg-tertiary/10 flex items-center justify-center flex-shrink-0
                              group-hover:bg-tertiary/20 transition-colors duration-200">
                <span className="material-symbols-outlined text-tertiary text-lg">fiber_manual_record</span>
              </div>
              <div className="text-left min-w-0">
                <span
                  className="block text-xs font-semibold text-slate-200 group-hover:text-white transition-colors"
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  Record Screen
                </span>
                {hotkeys.ScreenRecorder && <KeyCombo keys={parseShortcut(hotkeys.ScreenRecorder)} />}
              </div>
            </button>
            <button
              onClick={() => setShowRecorder(true)}
              className="group flex items-center gap-3 px-3 py-3 rounded-xl
                         bg-white/[0.03] border border-white/[0.05]
                         hover:bg-tertiary/[0.08] hover:border-tertiary/20
                         active:scale-[0.98] transition-all duration-200 cursor-pointer"
            >
              <div className="w-9 h-9 rounded-lg bg-tertiary/10 flex items-center justify-center flex-shrink-0
                              group-hover:bg-tertiary/20 transition-colors duration-200">
                <span className="material-symbols-outlined text-tertiary text-lg">gif_box</span>
              </div>
              <div className="text-left min-w-0">
                <span
                  className="block text-xs font-semibold text-slate-200 group-hover:text-white transition-colors"
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  Record GIF
                </span>
                {hotkeys.ScreenRecorderGIF && <KeyCombo keys={parseShortcut(hotkeys.ScreenRecorderGIF)} />}
              </div>
            </button>
          </div>
        </div>
      </section>

      {/* ── Recent Captures ── */}
      <section>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <h2
              className="text-lg font-bold text-white"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              Recent
            </h2>

            {/* Filter tabs — same style as History */}
            <div className="flex items-center gap-1.5">
              {([
                { key: 'all' as const, label: 'All' },
                { key: 'screenshot' as const, label: 'Screenshots' },
                { key: 'recording' as const, label: 'Recordings' },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all ${
                    filter === key
                      ? 'primary-gradient text-slate-900'
                      : 'bg-white/5 text-slate-500 hover:text-white border border-white/5'
                  }`}
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {recentItems.length > 0 && (
              <div
                className={`flex items-center px-3 py-1.5 rounded-xl transition-all duration-300 ${
                  searchFocused
                    ? 'bg-white/[0.08] border border-primary/30 w-52 shadow-[0_0_20px_rgba(182,160,255,0.08)]'
                    : 'bg-white/[0.03] border border-white/[0.06] w-40 hover:bg-white/[0.06] hover:border-white/10'
                }`}
              >
                <span className={`material-symbols-outlined text-[16px] transition-colors ${searchFocused ? 'text-primary' : 'text-slate-500'}`}>search</span>
                <input
                  ref={searchRef}
                  className="bg-transparent border-none outline-none text-xs w-full placeholder-slate-600 text-white ml-2"
                  placeholder="Search..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                />
                {search ? (
                  <button onClick={() => setSearch('')} className="text-slate-500 hover:text-white transition-colors flex-shrink-0">
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                ) : !searchFocused && (
                  <kbd className="flex-shrink-0 text-[10px] text-slate-600 font-medium bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded-md">⌘K</kbd>
                )}
              </div>
            )}
            <button
              onClick={() => navigate('/history', { state: { search, filter } })}
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
