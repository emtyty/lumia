import { useState, useEffect, useMemo, useCallback, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { HistoryItem } from '../../types'
import { useLocalVideoUrl } from '../../hooks/useLocalVideoUrl'
import { DateGroupedGrid } from '../../components/DateGroupedGrid'
import { HistoryListRow } from './HistoryListRow'

type FilterType = 'all' | 'screenshot' | 'recording'
type SortKey = 'newest' | 'oldest' | 'name' | 'size'
type ViewMode = 'grid' | 'list'

export default function History() {
  const navigate = useNavigate()
  const location = useLocation()
  const navState = location.state as { search?: string; filter?: FilterType } | null
  const [items, setItems] = useState<HistoryItem[]>([])
  const [search, setSearch] = useState(navState?.search ?? '')
  const [filter, setFilter] = useState<FilterType>(navState?.filter ?? 'all')
  const [sortBy, setSortBy] = useState<SortKey>('newest')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    (localStorage.getItem('lumia:history-view') as ViewMode) || 'grid'
  )
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [previewItem, setPreviewItem] = useState<HistoryItem | null>(null)
  const [searchFocused, setSearchFocused] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.electronAPI?.getHistory().then(setItems)
  }, [])

  // Persist view mode
  useEffect(() => {
    localStorage.setItem('lumia:history-view', viewMode)
  }, [viewMode])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isSelecting) {
          setIsSelecting(false)
          setSelectedIds(new Set())
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && isSelecting) {
        e.preventDefault()
        setSelectedIds(new Set(filtered.map(i => i.id)))
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isSelecting])

  const counts = useMemo(() => ({
    all: items.length,
    screenshot: items.filter(i => i.type === 'screenshot').length,
    recording: items.filter(i => i.type === 'recording').length,
  }), [items])

  const filtered = useMemo(() => {
    let result = items
    if (filter !== 'all') result = result.filter(i => i.type === filter)
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(i => i.name.toLowerCase().includes(q))
    }
    return [...result].sort((a, b) => {
      if (sortBy === 'newest') return b.timestamp - a.timestamp
      if (sortBy === 'oldest') return a.timestamp - b.timestamp
      if (sortBy === 'name')   return a.name.localeCompare(b.name)
      if (sortBy === 'size')   return (b.size ?? 0) - (a.size ?? 0)
      return 0
    })
  }, [items, filter, search, sortBy])

  const totalSize = items.reduce((acc, i) => acc + (i.size ?? 0), 0)
  const formatSize = (bytes: number) => bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : bytes > 1e3 ? `${(bytes / 1e3).toFixed(0)} KB` : `${bytes} B`

  const handleDelete = async (id: string) => {
    await window.electronAPI?.deleteHistoryItem(id)
    setItems(prev => prev.filter(i => i.id !== id))
    setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next })
  }

  const handleBulkDelete = async () => {
    const ids = [...selectedIds]
    await Promise.all(ids.map(id => window.electronAPI?.deleteHistoryItem(id)))
    setItems(prev => prev.filter(i => !selectedIds.has(i.id)))
    setSelectedIds(new Set())
    setIsSelecting(false)
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

  const isDateSort = sortBy === 'newest' || sortBy === 'oldest'

  const openItem = (item: HistoryItem) => {
    if (item.type === 'recording') {
      setPreviewItem(item)
    } else {
      navigate('/editor', { state: { dataUrl: item.dataUrl, source: 'history' } })
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-14 liquid-glass flex items-center justify-between px-6 flex-shrink-0 border-b border-white/5">
        <div className="min-w-0">
          <h1 className="text-sm font-bold text-white leading-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>History</h1>
          <p className="text-[11px] text-slate-500 leading-tight">{items.length} captures · {formatSize(totalSize)}</p>
        </div>

        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex bg-white/5 rounded-lg p-0.5 border border-white/5">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'}`}
            >
              <span className="material-symbols-outlined text-sm">grid_view</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'}`}
            >
              <span className="material-symbols-outlined text-sm">view_list</span>
            </button>
          </div>

          {/* Select toggle */}
          <button
            onClick={() => isSelecting ? exitSelection() : setIsSelecting(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              isSelecting ? 'bg-primary/20 text-primary' : 'bg-white/5 text-slate-400 hover:text-white'
            }`}
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            <span className="material-symbols-outlined text-sm">checklist</span>
            Select
          </button>
        </div>
      </header>

      {/* Selection toolbar */}
      {isSelecting && selectedIds.size > 0 && (
        <div className="h-10 flex items-center justify-between px-6 bg-primary/5 border-b border-primary/10 flex-shrink-0">
          <span className="text-xs font-semibold text-primary" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              <span className="material-symbols-outlined text-sm">delete</span>
              Delete
            </button>
            <button
              onClick={exitSelection}
              className="px-3 py-1 rounded-lg text-xs font-semibold text-slate-400 hover:text-white bg-white/5 transition-all"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Toolbar: search (left) | filters + sort (right) */}
      <div className="flex items-center justify-between px-6 py-3 flex-shrink-0">
        {/* Search (left side, slightly expands on focus) */}
        <div
          className={`flex items-center px-3 py-1.5 rounded-xl transition-all duration-300 ${
            searchFocused
              ? 'bg-white/[0.08] border border-primary/30 w-56 shadow-[0_0_20px_rgba(182,160,255,0.08)]'
              : 'bg-white/[0.03] border border-white/[0.06] w-44 hover:bg-white/[0.06] hover:border-white/10'
          }`}
        >
          <span className={`material-symbols-outlined text-[16px] transition-colors ${searchFocused ? 'text-primary' : 'text-slate-500'}`}>search</span>
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className="bg-transparent border-none outline-none text-[13px] w-full placeholder-slate-600 text-white ml-2"
            placeholder="Search..."
          />
          {search ? (
            <button onClick={() => setSearch('')} className="text-slate-500 hover:text-white transition-colors flex-shrink-0">
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          ) : !searchFocused && (
            <kbd className="flex-shrink-0 text-[10px] text-slate-600 font-medium bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded-md">⌘K</kbd>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          {/* Filter tabs */}
          {([
            { key: 'all' as const, label: `All (${counts.all})` },
            { key: 'screenshot' as const, label: `Screenshots (${counts.screenshot})` },
            { key: 'recording' as const, label: `Recordings (${counts.recording})` },
          ]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider transition-all ${
                filter === key
                  ? 'primary-gradient text-slate-900'
                  : 'bg-white/5 text-slate-400 hover:text-white border border-white/5'
              }`}
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              {label}
            </button>
          ))}

          {/* Sort dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowSortMenu(!showSortMenu)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 bg-white/5 hover:text-white transition-all"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              <span className="material-symbols-outlined text-sm">sort</span>
              <span className="capitalize">{sortBy}</span>
              <span className="material-symbols-outlined text-sm">expand_more</span>
            </button>
            {showSortMenu && (
              <>
                <div className="fixed inset-0 z-[55]" onClick={() => setShowSortMenu(false)} />
                <div className="absolute left-0 top-full mt-1 glass-refractive rounded-xl py-1 min-w-[120px] z-[60]">
                  {(['newest', 'oldest', 'name', 'size'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => { setSortBy(s); setShowSortMenu(false) }}
                      className={`w-full text-left px-4 py-2 text-xs font-medium transition-colors capitalize ${
                        sortBy === s ? 'text-primary' : 'text-slate-400 hover:text-white hover:bg-white/5'
                      }`}
                      style={{ fontFamily: 'Manrope, sans-serif' }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto hide-scrollbar">
        <div className="px-6 pb-10">
          {viewMode === 'grid' ? (
            <DateGroupedGrid
              items={filtered}
              getTimestamp={item => item.timestamp}
              flat={!isDateSort}
              gridClassName="grid grid-cols-3 gap-5"
              renderItem={(item) => (
                <HistoryCard
                  key={item.id}
                  item={item}
                  isSelecting={isSelecting}
                  isSelected={selectedIds.has(item.id)}
                  onToggleSelect={() => toggleSelect(item.id)}
                  onOpen={() => openItem(item)}
                  onAnnotate={() => navigate('/editor', { state: { kind: 'video', filePath: item.filePath, name: item.name } })}
                  onDelete={() => handleDelete(item.id)}
                  onOpenFile={() => item.filePath && window.electronAPI?.openHistoryFile(item.filePath)}
                  onCopy={() => item.type === 'screenshot' && item.dataUrl && window.electronAPI?.runWorkflow('builtin-clipboard', item.dataUrl)}
                />
              )}
              emptyState={<EmptyState search={search} filter={filter} onClear={() => setSearch('')} />}
            />
          ) : (
            <DateGroupedGrid
              items={filtered}
              getTimestamp={item => item.timestamp}
              flat={!isDateSort}
              gridClassName="flex flex-col gap-1"
              renderItem={(item) => (
                <HistoryListRow
                  key={item.id}
                  item={item}
                  isSelecting={isSelecting}
                  isSelected={selectedIds.has(item.id)}
                  onToggleSelect={() => toggleSelect(item.id)}
                  onOpen={() => openItem(item)}
                  onAnnotate={() => navigate('/editor', { state: { kind: 'video', filePath: item.filePath, name: item.name } })}
                  onDelete={() => handleDelete(item.id)}
                  onOpenFile={() => item.filePath && window.electronAPI?.openHistoryFile(item.filePath)}
                  onCopy={() => item.type === 'screenshot' && item.dataUrl && window.electronAPI?.runWorkflow('builtin-clipboard', item.dataUrl)}
                />
              )}
              emptyState={<EmptyState search={search} filter={filter} onClear={() => setSearch('')} />}
            />
          )}
        </div>
      </div>

      {previewItem && (
        <VideoPreviewModal
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onAnnotate={() => {
            setPreviewItem(null)
            navigate('/editor', { state: { kind: 'video', filePath: previewItem.filePath, name: previewItem.name } })
          }}
        />
      )}
    </div>
  )
}

/* ── Empty State ── */

function EmptyState({ search, filter, onClear }: { search: string; filter: FilterType; onClear: () => void }) {
  const icon = search ? 'search_off' : filter === 'recording' ? 'videocam_off' : filter === 'screenshot' ? 'hide_image' : 'history'
  const message = search
    ? `No captures match "${search}"`
    : filter !== 'all'
      ? `No ${filter === 'screenshot' ? 'screenshots' : 'recordings'} yet`
      : 'No captures yet'

  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="p-5 rounded-2xl bg-white/5 mb-5">
        <span className="material-symbols-outlined text-4xl text-slate-600">{icon}</span>
      </div>
      <p className="text-sm font-semibold text-slate-400 mb-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
        {message}
      </p>
      {search && (
        <button onClick={onClear} className="text-xs text-primary hover:underline font-medium">
          Clear search
        </button>
      )}
    </div>
  )
}

/* ── History Card (Grid View) ── */

function HistoryCard({
  item, isSelecting, isSelected, onToggleSelect, onOpen, onAnnotate, onDelete, onOpenFile, onCopy,
}: {
  item: HistoryItem
  isSelecting: boolean
  isSelected: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onAnnotate: () => void
  onDelete: () => void
  onOpenFile: () => void
  onCopy: () => void
}) {
  const date = new Date(item.timestamp).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const isUploaded = item.uploads?.some(u => u.success)
  const uploadUrl = item.uploads?.find(u => u.success && u.url)?.url

  const stop = (fn: () => void) => (e: ReactMouseEvent) => { e.stopPropagation(); fn() }

  return (
    <div
      className={`group glass-card rounded-2xl cursor-pointer transition-all duration-300 relative ${
        isSelected ? 'ring-2 ring-primary/50' : ''
      }`}
      onClick={isSelecting ? onToggleSelect : onOpen}
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-slate-950 relative overflow-hidden rounded-t-2xl">
        {item.dataUrl ? (
          <img src={item.dataUrl} className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500 opacity-90 group-hover:opacity-100" />
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

        {/* Play button overlay for recordings */}
        {item.type === 'recording' && !isSelecting && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20">
              <span className="material-symbols-outlined text-white text-2xl ml-0.5">play_arrow</span>
            </div>
          </div>
        )}

        {/* Hover overlay with actions */}
        {!isSelecting && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-center pb-3 gap-2 z-10">
            <OvlBtn icon={item.type === 'recording' ? 'draw' : 'edit'} label={item.type === 'recording' ? 'Annotate' : 'Edit'} onClick={stop(item.type === 'recording' ? onAnnotate : onOpen)} />
            {item.type === 'screenshot' && <OvlBtn icon="content_copy" label="Copy" onClick={stop(onCopy)} />}
            {item.filePath && <OvlBtn icon="folder_open" label="Folder" onClick={stop(onOpenFile)} />}
            {uploadUrl && <OvlBtn icon="open_in_new" label="Link" onClick={stop(() => window.electronAPI?.openExternal(uploadUrl))} />}
            <OvlBtn icon="delete" label="Delete" variant="danger" onClick={stop(onDelete)} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="text-xs font-bold text-white truncate flex-1" style={{ fontFamily: 'Manrope, sans-serif' }}>{item.name}</p>
          <div className="flex items-center gap-1.5">
            {item.type === 'recording' && (
              <span className="text-[8px] font-bold uppercase tracking-wider text-secondary bg-secondary/10 px-1.5 py-0.5 rounded-full flex-shrink-0">Video</span>
            )}
            {isUploaded && (
              <span className="text-[8px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded-full flex-shrink-0">Synced</span>
            )}
          </div>
        </div>
        <p className="text-[10px] text-slate-500 font-medium">{date}</p>
      </div>
    </div>
  )
}

function OvlBtn({ icon, label, onClick, variant }: { icon: string; label: string; onClick: (e: ReactMouseEvent) => void; variant?: 'danger' }) {
  return (
    <button
      onClick={onClick}
      className={`w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-sm transition-all duration-200 ${
        variant === 'danger'
          ? 'bg-white/10 text-white/70 hover:bg-red-500/30 hover:text-red-300'
          : 'bg-white/10 text-white/70 hover:bg-white/25 hover:text-white hover:scale-110'
      }`}
      title={label}
    >
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
    </button>
  )
}

/* ── Video Preview Modal ── */

function VideoPreviewModal({ item, onClose, onAnnotate }: { item: HistoryItem; onClose: () => void; onAnnotate: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoSrc = useLocalVideoUrl(item.filePath)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[70]" onClick={onClose}>
      <div className="glass-refractive rounded-3xl overflow-hidden shadow-2xl max-w-4xl w-full mx-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <p className="text-sm font-bold text-white truncate max-w-xs" style={{ fontFamily: 'Manrope, sans-serif' }}>{item.name}</p>
          <div className="flex items-center gap-3">
            <button
              onClick={onAnnotate}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-semibold text-white transition-all"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              <span className="material-symbols-outlined text-sm">draw</span>
              Annotate
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
        <div className="bg-black">
          <video
            ref={videoRef}
            src={videoSrc}
            controls
            autoPlay
            className="w-full max-h-[70vh]"
            style={{ display: 'block' }}
          />
        </div>
      </div>
    </div>
  )
}
