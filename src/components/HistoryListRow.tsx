import { type MouseEvent as ReactMouseEvent } from 'react'
import type { HistoryItem } from '../types'

interface HistoryListRowProps {
  item: HistoryItem
  isSelecting: boolean
  isSelected: boolean
  isSharing: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onDelete: () => void
  onCopy: () => void
  onShare: () => void
}

export function HistoryListRow({
  item, isSelecting, isSelected, isSharing, onToggleSelect, onOpen, onDelete, onCopy, onShare,
}: HistoryListRowProps) {
  const date = new Date(item.timestamp).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const isUploaded = item.uploads?.some(u => u.success)
  const googleUrl = item.uploads?.find(u => u.destination === 'google-drive' && u.success && u.url)?.url
  const size = item.size ? (item.size > 1e6 ? `${(item.size / 1e6).toFixed(1)} MB` : `${(item.size / 1e3).toFixed(0)} KB`) : ''

  const stop = (fn: () => void) => (e: ReactMouseEvent) => { e.stopPropagation(); fn() }

  const missing = item.fileMissing

  return (
    <div
      className={`group flex items-center gap-4 px-4 py-2.5 rounded-xl transition-all ${
        missing && !isSelecting ? 'opacity-50' : ''
      } ${
        missing ? 'cursor-default' : 'cursor-pointer'
      } ${
        isSelected
          ? 'bg-primary/10 border border-primary/20'
          : 'bg-white/[0.02] border border-transparent hover:bg-white/5 hover:border-white/5'
      }`}
      onClick={isSelecting ? onToggleSelect : (missing ? undefined : onOpen)}
      title={missing ? 'File no longer exists on disk' : undefined}
    >
      {/* Checkbox */}
      {isSelecting && (
        <button
          onClick={stop(onToggleSelect)}
          className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all border ${
            isSelected
              ? 'bg-primary border-primary text-slate-900'
              : 'bg-white/5 border-white/10 hover:border-primary/40'
          }`}
        >
          {isSelected && <span className="material-symbols-outlined text-xs">check</span>}
        </button>
      )}

      {/* Thumbnail */}
      <div className="w-10 h-10 rounded-lg bg-slate-900 overflow-hidden flex-shrink-0 border border-white/5">
        {(item.thumbnailUrl ?? item.dataUrl) ? (
          <img src={item.thumbnailUrl ?? item.dataUrl} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="material-symbols-outlined text-slate-700 text-sm">
              {item.type === 'recording' ? 'videocam' : 'image'}
            </span>
          </div>
        )}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white truncate" style={{ fontFamily: 'Manrope, sans-serif' }}>
          {item.name}
        </p>
      </div>

      {/* Type badge */}
      {item.type === 'recording' && (
        <span className="text-[8px] font-bold uppercase tracking-wider text-secondary bg-secondary/10 px-1.5 py-0.5 rounded-full flex-shrink-0">
          Video
        </span>
      )}

      {/* Missing file badge */}
      {missing && (
        <span className="text-[8px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full flex-shrink-0">
          Missing
        </span>
      )}

      {/* Upload status */}
      {isUploaded && (
        <span className="text-[8px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded-full flex-shrink-0">
          Synced
        </span>
      )}

      {/* Date */}
      <span className="text-[10px] text-slate-500 font-medium w-28 text-right flex-shrink-0">{date}</span>

      {/* Size */}
      <span className="text-[10px] text-slate-600 w-14 text-right flex-shrink-0">{size}</span>

      {/* Inline actions — unified for image + video. Missing rows only
          expose Delete so users prune orphans without chasing dead links. */}
      {!isSelecting && (
        <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {!missing && (
            <>
              <RowAction icon="edit" label="Edit" onClick={stop(onOpen)} />
              <RowAction icon="content_copy" label="Copy" onClick={stop(onCopy)} />
              <RowAction icon={isSharing ? 'sync' : 'share'} label={isSharing ? 'Sharing…' : 'Share'} onClick={stop(onShare)} spinning={isSharing} />
              {googleUrl && (
                <RowAction icon="cloud" label="Open Google link" onClick={stop(() => window.electronAPI?.openExternal(googleUrl))} />
              )}
            </>
          )}
          <button
            onClick={stop(onDelete)}
            className="p-1 rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
            title="Delete"
          >
            <span className="material-symbols-outlined text-xs">delete</span>
          </button>
        </div>
      )}
    </div>
  )
}

function RowAction({ icon, label, onClick, spinning }: { icon: string; label: string; onClick: (e: ReactMouseEvent) => void; spinning?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={spinning}
      className="p-1 rounded-md text-slate-500 hover:text-white hover:bg-white/10 transition-all disabled:opacity-60"
      title={label}
    >
      <span className={`material-symbols-outlined text-xs ${spinning ? 'animate-spin' : ''}`}>{icon}</span>
    </button>
  )
}
