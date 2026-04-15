import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

type DialogState = 'capturing' | 'stitching' | 'error'

interface Props {
  onClose: () => void
}

export default function ScrollCaptureDialog({ onClose }: Props) {
  const navigate = useNavigate()
  const [dialogState, setDialogState] = useState<DialogState>('capturing')
  const [progress, setProgress] = useState({ frame: 0, maxFrames: 20 })
  const [error, setError] = useState('')

  // Subscribe to all scroll-capture events in a single effect.
  useEffect(() => {
    window.electronAPI?.onScrollCaptureProgress(data => {
      if (data.phase === 'stitching') {
        setDialogState('stitching')
      }
      setProgress(data)
    })

    window.electronAPI?.onScrollCaptureResult(async ({ dataUrl }) => {
      try {
        if (!dataUrl) {
          setError('No frames were captured.')
          setDialogState('error')
          return
        }

        // Add to history
        try {
          await window.electronAPI?.addHistoryItem({
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            name: `scroll-capture-${new Date().toISOString().replace(/[:.]/g, '-')}`,
            dataUrl,
            type: 'screenshot',
            uploads: []
          })
        } catch {
          // History add is non-critical — continue
        }

        navigate('/editor', { state: { dataUrl, source: 'scrolling' } })
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setDialogState('error')
      }
    })

    window.electronAPI?.onScrollCaptureError(({ error: msg }) => {
      setError(msg)
      setDialogState('error')
    })

    return () => {
      window.electronAPI?.removeAllListeners('scroll-capture:progress')
      window.electronAPI?.removeAllListeners('scroll-capture:result')
      window.electronAPI?.removeAllListeners('scroll-capture:error')
    }
  }, []) // eslint-disable-line

  const handleClose = () => {
    window.electronAPI?.cancelScrollCapture()
    window.electronAPI?.removeAllListeners('scroll-capture:progress')
    window.electronAPI?.removeAllListeners('scroll-capture:result')
    window.electronAPI?.removeAllListeners('scroll-capture:error')
    onClose()
  }

  // ESC key to cancel
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, []) // eslint-disable-line

  const progressPct =
    progress.maxFrames > 0
      ? Math.round((progress.frame / progress.maxFrames) * 100)
      : 0

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="glass-refractive rounded-3xl p-8 w-[480px] shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-lg">swipe_down</span>
            </div>
            <h3 className="text-lg font-bold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Scrolling Capture
            </h3>
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-white transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Capturing state */}
        {dialogState === 'capturing' && (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-2xl animate-bounce">swipe_down</span>
            </div>
            {progress.frame > 0 ? (
              <>
                <p className="text-sm text-slate-300 font-semibold" style={{ fontFamily: 'Manrope, sans-serif' }}>
                  Capturing scroll…
                </p>
                <p className="text-xs text-slate-500" style={{ fontFamily: 'Manrope, sans-serif' }}>
                  Frame {progress.frame} of {progress.maxFrames}
                </p>
                <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full primary-gradient rounded-full transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-slate-400 text-sm" style={{ fontFamily: 'Manrope, sans-serif' }}>
                  Capturing scroll…
                </p>
              </>
            )}
            <button
              onClick={handleClose}
              className="mt-2 px-6 py-2 rounded-2xl border border-slate-500/30 text-slate-300 text-sm font-semibold hover:bg-white/5 transition-colors"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Stitching state */}
        {dialogState === 'stitching' && (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-2xl animate-bounce">swipe_down</span>
            </div>
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-400 text-sm" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Stitching frames…
            </p>
          </div>
        )}

        {/* Error */}
        {dialogState === 'error' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl">
              <span className="material-symbols-outlined text-red-400 flex-shrink-0">error</span>
              <div>
                <p className="text-sm font-semibold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
                  Capture failed
                </p>
                <p className="text-xs text-slate-400 mt-1">{error}</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="w-full primary-gradient text-slate-900 font-bold py-4 rounded-2xl"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
