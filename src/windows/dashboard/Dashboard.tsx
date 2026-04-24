import { useState, useEffect, useMemo, useCallback, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { HistoryItem } from '../../types'
import ScrollCaptureDialog from '../../components/ScrollCaptureDialog'
import { UpdateNotification } from '../../components/UpdateNotification'
import { DateGroupedGrid } from '../../components/DateGroupedGrid'
import { HistoryListRow } from '../../components/HistoryListRow'
import { copyHistoryItem, shareHistoryItem } from '../../lib/history-actions'

type CaptureMode = 'region' | 'window' | 'fullscreen' | 'active-monitor' | 'scrolling'
type VideoMode = 'region' | 'window' | 'screen'
type MediaKind = 'image' | 'video'
type FilterType = 'all' | 'screenshot' | 'recording'
type ViewMode = 'grid' | 'list'

// Map capture mode → hotkey action name (from electron/hotkeys.ts)
const MODE_ACTION: Record<CaptureMode, string> = {
  region: 'RectangleRegion',
  window: 'ActiveWindow',
  fullscreen: 'PrintScreen',
  'active-monitor': 'ActiveMonitor',
  scrolling: 'ScrollingCapture',
}

const VIDEO_MODE_ACTION: Record<VideoMode, string> = {
  region: 'ScreenRecorder',
  window: 'ScreenRecorderWindow',
  screen: 'ScreenRecorderScreen',
}

const CAPTURE_MODES: { mode: CaptureMode; icon: string; label: string }[] = [
  { mode: 'region',         icon: 'crop',            label: 'Region' },
  { mode: 'window',         icon: 'web_asset',       label: 'Window' },
  { mode: 'active-monitor', icon: 'monitor',         label: 'Screen' },
  { mode: 'fullscreen',     icon: 'tv_displays',     label: 'All Screens' },
]

const VIDEO_MODES: { mode: VideoMode; icon: string; label: string }[] = [
  { mode: 'region', icon: 'crop',      label: 'Region' },
  { mode: 'window', icon: 'web_asset', label: 'Window' },
  { mode: 'screen', icon: 'monitor',   label: 'Screen' },
]

/** Parse an Electron accelerator string like "Ctrl+Shift+4" into display keys */
function parseShortcut(accel: string): string[] {
  return accel.split('+').map(k => {
    if (k === 'CommandOrControl' || k === 'CmdOrCtrl') return 'Ctrl'
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

export default function Dashboard() {
  const navigate = useNavigate()
  const [recentItems, setRecentItems] = useState<HistoryItem[]>([])
  const [showScrollCapture, setShowScrollCapture] = useState(false)
  const [filter, setFilter] = useState<FilterType>('all')
  const [hotkeys, setHotkeys] = useState<Record<string, string>>({})
  const [mediaKind, setMediaKind] = useState<MediaKind>('image')
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    (localStorage.getItem('lumia:history-view') as ViewMode) || 'grid'
  )
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [sharingId, setSharingId] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI?.getHistory().then(setRecentItems)
    window.electronAPI?.getHotkeys().then(h => { if (h) setHotkeys(h) })
    window.electronAPI?.getSettings().then(s => {
      if (s?.lastCaptureKind === 'video' || s?.lastCaptureKind === 'image') {
        setMediaKind(s.lastCaptureKind)
      }
    })

    window.electronAPI?.onCaptureReady(({ dataUrl, source }) => {
      navigate('/editor', { state: { dataUrl, source } })
    })

    // Record Screen hotkey → launch new overlay-based video flow (region mode default).
    window.electronAPI?.onRecorderOpen(() => window.electronAPI?.startVideoCapture?.('region'))
    window.electronAPI?.onScrollCaptureOpen(() => setShowScrollCapture(true))

    return () => {
      window.electronAPI?.removeAllListeners('capture:ready')
      window.electronAPI?.removeAllListeners('recorder:open')
      window.electronAPI?.removeAllListeners('scroll-capture:open')
    }
  }, [navigate])

  const selectMediaKind = (kind: MediaKind) => {
    setMediaKind(kind)
    window.electronAPI?.setSetting('lastCaptureKind', kind)
  }

  const handleCapture = async (mode: CaptureMode) => {
    window.electronAPI?.setSetting('lastCaptureKind', 'image')
    window.electronAPI?.setSetting('lastImageMode', mode)
    if (mode === 'scrolling') {
      await window.electronAPI?.startScrollCapture()
    } else if (mode === 'region') {
      await window.electronAPI?.captureScreenshot('region')
    } else {
      const dataUrl = await window.electronAPI?.captureScreenshot(mode) as string
      if (dataUrl) navigate('/editor', { state: { dataUrl, source: mode } })
    }
  }

  const handleVideo = (mode: VideoMode) => {
    window.electronAPI?.setSetting('lastCaptureKind', 'video')
    window.electronAPI?.setSetting('lastVideoMode', mode)
    window.electronAPI?.startVideoCapture?.(mode)
  }

  const screenshots = recentItems.filter(i => i.type === 'screenshot')
  const recordings = recentItems.filter(i => i.type === 'recording')

  const counts = useMemo(() => ({
    all: recentItems.length,
    screenshot: screenshots.length,
    recording: recordings.length,
  }), [recentItems, screenshots.length, recordings.length])

  const filtered = useMemo(() => {
    const result = filter === 'all' ? recentItems : recentItems.filter(i => i.type === filter)
    return [...result].sort((a, b) => b.timestamp - a.timestamp)
  }, [recentItems, filter])

  const handleDelete = async (id: string) => {
    await window.electronAPI?.deleteHistoryItem(id)
    setRecentItems(prev => prev.filter(i => i.id !== id))
    setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next })
  }

  const handleBulkDelete = async () => {
    if (isBulkDeleting) return
    const ids = [...selectedIds]
    if (ids.length === 0) return
    setIsBulkDeleting(true)
    try {
      await Promise.all(ids.map(id => window.electronAPI?.deleteHistoryItem(id)))
      setRecentItems(prev => prev.filter(i => !selectedIds.has(i.id)))
      setSelectedIds(new Set())
      setIsSelecting(false)
    } finally {
      setIsBulkDeleting(false)
    }
  }

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const exitSelection = () => {
    setIsSelecting(false)
    setSelectedIds(new Set())
  }

  // Refresh `recentItems` — used after a race where a file disappears between
  // the boot-time fs.access probe and the user's click, so the UI flips from
  // "clickable" to orphan state on the next interaction.
  const refreshHistory = useCallback(async () => {
    const items = await window.electronAPI?.getHistory()
    if (items) setRecentItems(items)
  }, [])

  const openItem = async (item: HistoryItem) => {
    if (item.fileMissing) return
    if (item.type === 'recording') {
      navigate('/editor', { state: { kind: 'video', filePath: item.filePath, name: item.name, historyId: item.id, annotations: item.annotations } })
      return
    }
    // Load the ORIGINAL file — annotations ride along as vector data and
    // Canvas replays each one as its own commit so Undo walks back through
    // them one at a time.
    let dataUrl: string | null | undefined = item.dataUrl
    if (!dataUrl && item.filePath) {
      dataUrl = await window.electronAPI?.readHistoryFile(item.filePath) ?? null
      if (dataUrl === null) { await refreshHistory(); return }
    }
    if (!dataUrl) return
    navigate('/editor', { state: { kind: 'image', dataUrl, source: 'history', historyId: item.id, annotations: item.annotations } })
  }

  const copyItem = (item: HistoryItem) => copyHistoryItem(item, refreshHistory)

  const shareItem = async (item: HistoryItem) => {
    if (sharingId) return
    setSharingId(item.id)
    try {
      await shareHistoryItem(item, refreshHistory)
    } finally {
      setSharingId(null)
    }
  }

  const missingCount = useMemo(() => recentItems.filter(i => i.fileMissing).length, [recentItems])
  const handleCleanupMissing = useCallback(async () => {
    const removed = await window.electronAPI?.cleanupMissingHistory()
    if (removed && removed > 0) await refreshHistory()
  }, [refreshHistory])

  // Persist view mode
  useEffect(() => {
    localStorage.setItem('lumia:history-view', viewMode)
  }, [viewMode])

  // Ctrl/Cmd+A to select all when in selecting mode; Escape to exit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSelecting) {
        setIsSelecting(false)
        setSelectedIds(new Set())
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && isSelecting) {
        e.preventDefault()
        setSelectedIds(new Set(filtered.map(i => i.id)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isSelecting, filtered])

  return (
    <div className="h-full flex flex-col">
      <div className="px-8 pt-8 space-y-8 flex-shrink-0">

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
      <section>
        {/* Media kind toggle */}
        <div className="flex items-center justify-between mb-4">
          <MediaKindToggle value={mediaKind} onChange={selectMediaKind} />
        </div>

        {mediaKind === 'image' ? (
          <div className="flex flex-wrap gap-2">
            {CAPTURE_MODES.map(({ mode, icon, label }) => {
              const accel = hotkeys[MODE_ACTION[mode]]
              const keys = accel ? parseShortcut(accel) : []
              return (
                <button
                  key={mode}
                  onClick={() => handleCapture(mode)}
                  className="group w-44 flex items-center gap-3 px-3 py-3 rounded-xl
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
                      className="block text-xs font-semibold text-slate-200 group-hover:text-white transition-colors truncate"
                      style={{ fontFamily: 'Manrope, sans-serif' }}
                    >
                      {label}
                    </span>
                    {keys.length > 0 && <KeyCombo keys={keys} />}
                  </div>
                </button>
              )
            })}
            <button
              onClick={() => handleCapture('scrolling')}
              className="group w-44 flex items-center gap-3 px-3 py-3 rounded-xl
                         bg-white/[0.03] border border-white/[0.05]
                         hover:bg-primary/[0.08] hover:border-primary/20
                         active:scale-[0.98] transition-all duration-200 cursor-pointer"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0
                              group-hover:bg-primary/20 transition-colors duration-200">
                <span className="material-symbols-outlined text-primary text-lg">swipe_down</span>
              </div>
              <div className="text-left min-w-0">
                <span
                  className="block text-xs font-semibold text-slate-200 group-hover:text-white transition-colors truncate"
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  Scrolling
                </span>
                {hotkeys.ScrollingCapture && <KeyCombo keys={parseShortcut(hotkeys.ScrollingCapture)} />}
              </div>
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {VIDEO_MODES.map(({ mode, icon, label }) => {
              const hotkey = hotkeys[VIDEO_MODE_ACTION[mode]]
              return (
                <button
                  key={mode}
                  onClick={() => handleVideo(mode)}
                  className="group w-44 flex items-center gap-3 px-3 py-3 rounded-xl
                             bg-white/[0.03] border border-white/[0.05]
                             hover:bg-tertiary/[0.08] hover:border-tertiary/20
                             active:scale-[0.98] transition-all duration-200 cursor-pointer"
                >
                  <div className="w-9 h-9 rounded-lg bg-tertiary/10 flex items-center justify-center flex-shrink-0
                                  group-hover:bg-tertiary/20 transition-colors duration-200">
                    <span className="material-symbols-outlined text-tertiary text-lg">{icon}</span>
                  </div>
                  <div className="text-left min-w-0">
                    <span
                      className="block text-xs font-semibold text-slate-200 group-hover:text-white transition-colors truncate"
                      style={{ fontFamily: 'Manrope, sans-serif' }}
                    >
                      {label}
                    </span>
                    {hotkey && <KeyCombo keys={parseShortcut(hotkey)} />}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>

      </div>

      {/* ── Recent / History ── */}
      <section className="flex-1 min-h-0 flex flex-col px-8 pt-8 pb-8">
        <div className="flex items-center justify-between mb-4 flex-shrink-0 gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <h2
              className="text-lg font-bold text-white"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              Recent
            </h2>

            {/* Filter tabs */}
            <div className="flex items-center gap-1.5">
              {([
                { key: 'all' as const, label: `All (${counts.all})` },
                { key: 'screenshot' as const, label: `Screenshots (${counts.screenshot})` },
                { key: 'recording' as const, label: `Recordings (${counts.recording})` },
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

          {/* Right controls share the filter-pill visual language so heights
               and paddings line up across the whole toolbar. */}
          <div className="flex items-center gap-1.5">
            {/* View toggle — segmented button group so the two options read
                 as one control instead of separate pills. */}
            <div className="h-[25px] inline-flex items-center rounded-full bg-white/5 border border-white/5 overflow-hidden">
              {([
                { key: 'grid' as const, icon: 'view_module', label: 'Grid' },
                { key: 'list' as const, icon: 'list', label: 'List' },
              ]).map(({ key, icon, label }) => (
                <button
                  key={key}
                  onClick={() => setViewMode(key)}
                  className={`h-full inline-flex items-center gap-1 px-3 text-[10px] font-bold uppercase tracking-wider leading-none transition-all ${
                    viewMode === key
                      ? 'primary-gradient text-slate-900'
                      : 'text-slate-500 hover:text-white hover:bg-white/5'
                  }`}
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                  title={label}
                >
                  <span className="material-symbols-outlined text-[8px]">{icon}</span>
                  {label}
                </button>
              ))}
            </div>

            {/* Cleanup missing — only visible when orphans exist. Amber tone
                 to flag it as destructive-ish, same pill size as siblings. */}
            {missingCount > 0 && (
              <button
                onClick={handleCleanupMissing}
                className="h-[25px] inline-flex items-center gap-1 px-3 rounded-full text-[10px] font-bold uppercase tracking-wider leading-none bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 transition-all"
                style={{ fontFamily: 'Manrope, sans-serif' }}
                title="Remove history entries whose files no longer exist"
              >
                <span className="material-symbols-outlined text-[8px]">cleaning_services</span>
                Clean {missingCount}
              </button>
            )}

            {/* Select toggle */}
            <button
              onClick={() => isSelecting ? exitSelection() : setIsSelecting(true)}
              className={`h-[25px] inline-flex items-center gap-1 px-3 rounded-full text-[10px] font-bold uppercase tracking-wider leading-none transition-all ${
                isSelecting
                  ? 'primary-gradient text-slate-900'
                  : 'bg-white/5 text-slate-500 hover:text-white border border-white/5'
              }`}
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              <span className="material-symbols-outlined text-[8px]">checklist</span>
              Select
            </button>
          </div>
        </div>

        {/* Selection toolbar — always visible while selecting so the count
             (and exit button) never disappear even with nothing selected. */}
        {isSelecting && (
          <div className="flex items-center justify-between px-4 py-2 mb-3 bg-primary/5 border border-primary/10 rounded-xl flex-shrink-0">
            <span className="text-xs font-semibold text-primary" style={{ fontFamily: 'Manrope, sans-serif' }}>
              {selectedIds.size} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0 || isBulkDeleting}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-500/10"
                style={{ fontFamily: 'Manrope, sans-serif' }}
              >
                {isBulkDeleting ? (
                  <div className="w-3 h-3 rounded-full border-2 border-red-400 border-t-transparent animate-spin" />
                ) : (
                  <span className="material-symbols-outlined text-sm">delete</span>
                )}
                {isBulkDeleting ? 'Deleting…' : 'Delete'}
              </button>
              <button
                onClick={exitSelection}
                disabled={isBulkDeleting}
                className="px-3 py-1 rounded-lg text-xs font-semibold text-slate-400 hover:text-white bg-white/5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ fontFamily: 'Manrope, sans-serif' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
          {viewMode === 'grid' ? (
            <DateGroupedGrid
              items={filtered}
              getTimestamp={item => item.timestamp}
              gridClassName="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3"
              renderItem={(item) => (
                <HistoryCard
                  key={item.id}
                  item={item}
                  isSelecting={isSelecting}
                  isSelected={selectedIds.has(item.id)}
                  isSharing={sharingId === item.id}
                  onToggleSelect={() => toggleSelect(item.id)}
                  onOpen={() => openItem(item)}
                  onDelete={() => handleDelete(item.id)}
                  onCopy={() => copyItem(item)}
                  onShare={() => shareItem(item)}
                />
              )}
              emptyState={<EmptyState filter={filter} />}
            />
          ) : (
            <DateGroupedGrid
              items={filtered}
              getTimestamp={item => item.timestamp}
              gridClassName="flex flex-col gap-1"
              renderItem={(item) => (
                <HistoryListRow
                  key={item.id}
                  item={item}
                  isSelecting={isSelecting}
                  isSelected={selectedIds.has(item.id)}
                  isSharing={sharingId === item.id}
                  onToggleSelect={() => toggleSelect(item.id)}
                  onOpen={() => openItem(item)}
                  onDelete={() => handleDelete(item.id)}
                  onCopy={() => copyItem(item)}
                  onShare={() => shareItem(item)}
                />
              )}
              emptyState={<EmptyState filter={filter} />}
            />
          )}
        </div>
      </section>

      {showScrollCapture && <ScrollCaptureDialog onClose={() => setShowScrollCapture(false)} />}
    </div>
  )
}

/* ── Media Kind Toggle ── */

function MediaKindToggle({ value, onChange }: { value: MediaKind; onChange: (v: MediaKind) => void }) {
  const options: { kind: MediaKind; icon: string; label: string; activeBg: string; activeBorder: string; activeIcon: string }[] = [
    {
      kind: 'image',
      icon: 'photo_camera',
      label: 'Image',
      activeBg: 'bg-primary/15',
      activeBorder: 'border-primary/25',
      activeIcon: 'text-primary',
    },
    {
      kind: 'video',
      icon: 'videocam',
      label: 'Video',
      activeBg: 'bg-tertiary/15',
      activeBorder: 'border-tertiary/25',
      activeIcon: 'text-tertiary',
    },
  ]
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/10">
      {options.map(({ kind, icon, label, activeBg, activeBorder, activeIcon }) => {
        const active = value === kind
        return (
          <button
            key={kind}
            onClick={() => onChange(kind)}
            className={`group flex items-center gap-2 px-3.5 py-1.5 rounded-lg transition-all duration-200 cursor-pointer border ${
              active
                ? `${activeBg} ${activeBorder} shadow-[0_0_16px_rgba(0,0,0,0.2)]`
                : 'border-transparent hover:bg-white/[0.06] hover:border-white/20'
            }`}
          >
            <span
              className={`material-symbols-outlined text-[16px] transition-colors ${
                active ? activeIcon : 'text-slate-500 group-hover:text-slate-300'
              }`}
            >
              {icon}
            </span>
            <span
              className={`text-xs font-semibold transition-colors ${
                active ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
              }`}
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              {label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ── Empty State ── */

function EmptyState({ filter }: { filter: FilterType }) {
  const icon = filter === 'recording' ? 'videocam_off' : filter === 'screenshot' ? 'hide_image' : 'history'
  const message = filter !== 'all'
    ? `No ${filter === 'screenshot' ? 'screenshots' : 'recordings'} yet`
    : 'No captures yet'

  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="p-5 rounded-2xl bg-white/5 mb-5">
        <span className="material-symbols-outlined text-4xl text-slate-600">{icon}</span>
      </div>
      <p className="text-sm font-semibold text-slate-400" style={{ fontFamily: 'Manrope, sans-serif' }}>
        {message}
      </p>
    </div>
  )
}

/* ── History Card (Grid View) ── */

function HistoryCard({
  item, isSelecting, isSelected, isSharing, onToggleSelect, onOpen, onDelete, onCopy, onShare,
}: {
  item: HistoryItem
  isSelecting: boolean
  isSelected: boolean
  isSharing: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onDelete: () => void
  onCopy: () => void
  onShare: () => void
}) {
  const date = new Date(item.timestamp).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const isUploaded = item.uploads?.some(u => u.success)
  const googleUrl = item.uploads?.find(u => u.destination === 'google-drive' && u.success && u.url)?.url
  const missing = item.fileMissing

  const stop = (fn: () => void) => (e: ReactMouseEvent) => { e.stopPropagation(); fn() }

  return (
    <div
      className={`group glass-card rounded-lg transition-all duration-300 relative ${
        missing && !isSelecting ? 'opacity-50' : ''
      } ${
        missing ? 'cursor-default' : 'cursor-pointer'
      } ${
        isSelected ? 'ring-2 ring-primary/50' : ''
      }`}
      onClick={isSelecting ? onToggleSelect : (missing ? undefined : onOpen)}
      title={missing ? 'File no longer exists on disk' : undefined}
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-slate-950 relative overflow-hidden rounded-t-lg">
        {(item.thumbnailUrl ?? item.dataUrl) ? (
          <img src={item.thumbnailUrl ?? item.dataUrl} className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500 opacity-90 group-hover:opacity-100" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="material-symbols-outlined text-slate-700 text-4xl">{item.type === 'recording' ? 'videocam' : 'image'}</span>
          </div>
        )}

        {/* Selection checkbox */}
        {isSelecting && (
          <div className="absolute top-2 left-2 z-10">
            <button
              onClick={stop(onToggleSelect)}
              className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all border ${
                isSelected
                  ? 'bg-primary border-primary text-slate-900'
                  : 'bg-black/40 border-white/20 backdrop-blur-md hover:border-primary/40'
              }`}
            >
              {isSelected && <span className="material-symbols-outlined text-xs">check</span>}
            </button>
          </div>
        )}

        {/* Video badge. Hardcoded pink so light theme doesn't render dark purple. */}
        {item.type === 'recording' && !isSelecting && (
          <span
            className="absolute top-2 left-2 z-10 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border backdrop-blur-sm"
            style={{
              color: '#ec4899',
              backgroundColor: 'color-mix(in oklab, #ec4899 20%, transparent)',
              borderColor: 'color-mix(in oklab, #ec4899 35%, transparent)',
            }}
          >
            Video
          </span>
        )}

        {/* Synced badge */}
        {isUploaded && !isSelecting && !missing && (
          <span
            className="absolute top-2 right-2 z-10 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border backdrop-blur-sm"
            style={{
              color: 'var(--color-secondary)',
              backgroundColor: 'color-mix(in oklab, var(--color-secondary) 18%, transparent)',
              borderColor: 'color-mix(in oklab, var(--color-secondary) 30%, transparent)',
            }}
          >
            Synced
          </span>
        )}

        {/* Missing file badge */}
        {missing && !isSelecting && (
          <span className="absolute top-2 right-2 z-10 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border backdrop-blur-sm text-amber-300 bg-amber-500/20 border-amber-400/30">
            Missing
          </span>
        )}

        {/* Play button overlay for recordings */}
        {item.type === 'recording' && !isSelecting && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20">
              <span className="material-symbols-outlined text-white text-2xl ml-0.5">play_arrow</span>
            </div>
          </div>
        )}

        {/* Hover overlay — unified action set for image + video. Orphan
             cards collapse to Delete only so users prune without chasing
             dead links. */}
        {!isSelecting && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-center pb-3 gap-2 z-10">
            {!missing && (
              <>
                <OvlBtn icon="edit" label="Edit" tint="blue" onClick={stop(onOpen)} />
                <OvlBtn icon="content_copy" label="Copy" tint="emerald" onClick={stop(onCopy)} />
                <OvlBtn icon={isSharing ? 'sync' : 'share'} label={isSharing ? 'Sharing…' : 'Share'} tint="sky" onClick={stop(onShare)} spinning={isSharing} />
                {googleUrl && (
                  <OvlBtn icon="cloud" label="Open Google link" tint="amber" onClick={stop(() => window.electronAPI?.openExternal(googleUrl))} />
                )}
              </>
            )}
            <OvlBtn icon="delete" label="Delete" tint="red" onClick={stop(onDelete)} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="text-xs font-bold text-white truncate mb-1" style={{ fontFamily: 'Manrope, sans-serif' }}>{item.name}</p>
        <p className="text-[10px] text-slate-500 font-medium">{date}</p>
      </div>
    </div>
  )
}

// Pre-enumerated so Tailwind's JIT picks up each class combination at build
// time — constructing class names via template strings gets purged.
const OVL_TINTS: Record<OvlTint, string> = {
  blue:    'bg-white/10 text-white/70 hover:bg-blue-500/30 hover:text-blue-300',
  emerald: 'bg-white/10 text-white/70 hover:bg-emerald-500/30 hover:text-emerald-300',
  sky:     'bg-white/10 text-white/70 hover:bg-sky-500/30 hover:text-sky-300',
  amber:   'bg-white/10 text-white/70 hover:bg-amber-500/30 hover:text-amber-300',
  red:     'bg-white/10 text-white/70 hover:bg-red-500/30 hover:text-red-300',
}
type OvlTint = 'blue' | 'emerald' | 'sky' | 'amber' | 'red'

function OvlBtn({ icon, label, onClick, tint, spinning }: { icon: string; label: string; onClick: (e: ReactMouseEvent) => void; tint: OvlTint; spinning?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={spinning}
      className={`w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-sm transition-all duration-200 disabled:opacity-60 ${OVL_TINTS[tint]}`}
      title={label}
    >
      <span className={`material-symbols-outlined text-[16px] ${spinning ? 'animate-spin' : ''}`}>{icon}</span>
    </button>
  )
}

