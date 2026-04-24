import { useEffect, useRef } from 'react'
import fixWebmDuration from 'fix-webm-duration'

interface RecordingTarget {
  kind: 'region' | 'window' | 'screen'
  sourceId: string
  displayId: number
  rect?: { x: number; y: number; width: number; height: number }
  physicalRect?: { x: number; y: number; width: number; height: number }
}

/** Headless renderer that owns the MediaRecorder. No user-facing UI — the
 *  toolbar (separate window) issues commands via main-process IPC. */
export default function RecorderHost() {
  // Refs so IPC event handlers always read current values, not stale closures.
  const targetRef        = useRef<RecordingTarget | null>(null)
  const desktopStreamRef = useRef<MediaStream | null>(null)
  const micStreamRef     = useRef<MediaStream | null>(null)
  const outStreamRef     = useRef<MediaStream | null>(null)
  const recorderRef      = useRef<MediaRecorder | null>(null)
  const chunksRef        = useRef<Blob[]>([])

  const videoElRef       = useRef<HTMLVideoElement | null>(null)
  const canvasElRef      = useRef<HTMLCanvasElement | null>(null)
  const drawLoopRef      = useRef<number | null>(null)

  // Timing
  const runStartRef      = useRef<number>(0)
  const accumulatedMsRef = useRef<number>(0)
  const tickTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let mounted = true

    // ── Acquire stream ──────────────────────────────────────────────────
    ;(async () => {
      try {
        const target = await window.electronAPI?.recorderGetTarget?.()
        if (!mounted) return
        if (!target) throw new Error('No recording target set')
        targetRef.current = target as RecordingTarget

        // Request the biggest native resolution for the chosen source so
        // cropping works on physical pixels. 30fps cap is intentional (reduces
        // WGC frame-drop on Windows).
        const maxW = 3840
        const maxH = 2160
        const desktopStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            // @ts-expect-error Electron-specific constraint
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: target.sourceId,
              minWidth: 1280,
              maxWidth: maxW,
              minHeight: 720,
              maxHeight: maxH,
              maxFrameRate: 30,
            },
          },
        })
        if (!mounted) { desktopStream.getTracks().forEach(t => t.stop()); return }
        desktopStreamRef.current = desktopStream

        // Build the output stream that MediaRecorder will consume.
        // - Region/window: pipe through a <canvas> so we only record the crop.
        // - Screen: pass the desktop stream through directly.
        let outStream: MediaStream
        if ((target.kind === 'region' || target.kind === 'window') && target.physicalRect) {
          outStream = buildCroppedStream(
            desktopStream,
            target.physicalRect,
            videoElRef,
            canvasElRef,
            drawLoopRef,
          )
        } else {
          outStream = desktopStream
        }
        outStreamRef.current = outStream

        // Try to pre-acquire mic so the toggle is instant (muted by default).
        // If permission is denied, just proceed without it — user can still record.
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
          if (!mounted) { micStream.getTracks().forEach(t => t.stop()); return }
          micStreamRef.current = micStream
          const track = micStream.getAudioTracks()[0]
          if (track) {
            track.enabled = false
            outStream.addTrack(track)
          }
        } catch {
          // No mic — continue without audio track at all.
        }

        window.electronAPI?.recorderReady?.(true)
      } catch (err: any) {
        console.error('[recorder-host] acquire failed', err)
        window.electronAPI?.recorderReady?.(false, err?.message ?? String(err))
      }
    })()

    // ── Listen for control signals from main ────────────────────────────

    const onBegin = () => {
      const out = outStreamRef.current
      if (!out || recorderRef.current) return

      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm'

      const recorder = new MediaRecorder(out, { mimeType: mime })
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = finalizeRecording
      recorder.start(1000)
      recorderRef.current = recorder

      runStartRef.current = Date.now()
      accumulatedMsRef.current = 0
      if (tickTimerRef.current) clearInterval(tickTimerRef.current)
      tickTimerRef.current = setInterval(() => {
        const r = recorderRef.current
        if (!r) return
        if (r.state === 'recording') {
          const ms = accumulatedMsRef.current + (Date.now() - runStartRef.current)
          window.electronAPI?.recorderTick?.(ms)
        }
      }, 250)
    }

    const onPause = () => {
      const r = recorderRef.current
      if (!r || r.state !== 'recording') return
      r.pause()
      accumulatedMsRef.current += Date.now() - runStartRef.current
    }

    const onResume = () => {
      const r = recorderRef.current
      if (!r || r.state !== 'paused') return
      runStartRef.current = Date.now()
      r.resume()
    }

    const onStopRequest = () => {
      const r = recorderRef.current
      if (!r) return
      if (r.state === 'paused') accumulatedMsRef.current += 0
      else if (r.state === 'recording') accumulatedMsRef.current += Date.now() - runStartRef.current
      if (r.state !== 'inactive') r.stop()   // triggers onstop → finalizeRecording
    }

    const onCancelRequest = () => {
      const r = recorderRef.current
      if (r && r.state !== 'inactive') {
        r.ondataavailable = null as any
        r.onstop = null as any
        try { r.stop() } catch { /* ignore */ }
      }
      chunksRef.current = []
      teardownStreams()
    }

    const onMicToggle = (enabled: boolean) => {
      const mic = micStreamRef.current
      if (!mic) return
      const track = mic.getAudioTracks()[0]
      if (track) track.enabled = enabled
    }

    window.electronAPI?.onRecorderBegin?.(onBegin)
    window.electronAPI?.onRecorderPause?.(onPause)
    window.electronAPI?.onRecorderResume?.(onResume)
    window.electronAPI?.onRecorderStopRequest?.(onStopRequest)
    window.electronAPI?.onRecorderCancelRequest?.(onCancelRequest)
    window.electronAPI?.onRecorderMicToggle?.(onMicToggle)

    return () => {
      mounted = false
      window.electronAPI?.removeAllListeners?.('recorder:begin')
      window.electronAPI?.removeAllListeners?.('recorder:pause')
      window.electronAPI?.removeAllListeners?.('recorder:resume')
      window.electronAPI?.removeAllListeners?.('recorder:stop-request')
      window.electronAPI?.removeAllListeners?.('recorder:cancel-request')
      window.electronAPI?.removeAllListeners?.('recorder:mic-toggle')
      if (tickTimerRef.current) clearInterval(tickTimerRef.current)
      teardownStreams()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function teardownStreams() {
    if (drawLoopRef.current != null) {
      cancelAnimationFrame(drawLoopRef.current)
      drawLoopRef.current = null
    }
    try { desktopStreamRef.current?.getTracks().forEach(t => t.stop()) } catch { /* ignore */ }
    try { micStreamRef.current?.getTracks().forEach(t => t.stop()) } catch { /* ignore */ }
    try { outStreamRef.current?.getTracks().forEach(t => t.stop()) } catch { /* ignore */ }
    desktopStreamRef.current = null
    micStreamRef.current = null
    outStreamRef.current = null
  }

  async function finalizeRecording() {
    const chunks = chunksRef.current
    chunksRef.current = []
    const durationMs = accumulatedMsRef.current
    let blob = new Blob(chunks, { type: 'video/webm' })
    teardownStreams()

    // MediaRecorder streams WebM progressively and never writes the duration
    // cue, so without this patch `<video>.duration` is Infinity and no player
    // (Lumia, VLC, browsers) can show a correct timeline. Inject the real
    // duration into the EBML header before the file touches disk.
    if (durationMs > 0) {
      try { blob = await fixWebmDuration(blob, durationMs, { logger: false }) }
      catch { /* fall back to unpatched blob — still playable, just no duration */ }
    }

    let thumbnail = ''
    try { thumbnail = await extractThumbnail(blob) } catch { /* ignore */ }

    const buffer = await blob.arrayBuffer()
    window.electronAPI?.recorderStateChange?.('saving')
    try {
      await window.electronAPI?.recorderSaveBlob?.(buffer, thumbnail, durationMs)
    } catch (err: any) {
      window.electronAPI?.recorderStateChange?.('error', { error: err?.message ?? String(err) })
    }
  }

  // Invisible host — hide any stray video/canvas elements.
  return (
    <div style={{ display: 'none' }}>
      <video ref={videoElRef} muted playsInline />
      <canvas ref={canvasElRef} />
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Pipe a desktop stream through a <video> + <canvas> so the recorded output
 *  only contains the physical-pixel rect inside the capture source. */
function buildCroppedStream(
  desktopStream: MediaStream,
  physicalRect: { x: number; y: number; width: number; height: number },
  videoRef: React.MutableRefObject<HTMLVideoElement | null>,
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>,
  loopRef: React.MutableRefObject<number | null>,
): MediaStream {
  const video = videoRef.current!
  const canvas = canvasRef.current!
  canvas.width = physicalRect.width
  canvas.height = physicalRect.height

  video.srcObject = desktopStream
  video.muted = true
  video.playsInline = true
  video.play().catch(() => { /* autoplay policy — muted is allowed */ })

  const ctx = canvas.getContext('2d', { alpha: false })!
  const draw = () => {
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (vw > 0 && vh > 0) {
      // Clamp source rect to video bounds so clipping never throws.
      const sx = Math.max(0, Math.min(vw - 1, physicalRect.x))
      const sy = Math.max(0, Math.min(vh - 1, physicalRect.y))
      const sw = Math.max(1, Math.min(vw - sx, physicalRect.width))
      const sh = Math.max(1, Math.min(vh - sy, physicalRect.height))
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, physicalRect.width, physicalRect.height)
    }
    loopRef.current = requestAnimationFrame(draw)
  }
  loopRef.current = requestAnimationFrame(draw)

  return canvas.captureStream(30)
}

/** Extract a JPEG thumbnail from ~25% into the recorded blob. Handles the
 *  "duration = Infinity" edge case that MediaRecorder WebM files exhibit. */
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
        video.currentTime = 1e101   // forces Chromium to parse length
      }
    }
    video.onseeked = () => {
      if (!durationKnown) {
        const d = video.duration
        durationKnown = true
        if (isFinite(d) && d > 0) { video.currentTime = d * 0.25; return }
      }
      drawFrame()
    }
    video.onerror = () => { cleanup(); resolve('') }
    video.src = url
  })
}
