import type { SensitiveRegion, SensitiveCategory } from '@/types'

const CATEGORY_LABELS: Record<SensitiveCategory, string> = {
  'email': 'Email',
  'phone': 'Phone',
  'credit-card': 'Credit Card',
  'ssn': 'SSN',
  'api-key': 'API Key',
  'jwt': 'JWT Token',
  'private-key': 'Private Key',
  'password': 'Password',
  'bearer-token': 'Bearer Token',
  'ip-address': 'IP Address',
  'url-credentials': 'URL Credentials'
}

const CATEGORY_ICONS: Record<SensitiveCategory, string> = {
  'email': 'alternate_email',
  'phone': 'phone',
  'credit-card': 'credit_card',
  'ssn': 'badge',
  'api-key': 'key',
  'jwt': 'token',
  'private-key': 'lock',
  'password': 'password',
  'bearer-token': 'vpn_key',
  'ip-address': 'lan',
  'url-credentials': 'link'
}

const CATEGORY_COLORS: Record<SensitiveCategory, string> = {
  'email': '#f59e0b',
  'phone': '#3b82f6',
  'credit-card': '#ef4444',
  'ssn': '#ef4444',
  'api-key': '#8b5cf6',
  'jwt': '#8b5cf6',
  'private-key': '#dc2626',
  'password': '#dc2626',
  'bearer-token': '#8b5cf6',
  'ip-address': '#6b7280',
  'url-credentials': '#f97316'
}

interface Props {
  regions: SensitiveRegion[]
  selectedIds: Set<string>
  scanning: boolean
  canUndo: boolean
  ocrTimeMs?: number
  onToggleRegion: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onApplyBlur: () => void
  onScan: () => void
  onUndo: () => void
  onClose: () => void
}

export function AutoBlurPanel({
  regions,
  selectedIds,
  scanning,
  canUndo,
  ocrTimeMs,
  onToggleRegion,
  onSelectAll,
  onDeselectAll,
  onApplyBlur,
  onScan,
  onUndo,
  onClose
}: Props) {
  // Group regions by category
  const grouped = regions.reduce<Record<string, SensitiveRegion[]>>((acc, r) => {
    ;(acc[r.category] ??= []).push(r)
    return acc
  }, {})

  const allSelected = regions.length > 0 && selectedIds.size === regions.length
  const noneSelected = selectedIds.size === 0

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-shrink-0">
        <span
          className="text-[10px] font-bold uppercase tracking-widest text-slate-500"
          style={{ fontFamily: 'Manrope, sans-serif' }}
        >
          AI Blur
        </span>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined text-sm">close</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── Empty state: Scan button ── */}
        {regions.length === 0 && !scanning && (
          <div className="flex flex-col items-center py-8 px-4 gap-4">
            <div className="relative">
              <div className="absolute -inset-4 rounded-full bg-primary/5 blur-xl" />
              <div className="relative w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                <span className="material-symbols-outlined text-2xl text-slate-500" style={{ fontVariationSettings: "'FILL' 0, 'wght' 300" }}>
                  shield
                </span>
              </div>
            </div>
            <div className="text-center space-y-1">
              <p className="text-xs font-semibold text-white/80" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Detect sensitive info
              </p>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Scan for emails, API keys, passwords and more
              </p>
            </div>
            <button
              onClick={onScan}
              className="primary-gradient text-slate-900 font-bold px-4 py-2 rounded-xl text-xs hover:scale-[1.02] active:scale-95 transition-transform flex items-center gap-2"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              <span className="material-symbols-outlined text-sm">search</span>
              Scan Image
            </button>

            {/* Undo previous blur */}
            {canUndo && (
              <button
                onClick={onUndo}
                className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-white transition-colors"
              >
                <span className="material-symbols-outlined text-xs">undo</span>
                Undo last blur
              </button>
            )}
          </div>
        )}

        {/* ── Scanning state ── */}
        {scanning && (
          <div className="flex flex-col items-center py-10 gap-3">
            <div className="relative w-10 h-10">
              <div className="absolute inset-0 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="material-symbols-outlined text-sm text-primary">
                  search
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-400" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Scanning...
            </p>
            <p className="text-[10px] text-slate-600">
              Running OCR + pattern matching
            </p>
          </div>
        )}

        {/* ── Results ── */}
        {regions.length > 0 && (
          <>
            {/* Stats bar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
              <div className="flex items-center gap-2">
                <button
                  onClick={allSelected ? onDeselectAll : onSelectAll}
                  className="text-[10px] font-semibold text-primary/80 hover:text-primary transition-colors"
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  {allSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="flex items-center gap-2">
                {ocrTimeMs !== undefined && (
                  <span className="text-[9px] text-slate-600 tabular-nums">
                    {(ocrTimeMs / 1000).toFixed(1)}s
                  </span>
                )}
                <button
                  onClick={onScan}
                  className="text-slate-500 hover:text-white transition-colors"
                  title="Rescan"
                >
                  <span className="material-symbols-outlined text-xs">refresh</span>
                </button>
              </div>
            </div>

            {/* Grouped detections */}
            <div className="py-1">
              {Object.entries(grouped).map(([category, items]) => (
                <div key={category}>
                  {/* Category header */}
                  <div className="flex items-center gap-2 px-4 py-1.5">
                    <span
                      className="material-symbols-outlined text-xs"
                      style={{ color: CATEGORY_COLORS[category as SensitiveCategory], fontVariationSettings: "'FILL' 1" }}
                    >
                      {CATEGORY_ICONS[category as SensitiveCategory]}
                    </span>
                    <span className="text-[10px] font-semibold text-white/40" style={{ fontFamily: 'Manrope, sans-serif' }}>
                      {CATEGORY_LABELS[category as SensitiveCategory]}
                    </span>
                    <span className="text-[9px] text-white/20 ml-auto tabular-nums">{items.length}</span>
                  </div>

                  {/* Items */}
                  {items.map(region => (
                    <label
                      key={region.id}
                      className={`flex items-center gap-2.5 px-4 py-1.5 cursor-pointer transition-all ${
                        selectedIds.has(region.id)
                          ? 'bg-white/[0.04]'
                          : 'hover:bg-white/[0.02]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(region.id)}
                        onChange={() => onToggleRegion(region.id)}
                        className="w-3.5 h-3.5 rounded border-white/20 accent-primary flex-shrink-0"
                      />
                      <span className="text-[11px] text-white/60 truncate font-mono leading-tight">
                        {region.text.length > 28 ? region.text.slice(0, 28) + '…' : region.text}
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Footer actions ── */}
      {regions.length > 0 && (
        <div className="px-3 py-3 border-t border-white/5 flex flex-col gap-2 flex-shrink-0">
          {/* Apply blur */}
          <button
            onClick={onApplyBlur}
            disabled={noneSelected}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-25 disabled:cursor-not-allowed bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/10 hover:border-red-500/20"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            <span className="material-symbols-outlined text-sm">blur_on</span>
            Blur Selected ({selectedIds.size})
          </button>

          {/* Undo */}
          {canUndo && (
            <button
              onClick={onUndo}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-semibold text-slate-500 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 transition-all"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              <span className="material-symbols-outlined text-xs">undo</span>
              Undo Last Blur
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export { CATEGORY_COLORS }
