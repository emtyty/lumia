import { useState, useRef, useEffect, useCallback } from 'react'
import ShareDialog from './ShareDialog'

type RecordState = 'idle' | 'source-pick' | 'countdown' | 'recording' | 'saving' | 'done'

interface Source { id: string; name: string; thumbnail: string }

interface Props {
  onClose: () => void
}

export default function VideoRecorder({ onClose }: Props) {
  const [state, setState] = useState<RecordState>('source-pick')
  const [sources, setSources] = useState<Source[]>([])
  const [selectedSource, setSelectedSource] = useState<Source | null>(null)
  const [countdown, setCountdown] = useState(3)
  const [elapsed, setElapsed] = useState(0)
  const [savedPath, setSavedPath] = useState('')
  const [error, setError] = useState('')

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load sources on mount
  useEffect(() => {
    window.electronAPI?.getRecordingSources().then(s => {
      setSources(s)
      const screen = s.find(x => x.name.includes('Screen') || x.name.includes('Entire'))
      setSelectedSource(screen ?? s[0] ?? null)
    })

    // Ctrl+Shift+S global hotkey → stop recording if active
    window.electronAPI?.onRecorderStop(() => {
      if (mediaRecorderRef.current?.state === 'recording') {
        stopRecording()
      }
    })

    return () => { window.electronAPI?.removeAllListeners('recorder:stop') }
  }, []) // eslint-disable-line

  const clearTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  // Countdown before recording
  const startCountdown = useCallback(() => {
    setState('countdown')
    setCountdown(3)
    let c = 3
    timerRef.current = setInterval(() => {
      c -= 1
      setCountdown(c)
      if (c <= 0) {
        clearTimer()
        startCapture()
      }
    }, 1000)
  }, [selectedSource]) // eslint-disable-line

  const startCapture = useCallback(async () => {
    if (!selectedSource) return
    try {
      // Hide the app window before capturing
      await window.electronAPI?.hideForRecording()

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          // @ts-expect-error Electron-specific constraint
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: selectedSource.id,
            minWidth: 1280,
            maxWidth: 1920,
            minHeight: 720,
            maxHeight: 1080,
            maxFrameRate: 30   // cap at 30fps — reduces WGC frame-drop errors
          }
        }
      })

      streamRef.current = stream
      chunksRef.current = []

      // VP8 preferred: lower GPU encoding pressure than VP9, fewer WGC frame failures
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm'
      const recorder = new MediaRecorder(stream, {
        mimeType
      })

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        await saveRecording()
      }

      mediaRecorderRef.current = recorder
      recorder.start(1000) // collect chunks every second

      setState('recording')
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)

      // Show the window back so the user can see the controls
      await window.electronAPI?.showAfterRecording()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('idle')
      await window.electronAPI?.showAfterRecording()
    }
  }, [selectedSource])

  const stopRecording = useCallback(() => {
    clearTimer()
    streamRef.current?.getTracks().forEach(t => t.stop())
    mediaRecorderRef.current?.stop()
    setState('saving')
  }, [])

  const saveRecording = async () => {
    const blob = new Blob(chunksRef.current, { type: 'video/webm' })
    const buffer = await blob.arrayBuffer()
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `recording-${ts}.webm`
    try {
      const [filePath, thumbnail] = await Promise.all([
        window.electronAPI?.saveRecording(buffer, filename),
        extractThumbnail(blob)
      ])
      setSavedPath(filePath ?? '')
      setState('done')
      await window.electronAPI?.addHistoryItem({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        name: filename,
        filePath: filePath ?? '',
        dataUrl: thumbnail,
        type: 'recording',
        uploads: []
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('idle')
    }
  }

  /** Extract a JPEG thumbnail from 25% into the video blob. */
  function extractThumbnail(blob: Blob): Promise<string> {
    return new Promise(resolve => {
      const url = URL.createObjectURL(blob)
      const video = document.createElement('video')
      video.muted = true
      video.preload = 'metadata'
      let durationKnown = false

      const cleanup = () => { URL.revokeObjectURL(url); video.src = '' }

      const drawFrame = () => {
        try {
          const w = Math.min(video.videoWidth || 640, 640)
          const h = video.videoHeight
            ? Math.round(w * video.videoHeight / video.videoWidth)
            : 360
          const canvas = document.createElement('canvas')
          canvas.width = w; canvas.height = h
          canvas.getContext('2d')!.drawImage(video, 0, 0, w, h)
          cleanup()
          resolve(canvas.toDataURL('image/jpeg', 0.75))
        } catch {
          cleanup()
          resolve('')
        }
      }

      video.onloadedmetadata = () => {
        const d = video.duration
        if (isFinite(d) && d > 0) {
          durationKnown = true
          video.currentTime = d * 0.25
        } else {
          // MediaRecorder WebM has no duration header — seek to force parse
          video.currentTime = 1e101
        }
      }

      video.onseeked = () => {
        if (!durationKnown) {
          // First seeked fires after the 1e101 probe — now duration is real
          const d = video.duration
          durationKnown = true
          if (isFinite(d) && d > 0) {
            video.currentTime = d * 0.25
            return   // wait for second seeked
          }
        }
        drawFrame()
      }

      video.onerror = () => { cleanup(); resolve('') }
      video.src = url
    })
  }

  const handleClose = () => {
    clearTimer()
    streamRef.current?.getTracks().forEach(t => t.stop())
    mediaRecorderRef.current?.stop()
    onClose()
  }

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="glass-refractive rounded-3xl p-8 w-[520px] shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-tertiary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-tertiary text-lg">videocam</span>
            </div>
            <h3 className="text-lg font-bold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Screen Recorder
            </h3>
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-white transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Source picker */}
        {state === 'source-pick' && (
          <div className="space-y-4">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Select Source
            </p>
            <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-1">
              {sources.map(src => (
                <button
                  key={src.id}
                  onClick={() => setSelectedSource(src)}
                  className={`flex flex-col gap-2 p-3 rounded-2xl border transition-all text-left ${
                    selectedSource?.id === src.id
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="aspect-video bg-slate-900 rounded-xl overflow-hidden">
                    <img src={src.thumbnail} className="w-full h-full object-cover opacity-80" />
                  </div>
                  <span className="text-xs font-semibold text-slate-300 truncate" style={{ fontFamily: 'Manrope, sans-serif' }}>
                    {src.name}
                  </span>
                </button>
              ))}
            </div>

            {error && (
              <p className="text-xs text-tertiary">{error}</p>
            )}

            <button
              onClick={startCountdown}
              disabled={!selectedSource}
              className="w-full primary-gradient text-slate-900 font-bold py-4 rounded-2xl flex items-center justify-center gap-3 hover:scale-[1.02] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              <span className="material-symbols-outlined">fiber_manual_record</span>
              Start Recording
            </button>
          </div>
        )}

        {/* Countdown */}
        {state === 'countdown' && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div
              className="text-8xl font-black primary-gradient-text"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              {countdown}
            </div>
            <p className="text-slate-400 text-sm">Recording starts in…</p>
          </div>
        )}

        {/* Recording in progress */}
        {state === 'recording' && (
          <div className="space-y-6">
            <div className="flex items-center justify-center gap-4 py-6">
              <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.8)]" />
              <span
                className="text-4xl font-black text-white tabular-nums"
                style={{ fontFamily: 'Manrope, sans-serif' }}
              >
                {formatTime(elapsed)}
              </span>
            </div>

            <div className="glass-card rounded-2xl p-4 flex items-center gap-3">
              <span className="material-symbols-outlined text-slate-400 text-sm">monitor</span>
              <span className="text-sm text-slate-300 truncate">{selectedSource?.name}</span>
            </div>

            <button
              onClick={stopRecording}
              className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-bold text-sm transition-all bg-red-500/20 hover:bg-red-500/40 border border-red-500/30 text-red-400"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              <span className="material-symbols-outlined">stop_circle</span>
              Stop Recording  ·  {formatTime(elapsed)}
            </button>
          </div>
        )}

        {/* Saving */}
        {state === 'saving' && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-400 text-sm">Saving recording…</p>
          </div>
        )}

        {/* Done */}
        {state === 'done' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-white/5 rounded-2xl">
              <span className="material-symbols-outlined text-secondary">check_circle</span>
              <div>
                <p className="text-sm font-semibold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>Recording saved</p>
                <p className="text-xs text-slate-400 truncate max-w-xs">{savedPath}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => savedPath && window.electronAPI?.openPath(savedPath)}
                className="flex items-center justify-center gap-2 py-3 bg-white/5 hover:bg-white/10 rounded-2xl text-sm font-semibold text-white transition-all border border-white/10"
                style={{ fontFamily: 'Manrope, sans-serif' }}
              >
                <span className="material-symbols-outlined text-sm">folder_open</span>
                Show in folder
              </button>
              <button
                onClick={handleClose}
                className="primary-gradient text-slate-900 font-bold py-3 rounded-2xl text-sm"
                style={{ fontFamily: 'Manrope, sans-serif' }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
