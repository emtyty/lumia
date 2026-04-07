import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { HistoryItem } from '../../types'
import { useLocalVideoUrl } from '../../hooks/useLocalVideoUrl'

export default function History() {
  const navigate = useNavigate()
  const [items, setItems] = useState<HistoryItem[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'screenshot' | 'recording'>('all')
  const [previewItem, setPreviewItem] = useState<HistoryItem | null>(null)

  useEffect(() => {
    window.electronAPI?.getHistory().then(setItems)
  }, [])

  const filtered = items.filter(item => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'all' || item.type === filter
    return matchSearch && matchFilter
  })

  const totalSize = items.reduce((acc, i) => acc + (i.size ?? 0), 0)
  const formatSize = (bytes: number) => bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : bytes > 1e3 ? `${(bytes / 1e3).toFixed(0)} KB` : `${bytes} B`

  const handleDelete = async (id: string) => {
    await window.electronAPI?.deleteHistoryItem(id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  return (
    <div className="h-screen overflow-y-auto pt-[6.5rem]">
      {/* Top bar */}
      <header
        className="fixed top-10 right-0 h-16 liquid-glass flex items-center justify-between px-8 z-40"
        style={{ left: '16rem' }}
      >
        <div className="flex items-center bg-white/5 border border-white/10 px-5 py-2 rounded-full w-80 backdrop-blur-md group hover:border-primary/30 transition-all">
          <span className="material-symbols-outlined text-primary text-lg">search</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent border-none outline-none text-sm w-full placeholder-slate-500 text-white ml-2"
            placeholder="Search captures..."
          />
        </div>
        <div className="flex items-center gap-6">
          <span className="text-sm text-slate-400">{items.length} captures · {formatSize(totalSize)}</span>
        </div>
      </header>

      <div className="p-10">
        {/* Filter tabs */}
        <div className="flex items-center gap-4 mb-8">
          {(['all', 'screenshot', 'recording'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
                filter === f ? 'primary-gradient text-slate-900' : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
              }`}
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              {f === 'all' ? `All (${items.length})` : f === 'screenshot' ? `Screenshots (${items.filter(i => i.type === 'screenshot').length})` : `Recordings (${items.filter(i => i.type === 'recording').length})`}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-24 text-slate-600">
            <span className="material-symbols-outlined text-5xl mb-4 block">history</span>
            <p className="text-sm font-medium" style={{ fontFamily: 'Manrope, sans-serif' }}>
              {search ? 'No captures match your search' : 'No captures yet'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-6">
            {filtered.map(item => (
              <HistoryCard
                key={item.id}
                item={item}
                onOpen={() => item.type === 'recording'
                  ? setPreviewItem(item)
                  : navigate('/editor', { state: { dataUrl: item.dataUrl, source: 'history' } })
                }
                onAnnotate={() => navigate('/video-annotator', { state: { filePath: item.filePath, name: item.name } })}
                onDelete={() => handleDelete(item.id)}
                onOpenFile={() => item.filePath && window.electronAPI?.openHistoryFile(item.filePath)}
                onCopy={() => item.type === 'screenshot' && item.dataUrl && window.electronAPI?.runWorkflow('builtin-clipboard', item.dataUrl)}
              />
            ))}
          </div>
        )}
      </div>

      {previewItem && (
        <VideoPreviewModal
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onAnnotate={() => { setPreviewItem(null); navigate('/video-annotator', { state: { filePath: previewItem.filePath, name: previewItem.name } }) }}
        />
      )}
    </div>
  )
}

function VideoPreviewModal({ item, onClose, onAnnotate }: { item: HistoryItem; onClose: () => void; onAnnotate: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoSrc = useLocalVideoUrl(item.filePath)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="glass-refractive rounded-3xl overflow-hidden shadow-2xl max-w-4xl w-full mx-8" onClick={e => e.stopPropagation()}>
        {/* Modal header */}
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
        {/* Video player */}
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

function HistoryCard({
  item, onOpen, onAnnotate, onDelete, onOpenFile, onCopy
}: {
  item: HistoryItem
  onOpen: () => void
  onAnnotate: () => void
  onDelete: () => void
  onOpenFile: () => void
  onCopy: () => void
}) {
  const date = new Date(item.timestamp).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
  const isUploaded = item.uploads?.some(u => u.success)
  const uploadUrl = item.uploads?.find(u => u.success && u.url)?.url

  return (
    <div className="group glass-card rounded-2xl overflow-hidden cursor-pointer transition-all duration-300">
      {/* Thumbnail */}
      <div className="aspect-video bg-slate-950 relative overflow-hidden" onClick={onOpen}>
        {item.dataUrl ? (
          <img src={item.dataUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-90" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="material-symbols-outlined text-slate-700 text-4xl">{item.type === 'recording' ? 'videocam' : 'image'}</span>
          </div>
        )}

        {/* Play button overlay for recordings — pointer-events-none so action buttons below remain clickable */}
        {item.type === 'recording' && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <div className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20">
              <span className="material-symbols-outlined text-white text-3xl ml-1">play_arrow</span>
            </div>
          </div>
        )}

        {/* Overlay actions */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-3">
          <div className="flex gap-1.5">
            <button
              onClick={e => { e.stopPropagation(); item.type === 'recording' ? onAnnotate() : onOpen() }}
              className="p-1.5 glass-refractive rounded-xl hover:bg-primary hover:text-slate-950 transition-all text-white"
              title={item.type === 'recording' ? 'Annotate' : 'Edit'}
            >
              <span className="material-symbols-outlined text-sm">{item.type === 'recording' ? 'draw' : 'edit'}</span>
            </button>
            {item.filePath && (
              <button
                onClick={e => { e.stopPropagation(); onOpenFile() }}
                className="p-1.5 glass-refractive rounded-xl hover:bg-white/20 transition-all text-white"
                title="Show in folder"
              >
                <span className="material-symbols-outlined text-sm">folder_open</span>
              </button>
            )}
            {item.type === 'screenshot' && (
              <button
                onClick={e => { e.stopPropagation(); onCopy() }}
                className="p-1.5 glass-refractive rounded-xl hover:bg-primary hover:text-slate-950 transition-all text-white"
                title="Copy to clipboard"
              >
                <span className="material-symbols-outlined text-sm">content_copy</span>
              </button>
            )}
            <button
              onClick={e => { e.stopPropagation(); onDelete() }}
              className="p-1.5 glass-refractive rounded-xl hover:bg-red-500/80 transition-all text-white"
              title="Delete"
            >
              <span className="material-symbols-outlined text-sm">delete</span>
            </button>
          </div>
          <div className="flex flex-col items-end gap-1">
            {isUploaded && (
              <span className="text-[10px] font-black text-white uppercase tracking-widest bg-primary/40 backdrop-blur-md px-3 py-1 rounded-full border border-white/20">
                Synced
              </span>
            )}
            {item.type === 'recording' && (
              <span className="text-[10px] font-black text-white uppercase tracking-widest bg-secondary/20 backdrop-blur-md px-3 py-1 rounded-full border border-secondary/20">
                Video
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="p-4" onClick={onOpen} style={{ cursor: 'pointer' }}>
        <p className="text-sm font-bold text-white truncate mb-2" style={{ fontFamily: 'Manrope, sans-serif' }}>{item.name}</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 font-bold">{date}</span>
          {uploadUrl && (
            <>
              <span className="w-1 h-1 rounded-full bg-slate-700" />
              <button
                onClick={e => { e.stopPropagation(); window.electronAPI?.openExternal(uploadUrl) }}
                className="text-[10px] text-primary hover:underline font-bold"
              >
                View ↗
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
