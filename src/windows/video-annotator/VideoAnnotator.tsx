import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ShareDialog from '../../components/ShareDialog'
import { useLocalVideoUrl } from '../../hooks/useLocalVideoUrl'

type DrawTool = 'pen' | 'rect' | 'ellipse' | 'arrow' | 'text'
interface Point { x: number; y: number }

interface DrawOp {
  tool: DrawTool
  color: string
  sw: number          // strokeWidth
  pts?: Point[]       // pen (freehand) or arrow [from, to]
  sx?: number         // startX for rect/ellipse on mousedown
  sy?: number
  x?: number; y?: number
  w?: number; h?: number
  rx?: number; ry?: number  // ellipse radii
  text?: string
}

const TOOLS: { id: DrawTool; icon: string; label: string }[] = [
  { id: 'pen',     icon: 'draw',          label: 'Pen' },
  { id: 'rect',    icon: 'rectangle',     label: 'Rect' },
  { id: 'ellipse', icon: 'circle',        label: 'Ellipse' },
  { id: 'arrow',   icon: 'arrow_forward', label: 'Arrow' },
  { id: 'text',    icon: 'text_fields',   label: 'Text' },
]

const COLORS = ['#ff6c95', '#b6a0ff', '#00e3fd', '#ffffff', '#fbbf24', '#34d399', '#f87171', '#000000']

function paintOp(ctx: CanvasRenderingContext2D, op: DrawOp) {
  ctx.save()
  ctx.strokeStyle = op.color
  ctx.fillStyle = op.color
  ctx.lineWidth = op.sw
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (op.tool === 'pen' && op.pts && op.pts.length > 1) {
    ctx.beginPath()
    ctx.moveTo(op.pts[0].x, op.pts[0].y)
    for (let i = 1; i < op.pts.length; i++) ctx.lineTo(op.pts[i].x, op.pts[i].y)
    ctx.stroke()
  } else if (op.tool === 'rect') {
    ctx.strokeRect(op.x ?? 0, op.y ?? 0, op.w ?? 0, op.h ?? 0)
  } else if (op.tool === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(op.x ?? 0, op.y ?? 0, op.rx ?? 0, op.ry ?? 0, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (op.tool === 'arrow' && op.pts?.length === 2) {
    const [a, b] = op.pts
    if (!a || !b) return
    if (!isFinite(a.x) || !isFinite(a.y) || !isFinite(b.x) || !isFinite(b.y)) return
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1) return   // zero-length arrow — nothing to draw
    const headLen = Math.min(Math.max(12, op.sw * 4), len * 0.9)
    const angle = Math.atan2(dy, dx)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(b.x - headLen * Math.cos(angle - Math.PI / 6), b.y - headLen * Math.sin(angle - Math.PI / 6))
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(b.x - headLen * Math.cos(angle + Math.PI / 6), b.y - headLen * Math.sin(angle + Math.PI / 6))
    ctx.stroke()
  } else if (op.tool === 'text' && op.text) {
    ctx.font = `bold ${op.sw * 5 + 14}px Manrope, sans-serif`
    ctx.fillText(op.text, op.x ?? 0, op.y ?? 0)
  }
  ctx.restore()
}

export default function VideoAnnotator() {
  const location = useLocation()
  const navigate = useNavigate()
  const { filePath = '', name = 'Recording' } = (location.state ?? {}) as { filePath?: string; name?: string }

  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [tool, setTool] = useState<DrawTool>('pen')
  const [color, setColor] = useState('#ff6c95')
  const [sw, setSw] = useState(3)

  const [isPlaying, setIsPlaying]   = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration]     = useState(0)
  const [videoReady, setVideoReady] = useState(false)
  const durationFixed = useRef(false)   // prevent re-entry in Infinity-fix seek loop

  const [ops, setOps]       = useState<DrawOp[]>([])
  const opsRef              = useRef<DrawOp[]>([])   // mirror for use inside callbacks
  const liveRef             = useRef<DrawOp | null>(null)
  const drawing             = useRef(false)

  const [showShare, setShowShare] = useState(false)
  const [exportUrl, setExportUrl] = useState('')
  const [textInput, setTextInput] = useState<{ x: number; y: number; canvasX: number; canvasY: number } | null>(null)
  const [textValue, setTextValue] = useState('')

  const [exporting, setExporting]         = useState(false)
  const [exportProgress, setExportProgress] = useState(0)   // 0–1
  const [exportSaved, setExportSaved]     = useState('')    // saved file path

  const rafRef       = useRef<number | null>(null)
  const exportRafRef = useRef<number | null>(null)
  const exportRecRef = useRef<MediaRecorder | null>(null)

  const videoSrc = useLocalVideoUrl(filePath)

  // ── Duration probe (separate element — never touches the main <video>) ────────
  // MediaRecorder WebM files don't write a duration header, so duration = Infinity.
  // We fix this by seeking a throwaway video element to 1e101 to force Chromium
  // to parse the file length, then read the real duration — all without interrupting
  // the main video's playback state.
  useEffect(() => {
    if (!videoSrc) return
    const tmp = document.createElement('video')
    tmp.muted = true
    tmp.preload = 'metadata'
    let resolved = false

    const finish = (d: number) => {
      if (resolved) return
      resolved = true
      if (isFinite(d) && d > 0) { setDuration(d); durationFixed.current = true }
      tmp.src = ''
    }

    tmp.onloadedmetadata = () => {
      const d = tmp.duration
      if (isFinite(d) && d > 0) { finish(d); return }
      tmp.currentTime = 1e101   // probe: seek to force Chromium to parse duration
    }
    tmp.onseeked = () => finish(tmp.duration)
    tmp.onerror  = () => { tmp.src = '' }
    tmp.src = videoSrc

    return () => { resolved = true; tmp.src = '' }
  }, [videoSrc])

  // Keep opsRef in sync so callbacks always see latest ops
  useEffect(() => { opsRef.current = ops }, [ops])

  // ── Canvas sizing ────────────────────────────────────────────────────────────
  // Key insight: canvas.width/height (pixel buffer) ≠ CSS width/height (display).
  // We always set both to video.offsetWidth/Height so coords map 1:1.
  const syncCanvas = useCallback(() => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return false
    const w = video.offsetWidth
    const h = video.offsetHeight
    if (w <= 0 || h <= 0) return false
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width        = w
      canvas.height       = h
      canvas.style.width  = `${w}px`
      canvas.style.height = `${h}px`
    }
    return true
  }, [])

  // ── Rendering ────────────────────────────────────────────────────────────────
  const repaint = useCallback((allOps: DrawOp[], live: DrawOp | null = null) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    allOps.forEach(op => { if (op) paintOp(ctx, op) })
    if (live) paintOp(ctx, live)
  }, [])

  // Repaint whenever ops array changes
  useEffect(() => { repaint(ops) }, [ops, repaint])

  // ── ResizeObserver ───────────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const ro = new ResizeObserver(() => {
      if (syncCanvas()) repaint(opsRef.current)
    })
    ro.observe(video)
    return () => ro.disconnect()
  }, [syncCanvas, repaint])

  // ── Pointer helpers ──────────────────────────────────────────────────────────
  const getPos = (e: React.MouseEvent<HTMLCanvasElement>): Point | null => {
    const canvas = canvasRef.current!
    const r = canvas.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    const scaleX = canvas.width  / r.width
    const scaleY = canvas.height / r.height
    return {
      x: (e.clientX - r.left) * scaleX,
      y: (e.clientY - r.top)  * scaleY
    }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPlaying) return
    e.preventDefault()

    const pos = getPos(e)
    if (!pos) return

    if (tool === 'text') {
      // Show inline text input at the click position (avoids blocking prompt())
      const r = canvasRef.current!.getBoundingClientRect()
      setTextInput({ x: e.clientX - r.left, y: e.clientY - r.top, canvasX: pos.x, canvasY: pos.y })
      setTextValue('')
      return
    }

    drawing.current = true
    let op: DrawOp = { tool, color, sw }
    if      (tool === 'pen')     op = { ...op, pts: [pos] }
    else if (tool === 'rect')    op = { ...op, sx: pos.x, sy: pos.y, x: pos.x, y: pos.y, w: 0, h: 0 }
    else if (tool === 'ellipse') op = { ...op, sx: pos.x, sy: pos.y, x: pos.x, y: pos.y, rx: 0, ry: 0 }
    else if (tool === 'arrow')   op = { ...op, pts: [pos, pos] }
    liveRef.current = op
  }

  const commitText = () => {
    if (textInput && textValue.trim()) {
      setOps(prev => [...prev, { tool: 'text', color, sw, text: textValue.trim(), x: textInput.canvasX, y: textInput.canvasY }])
    }
    setTextInput(null)
    setTextValue('')
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !liveRef.current) return
    const pos = getPos(e)
    if (!pos) return
    const op = liveRef.current

    if (op.tool === 'pen') {
      liveRef.current = { ...op, pts: [...(op.pts ?? []), pos] }
    } else if (op.tool === 'rect') {
      const x = Math.min(op.sx!, pos.x)
      const y = Math.min(op.sy!, pos.y)
      liveRef.current = { ...op, x, y, w: Math.abs(pos.x - op.sx!), h: Math.abs(pos.y - op.sy!) }
    } else if (op.tool === 'ellipse') {
      const dx = pos.x - op.sx!
      const dy = pos.y - op.sy!
      liveRef.current = { ...op, x: op.sx! + dx / 2, y: op.sy! + dy / 2, rx: Math.abs(dx) / 2, ry: Math.abs(dy) / 2 }
    } else if (op.tool === 'arrow') {
      liveRef.current = { ...op, pts: [op.pts![0], pos] }
    }

    // Throttle live repaints to display refresh rate
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const snapshot = liveRef.current
    rafRef.current = requestAnimationFrame(() => {
      repaint(opsRef.current, snapshot)
      rafRef.current = null
    })
  }

  const handleMouseUp = () => {
    const op = liveRef.current   // capture before any async interference
    if (!drawing.current || !op) return
    drawing.current = false
    liveRef.current = null
    setOps(prev => [...prev, op])
  }

  // ── Composite export ─────────────────────────────────────────────────────────
  const composite = useCallback((): string => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || video.readyState < 2) return ''

    const out = document.createElement('canvas')
    out.width  = video.videoWidth
    out.height = video.videoHeight
    const ctx  = out.getContext('2d')!

    ctx.drawImage(video, 0, 0, out.width, out.height)

    if (canvas && canvas.width > 0) {
      // Scale annotation overlay from display size → natural video size
      ctx.drawImage(canvas, 0, 0, out.width, out.height)
    }

    return out.toDataURL('image/png')
  }, [])

  const handleExtractFrame = () => {
    videoRef.current?.pause()
    const video = videoRef.current
    if (!video || video.readyState < 2) return
    const out = document.createElement('canvas')
    out.width  = video.videoWidth
    out.height = video.videoHeight
    out.getContext('2d')!.drawImage(video, 0, 0)
    navigate('/editor', { state: { dataUrl: out.toDataURL('image/png') } })
  }

  const handleExport = () => {
    videoRef.current?.pause()
    const url = composite()
    if (!url) return
    setExportUrl(url)
    setShowShare(true)
  }

  // ── WebM export with baked-in annotations ────────────────────────────────────
  const handleExportVideo = useCallback(async () => {
    const video  = videoRef.current
    const annot  = canvasRef.current
    if (!video || video.readyState < 2) return

    setExporting(true)
    setExportProgress(0)
    setExportSaved('')

    // Offscreen composite canvas at natural resolution
    const w = video.videoWidth
    const h = video.videoHeight
    const comp = document.createElement('canvas')
    comp.width = w; comp.height = h
    const ctx = comp.getContext('2d')!

    // Capture the composite canvas as a video stream
    const stream = (comp as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(30)
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8' : 'video/webm'
    const recorder = new MediaRecorder(stream, { mimeType })
    exportRecRef.current = recorder
    const chunks: Blob[] = []
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }

    // rAF loop: composite video frame + annotation overlay every frame
    const drawLoop = () => {
      ctx.drawImage(video, 0, 0, w, h)
      if (annot && annot.width > 0) ctx.drawImage(annot, 0, 0, w, h)
      exportRafRef.current = requestAnimationFrame(drawLoop)
    }

    const stopExport = () => {
      if (exportRafRef.current) { cancelAnimationFrame(exportRafRef.current); exportRafRef.current = null }
      if (recorder.state !== 'inactive') recorder.stop()
      video.removeEventListener('ended',  stopExport)
      video.removeEventListener('pause',  onPause)
    }

    // If user pauses during export, treat as cancel
    const onPause = () => {
      stopExport()
      setExporting(false)
    }

    recorder.onstop = async () => {
      video.removeEventListener('ended', stopExport)
      video.removeEventListener('pause', onPause)

      const blob = new Blob(chunks, { type: 'video/webm' })
      const buffer = await blob.arrayBuffer()
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `annotated-${ts}.webm`
      try {
        const filePath = await window.electronAPI?.saveRecording(buffer, filename) ?? ''
        setExportSaved(filePath)
      } catch { /* ignore */ }
      setExporting(false)
    }

    video.addEventListener('ended', stopExport, { once: true })
    video.addEventListener('pause', onPause)

    // Seek to beginning, start recording, start playback
    video.currentTime = 0
    await new Promise<void>(res => { video.addEventListener('seeked', () => res(), { once: true }) })
    recorder.start(500)
    exportRafRef.current = requestAnimationFrame(drawLoop)
    video.play().catch(() => stopExport())
  }, [])

  const handleCancelExport = () => {
    if (exportRafRef.current) { cancelAnimationFrame(exportRafRef.current); exportRafRef.current = null }
    if (exportRecRef.current && exportRecRef.current.state !== 'inactive') exportRecRef.current.stop()
    videoRef.current?.pause()
    setExporting(false)
  }

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  if (!filePath) {
    return (
      <div className="h-screen flex items-center justify-center text-slate-600 flex-col gap-6 pt-16">
        <span className="material-symbols-outlined text-5xl">videocam_off</span>
        <div className="text-center">
          <p className="text-sm font-medium text-slate-400 mb-1" style={{ fontFamily: 'Manrope, sans-serif' }}>No video file path provided</p>
          <p className="text-xs text-slate-600">Open a recording from the History page</p>
        </div>
        <button onClick={() => navigate('/history')} className="primary-gradient text-slate-900 font-bold px-8 py-3 rounded-2xl hover:scale-105 transition-transform text-sm" style={{ fontFamily: 'Manrope, sans-serif' }}>
          Go to History
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Header */}
      <header className="h-14 liquid-glass flex items-center justify-between px-6 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/history')} className="text-slate-400 hover:text-white transition-colors">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h2 className="text-sm font-bold text-white truncate max-w-xs" style={{ fontFamily: 'Manrope, sans-serif' }}>{name}</h2>
        </div>
        <div className="flex items-center gap-3">
          {ops.length > 0 && <>
            <button onClick={() => setOps(p => p.slice(0, -1))} className="text-slate-400 hover:text-white transition-colors" title="Undo">
              <span className="material-symbols-outlined text-[20px]">undo</span>
            </button>
            <button onClick={() => setOps([])} className="text-xs font-semibold text-slate-400 hover:text-tertiary transition-colors px-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Clear
            </button>
          </>}
          <button
            onClick={handleExtractFrame}
            disabled={!videoReady}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            <span className="material-symbols-outlined text-sm">photo_camera</span>
            Extract Frame
          </button>
          <button
            onClick={handleExport}
            disabled={!videoReady || exporting}
            className="primary-gradient text-slate-900 font-bold text-xs px-5 py-2 rounded-xl flex items-center gap-2 hover:scale-105 transition-transform disabled:opacity-40"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            <span className="material-symbols-outlined text-sm">rocket_launch</span>
            Export Frame
          </button>
          <button
            onClick={handleExportVideo}
            disabled={!videoReady || exporting}
            className="flex items-center gap-2 px-4 py-2 bg-tertiary/10 hover:bg-tertiary/20 border border-tertiary/30 rounded-xl text-xs font-bold text-tertiary transition-all disabled:opacity-40"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            <span className="material-symbols-outlined text-sm">movie</span>
            Export Video
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">

        {/* Video + overlay canvas */}
        <div className="flex-1 flex items-center justify-center overflow-hidden" style={{ background: 'radial-gradient(circle, #0f172a 0%, #020617 100%)' }}>
          {!videoSrc ? (
            <div className="flex flex-col items-center gap-3 text-slate-500">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm" style={{ fontFamily: 'Manrope, sans-serif' }}>Loading video…</span>
            </div>
          ) : (
          <div className="relative" style={{ lineHeight: 0 }}>
            <video
              ref={videoRef}
              src={videoSrc}
              className="block"
              style={{ maxWidth: 'calc(100vw - 17rem)', maxHeight: 'calc(100vh - 8rem)' }}
              onLoadedMetadata={() => {
                // If the browser already has a finite duration (normal files), use it.
                // MediaRecorder WebM won't — the separate probe effect handles that case.
                const d = videoRef.current?.duration ?? 0
                if (isFinite(d) && d > 0) { setDuration(d); durationFixed.current = true }
              }}
              onDurationChange={() => {
                const d = videoRef.current?.duration ?? 0
                if (isFinite(d) && d > 0) { setDuration(d); durationFixed.current = true }
              }}
              onLoadedData={() => {
                setVideoReady(true)
                requestAnimationFrame(() => {
                  if (syncCanvas()) repaint(opsRef.current)
                })
              }}
              onTimeUpdate={() => {
                const t = videoRef.current?.currentTime ?? 0
                setCurrentTime(t)
                if (exporting && duration > 0) setExportProgress(t / duration)
              }}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
            />

            {/* Canvas overlay — dimensions set explicitly in syncCanvas, not via CSS */}
            <canvas
              ref={canvasRef}
              className="absolute top-0 left-0"
              style={{ cursor: isPlaying ? 'default' : tool === 'text' ? 'text' : 'crosshair' }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />

            {/* Inline text input — replaces blocking prompt() */}
            {textInput && (
              <div
                className="absolute z-10"
                style={{ left: textInput.x, top: textInput.y }}
              >
                <input
                  autoFocus
                  value={textValue}
                  onChange={e => setTextValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitText()
                    if (e.key === 'Escape') { setTextInput(null); setTextValue('') }
                  }}
                  onBlur={commitText}
                  className="bg-black/70 text-white border border-primary/50 rounded px-2 py-1 text-sm outline-none min-w-32"
                  style={{ fontFamily: 'Manrope, sans-serif', color, caretColor: 'white' }}
                  placeholder="Type text…"
                />
              </div>
            )}

            {!isPlaying && videoReady && ops.length === 0 && !textInput && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 glass-refractive rounded-full px-4 py-1.5 text-xs text-slate-300 pointer-events-none" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Draw on the paused frame · Play to scrub
              </div>
            )}
          </div>
          )}
        </div>

        {/* Right panel */}
        <aside className="w-60 glass-refractive border-l border-white/5 flex flex-col p-4 gap-5 overflow-y-auto flex-shrink-0">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold ${isPlaying ? 'bg-secondary/10 text-secondary' : 'bg-primary/10 text-primary'}`} style={{ fontFamily: 'Manrope, sans-serif' }}>
            <span className="material-symbols-outlined text-sm">{isPlaying ? 'play_circle' : 'edit'}</span>
            {isPlaying ? 'Pause to annotate' : 'Annotating frame'}
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3" style={{ fontFamily: 'Manrope, sans-serif' }}>Tool</p>
            <div className="grid grid-cols-3 gap-2">
              {TOOLS.map(({ id, icon, label }) => (
                <button key={id} title={label} onClick={() => setTool(id)}
                  className={`p-2.5 rounded-xl flex items-center justify-center transition-all ${tool === id ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'}`}>
                  <span className="material-symbols-outlined text-[18px]">{icon}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3" style={{ fontFamily: 'Manrope, sans-serif' }}>Color</p>
            <div className="grid grid-cols-4 gap-2">
              {COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className={`w-full aspect-square rounded-xl transition-all hover:scale-110 ${color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-slate-900 scale-110' : ''}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2" style={{ fontFamily: 'Manrope, sans-serif' }}>Stroke — {sw}px</p>
            <input type="range" min={1} max={20} value={sw} onChange={e => setSw(Number(e.target.value))} className="w-full accent-primary" />
          </div>

          {ops.length > 0 && <p className="text-[11px] text-slate-500 text-center">{ops.length} annotation{ops.length !== 1 ? 's' : ''}</p>}

          <div className="mt-auto space-y-2 text-[11px] text-slate-600 border-t border-white/5 pt-4">
            <p><span className="text-slate-400 font-semibold">Extract Frame</span> — current frame as PNG in annotation editor.</p>
            <p><span className="text-slate-400 font-semibold">Export Frame</span> — current frame + drawings as a PNG for sharing.</p>
            <p><span className="text-slate-400 font-semibold">Export Video</span> — new .webm with drawings baked into every frame (plays in real-time).</p>
          </div>
        </aside>
      </div>

      {/* Playback bar / Export progress bar */}
      <div className="h-14 liquid-glass border-t border-white/5 flex items-center gap-4 px-6 flex-shrink-0">
        {exporting ? (
          <>
            <div className="w-4 h-4 border-2 border-tertiary border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <span className="text-xs font-bold text-tertiary flex-shrink-0" style={{ fontFamily: 'Manrope, sans-serif' }}>Rendering…</span>
            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-tertiary rounded-full transition-all duration-300"
                style={{ width: `${exportProgress * 100}%` }}
              />
            </div>
            <span className="text-xs font-mono text-slate-400 w-12 flex-shrink-0">
              {fmt(currentTime)} / {isFinite(duration) && duration > 0 ? fmt(duration) : '--:--'}
            </span>
            <button
              onClick={handleCancelExport}
              className="flex-shrink-0 px-3 py-1.5 text-xs font-bold text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-all"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => isPlaying ? videoRef.current?.pause() : videoRef.current?.play()}
              className="w-9 h-9 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary transition-all flex-shrink-0"
            >
              <span className="material-symbols-outlined text-sm">{isPlaying ? 'pause' : 'play_arrow'}</span>
            </button>
            <span className="text-xs font-mono text-slate-400 w-12 text-right flex-shrink-0">{fmt(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={isFinite(duration) && duration > 0 ? duration : 100}
              step={0.05}
              value={currentTime}
              onChange={e => {
                const t = Number(e.target.value)
                if (videoRef.current) videoRef.current.currentTime = t
                setCurrentTime(t)
              }}
              className="flex-1 accent-primary"
            />
            <span className="text-xs font-mono text-slate-400 w-12 flex-shrink-0">
              {isFinite(duration) && duration > 0 ? fmt(duration) : '--:--'}
            </span>
          </>
        )}
      </div>

      {/* Export saved toast */}
      {exportSaved && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 glass-refractive rounded-2xl px-5 py-3 flex items-center gap-3 z-50 border border-secondary/20">
          <span className="material-symbols-outlined text-secondary text-sm">check_circle</span>
          <span className="text-xs font-semibold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>Annotated video saved</span>
          <button onClick={() => exportSaved && window.electronAPI?.openPath(exportSaved)} className="text-xs text-secondary hover:underline" style={{ fontFamily: 'Manrope, sans-serif' }}>Show in folder</button>
          <button onClick={() => setExportSaved('')} className="text-slate-500 hover:text-white ml-1">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

      {showShare && exportUrl && <ShareDialog imageDataUrl={exportUrl} onClose={() => setShowShare(false)} />}
    </div>
  )
}
