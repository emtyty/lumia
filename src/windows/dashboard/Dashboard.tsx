import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { HistoryItem } from '../../types'
import VideoRecorder from '../../components/VideoRecorder'

type CaptureMode = 'region' | 'window' | 'fullscreen'

const CAPTURE_BUTTONS: { mode: CaptureMode; icon: string; label: string; shortcut: string }[] = [
  { mode: 'region',     icon: 'crop_free',       label: 'Region',     shortcut: 'Ctrl+Shift+4' },
  { mode: 'window',     icon: 'layers',           label: 'Window',     shortcut: 'Ctrl+Shift+2' },
  { mode: 'fullscreen', icon: 'desktop_windows',  label: 'Fullscreen', shortcut: 'Ctrl+Shift+3' },
]

export default function Dashboard() {
  const navigate = useNavigate()
  const [recentItems, setRecentItems] = useState<HistoryItem[]>([])
  const [showRecorder, setShowRecorder] = useState(false)
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name' | 'type'>('newest')
  const [workflowToggles, setWorkflowToggles] = useState({
    clipboard: true,
    autoUpload: false,
    desktopVault: true
  })

  useEffect(() => {
    window.electronAPI?.getHistory().then(items => setRecentItems(items.slice(0, 8)))

    window.electronAPI?.onCaptureReady(({ dataUrl, source }) => {
      navigate('/editor', { state: { dataUrl, source } })
    })

    // Global hotkeys → open recorder modal
    window.electronAPI?.onRecorderOpen(() => setShowRecorder(true))
    window.electronAPI?.onRecorderOpenGif(() => setShowRecorder(true))   // GIF not yet separate; reuse video recorder

    return () => {
      window.electronAPI?.removeAllListeners('capture:ready')
      window.electronAPI?.removeAllListeners('recorder:open')
      window.electronAPI?.removeAllListeners('recorder:open-gif')
    }
  }, [navigate])

  const handleCapture = async (mode: CaptureMode) => {
    if (mode === 'region') {
      await window.electronAPI?.captureScreenshot('region')
      // overlay opens; capture:ready fires when region is selected
    } else {
      const dataUrl = await window.electronAPI?.captureScreenshot(mode) as string
      if (dataUrl) navigate('/editor', { state: { dataUrl, source: mode } })
    }
  }

  const toggle = (key: keyof typeof workflowToggles) => {
    setWorkflowToggles(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="h-screen overflow-y-auto hide-scrollbar pt-[6.5rem]">
      {/* Top bar */}
      <header
        className="fixed top-10 right-0 h-16 liquid-glass flex items-center justify-between px-8 z-40"
        style={{ left: '16rem' }}
      >
        <div className="flex items-center bg-white/5 border border-white/10 px-5 py-2 rounded-full w-80 backdrop-blur-md group hover:border-primary/30 transition-all">
          <span className="material-symbols-outlined text-primary text-lg">search</span>
          <input
            className="bg-transparent border-none outline-none text-sm w-full placeholder-slate-500 text-white ml-2"
            placeholder="Search captures..."
          />
        </div>
        <div className="flex items-center gap-6">
          <span className="material-symbols-outlined text-secondary cursor-pointer hover:scale-110 transition-transform">cloud_done</span>
          <span className="material-symbols-outlined text-slate-400 cursor-pointer hover:text-white transition-colors">notifications</span>
        </div>
      </header>

      <div className="p-10 space-y-12">
        {/* Hero bento grid */}
        <div className="grid grid-cols-12 gap-8">
          {/* Primary capture HUD */}
          <div className="col-span-8 card-organic p-10 flex flex-col justify-between relative overflow-hidden group">
            <div className="absolute -right-32 -top-32 w-96 h-96 bg-primary/10 rounded-full blur-[100px] group-hover:bg-primary/20 transition-all duration-700" />
            <div className="absolute -left-32 -bottom-32 w-64 h-64 bg-secondary/5 rounded-full blur-[80px]" />

            <div className="relative z-10">
              <h2 className="text-4xl font-extrabold tracking-tight mb-3 text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Ready to Lens?
              </h2>
              <p className="text-slate-400 text-base max-w-lg leading-relaxed">
                Precision-tuned capture for high-fidelity assets. Annotate, share, and automate.
              </p>
            </div>

            <div className="flex gap-6 mt-10 relative z-10">
              {CAPTURE_BUTTONS.map(({ mode, icon, label, shortcut }) => (
                <button
                  key={mode}
                  onClick={() => handleCapture(mode)}
                  className="flex-1 flex flex-col items-center justify-center gap-4 p-8 bg-white/5 rounded-3xl hover:bg-white/10 transition-all border border-white/5 hover:border-primary/30 group/btn"
                >
                  <div className="p-4 rounded-2xl bg-primary/10 text-primary group-hover/btn:scale-110 transition-transform">
                    <span className="material-symbols-outlined text-3xl">{icon}</span>
                  </div>
                  <div className="text-center">
                    <span className="block text-xs font-bold tracking-[0.2em] uppercase text-slate-400 group-hover/btn:text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
                      {label}
                    </span>
                    <span className="block text-[9px] text-slate-600 mt-1">{shortcut}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Workflow engine panel */}
          <div className="col-span-4 card-organic p-8 flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold tracking-[0.15em] uppercase text-slate-500" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Workflow Engine
              </h3>
              <div className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center text-secondary">
                <span className="material-symbols-outlined text-lg">bolt</span>
              </div>
            </div>

            <div className="space-y-3">
              {([
                { key: 'clipboard' as const, icon: 'content_copy', label: 'Clipboard Sync' },
                { key: 'autoUpload' as const, icon: 'cloud_upload', label: 'Auto-upload' },
                { key: 'desktopVault' as const, icon: 'save', label: 'Desktop Vault' },
              ]).map(({ key, icon, label }) => (
                <div
                  key={key}
                  className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-transparent hover:border-white/10 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <span className="material-symbols-outlined text-slate-400 text-[20px]">{icon}</span>
                    <span className="text-sm font-semibold text-slate-200" style={{ fontFamily: 'Manrope, sans-serif' }}>{label}</span>
                  </div>
                  <button
                    onClick={() => toggle(key)}
                    className={`w-10 h-5 rounded-full relative transition-all duration-300 ${workflowToggles[key] ? 'bg-primary' : 'bg-slate-700'}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-300 ${workflowToggles[key] ? 'right-0.5' : 'left-0.5'}`} />
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={() => navigate('/workflow')}
              className="mt-auto w-full py-3 text-[11px] uppercase font-bold tracking-widest text-slate-500 hover:text-white transition-colors border border-white/10 rounded-xl hover:bg-white/5"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              Automation Studio
            </button>
          </div>
        </div>

        {/* Recent artifacts gallery */}
        <section>
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-2xl font-bold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Recent Artifacts
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 mr-1" style={{ fontFamily: 'Manrope, sans-serif' }}>Sort:</span>
              {(['newest', 'oldest', 'name', 'type'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSortBy(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize ${sortBy === s ? 'bg-primary/20 text-primary' : 'text-slate-500 hover:text-white bg-white/5'}`}
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {recentItems.length === 0 ? (
            <div className="text-center py-20 text-slate-600">
              <span className="material-symbols-outlined text-5xl mb-4 block">add_a_photo</span>
              <p className="text-sm font-medium" style={{ fontFamily: 'Manrope, sans-serif' }}>No captures yet. Press Ctrl+Shift+4 to start!</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-6">
              {[...recentItems].sort((a, b) => {
                if (sortBy === 'newest') return b.timestamp - a.timestamp
                if (sortBy === 'oldest') return a.timestamp - b.timestamp
                if (sortBy === 'name')   return a.name.localeCompare(b.name)
                if (sortBy === 'type')   return a.type.localeCompare(b.type)
                return 0
              }).map(item => (
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
      </div>

      {showRecorder && <VideoRecorder onClose={() => setShowRecorder(false)} />}

      {/* Floating HUD */}
      <div
        className="fixed bottom-8 glass-refractive rounded-full px-8 py-4 flex items-center gap-8 shadow-2xl z-50 border border-white/10"
        style={{ left: 'calc(50% + 128px)', transform: 'translateX(-50%)' }}
      >
        <div className="flex items-center gap-6">
          <button onClick={() => handleCapture('region')} className="text-primary hover:scale-125 transition-transform">
            <span className="material-symbols-outlined">crop_free</span>
          </button>
          <button onClick={() => handleCapture('fullscreen')} className="text-primary hover:scale-125 transition-transform">
            <span className="material-symbols-outlined">desktop_windows</span>
          </button>
          <button onClick={() => setShowRecorder(true)} className="text-tertiary hover:scale-125 transition-transform">
            <span className="material-symbols-outlined">videocam</span>
          </button>
          <div className="h-5 w-px bg-white/10" />
          <button onClick={() => navigate('/editor')} className="text-slate-400 hover:text-white transition-colors">
            <span className="material-symbols-outlined">draw</span>
          </button>
          <button onClick={() => navigate('/history')} className="text-slate-400 hover:text-white transition-colors">
            <span className="material-symbols-outlined">history</span>
          </button>
        </div>
        <div className="flex items-center gap-3 bg-white/5 border border-white/10 px-4 py-2 rounded-full">
          <div className="w-2 h-2 rounded-full bg-secondary animate-pulse-glow" />
          <span className="text-[10px] font-black tracking-[0.2em] uppercase text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>Ready</span>
        </div>
      </div>
    </div>
  )
}

function CaptureCard({ item, onOpen }: { item: HistoryItem; onOpen: () => void }) {
  const date = new Date(item.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const isUploaded = item.uploads.some(u => u.success)

  return (
    <div className="group cursor-pointer" onClick={onOpen}>
      <div className="aspect-video bg-slate-900 rounded-2xl overflow-hidden relative mb-4 border border-white/5 group-hover:border-primary/50 transition-all duration-500">
        {item.dataUrl ? (
          <img src={item.dataUrl} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 opacity-90 group-hover:opacity-100" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="material-symbols-outlined text-slate-700 text-3xl">image</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-4 flex items-end justify-between">
          <div className="flex gap-2">
            <button className="p-1.5 glass-refractive rounded-xl hover:bg-primary hover:text-slate-950 transition-all">
              <span className="material-symbols-outlined text-sm">edit</span>
            </button>
          </div>
          {isUploaded && (
            <span className="text-[10px] font-black text-white uppercase tracking-widest bg-primary/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/20">
              Synced
            </span>
          )}
        </div>
      </div>
      <div>
        <p className="text-sm font-bold text-white truncate" style={{ fontFamily: 'Manrope, sans-serif' }}>{item.name}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-slate-500 font-bold tracking-tighter">{date}</span>
          {item.type === 'recording' && (
            <>
              <span className="w-1 h-1 rounded-full bg-slate-700" />
              <span className="text-[10px] text-primary/80 font-bold uppercase">Video</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
