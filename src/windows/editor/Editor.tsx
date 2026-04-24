import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AnnotationCanvas, {
  type CanvasHandle,
  Tool,
} from '../../components/AnnotationCanvas/Canvas'
import AnnotationToolBar from '../../components/AnnotationCanvas/ToolBar'
import { matchToolShortcut } from '../../components/AnnotationCanvas/tools'
import type { WorkflowTemplate, HistoryItem, SensitiveRegion, AnnotationObject } from '../../types'
import type { DrawObject } from '../../components/AnnotationCanvas/Canvas'
import { AutoBlurPanel } from '../../components/AutoBlurPanel'
import { deriveActions, type ActionBtn } from '../../lib/workflow-actions'
import { useLocalVideoUrl } from '../../hooks/useLocalVideoUrl'

/** Location.state shape accepted by the unified editor. Image mode carries a
 *  dataUrl; video mode carries filePath (+ optional display name). */
type EditorState = {
  kind?: 'image' | 'video'
  dataUrl?: string
  filePath?: string
  name?: string
  source?: string
  historyId?: string
  annotations?: AnnotationObject[]
}

// Tools / colors / shortcuts live in ../../components/AnnotationCanvas/tools.ts —
// the VideoAnnotator shares the same palette, so keeping them here would just
// invite drift.

// MediaRecorder writes WebM progressively and omits the duration cue, so on
// playback `video.duration === Infinity` and the scrubber breaks. Seeking to
// an absurdly large timestamp forces the browser to scan the whole file;
// when it finds the real end a `durationchange` fires with a finite value and
// we rewind to 0. Runs once per <video> instance.
function fixWebmDuration(e: React.SyntheticEvent<HTMLVideoElement>) {
  const v = e.currentTarget
  if (Number.isFinite(v.duration) && v.duration > 0) return
  const onDurChange = () => {
    if (Number.isFinite(v.duration) && v.duration > 0) {
      v.removeEventListener('durationchange', onDurChange)
      v.currentTime = 0
    }
  }
  v.addEventListener('durationchange', onDurChange)
  v.currentTime = 1e101
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24) return `${hrs}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function Editor() {
  const location = useLocation()
  const navigate = useNavigate()

  // Unified state — `kind` switches the editor between image and video mode.
  // Callers that navigate here must set `kind` explicitly; default is 'image'
  // so existing screenshot paths keep working without changes.
  const initialState = (location.state ?? {}) as EditorState
  const [kind, setKind] = useState<'image' | 'video'>(initialState.kind ?? (initialState.filePath ? 'video' : 'image'))
  const [imageDataUrl, setImageDataUrl] = useState<string>(initialState.dataUrl ?? '')
  const [videoFilePath, setVideoFilePath] = useState<string>(initialState.filePath ?? '')
  const [videoName, setVideoName]         = useState<string>(initialState.name ?? '')
  const [historyId, setHistoryId]         = useState<string | undefined>(initialState.historyId)
  const [initialAnnotations, setInitialAnnotations] = useState<AnnotationObject[] | undefined>(initialState.annotations)
  const isVideo = kind === 'video'

  const triggerNewCapture = useCallback(() => {
    window.electronAPI?.newCapture()
  }, [])
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#f87171')
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [exportTrigger, setExportTrigger] = useState(0)
  const [, setExportedDataUrl] = useState<string>('')
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [activeWorkflowId, setActiveWorkflowId] = useState<string>('')
  const [gdriveConnected, setGdriveConnected] = useState(false)
  const [imgurConfigured, setImgurConfigured] = useState(false)
  const [customConfigured, setCustomConfigured] = useState(false)
  const [toast, setToast] = useState<{ message: string; icon: string; type: 'success' | 'error' } | null>(null)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const pendingAction = useRef<string | null>(null)
  const canvasRef = useRef<CanvasHandle>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [clipboardHistory, setClipboardHistory] = useState<
    { id: string; thumbnailUrl: string; filePath?: string; legacyDataUrl?: string; name: string; timestamp: number }[]
  >([])
  const [showClipPanel, setShowClipPanel] = useState(false)
  const [showAutoBlur, setShowAutoBlur] = useState(false)
  // Color popover is now handled inside AnnotationToolBar.
  const [autoBlurScanning, setAutoBlurScanning] = useState(false)
  const [autoBlurRegions, setAutoBlurRegions] = useState<SensitiveRegion[]>([])
  const [autoBlurSelected, setAutoBlurSelected] = useState<Set<string>>(new Set())
  const [autoBlurOcrTime, setAutoBlurOcrTime] = useState<number>()
  const [, setAutoBlurDetectTime] = useState<number>()
  const [autoBlurHistory, setAutoBlurHistory] = useState<string[]>([])

  // Video is view-only here — plain HTML5 <video controls> for playback. Save
  // / Copy / Upload R2 operate on the source file directly, not on frames.
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoSrc = useLocalVideoUrl(isVideo ? videoFilePath : '')

  const resetForNewImage = useCallback((dataUrl: string) => {
    // No canvasRef.current?.clear() here — the Canvas is keyed on
    // `imageDataUrl` so it remounts (with fresh history) whenever the image
    // actually changes. Calling clear() here would also wipe replay that
    // Canvas just ran for a loaded history item, since Editor's location
    // effect runs AFTER Canvas's mount effects.
    setImageDataUrl(dataUrl)
    setExportTrigger(0)
    setAutoBlurRegions([])
    setAutoBlurSelected(new Set())
    setAutoBlurHistory([])
    setAutoBlurScanning(false)
    setAutoBlurOcrTime(undefined)
    setAutoBlurDetectTime(undefined)
    setShowAutoBlur(false)
  }, [])

  const activeTemplate = useMemo(() => {
    const found = templates.find(t => t.id === activeWorkflowId)
    if (found) return found
    return templates.find(t => t.id === 'builtin-r2') ?? templates[0]
  }, [templates, activeWorkflowId])
  const actionBtns = useMemo(
    () => deriveActions(activeTemplate, gdriveConnected, imgurConfigured, customConfigured, kind),
    [activeTemplate, gdriveConnected, imgurConfigured, customConfigured, kind],
  )

  useEffect(() => {
    const state = (location.state ?? {}) as EditorState
    const nextKind: 'image' | 'video' = state.kind ?? (state.filePath ? 'video' : state.dataUrl ? 'image' : kind)
    setHistoryId(state.historyId)
    setInitialAnnotations(state.annotations)
    if (nextKind === 'video') {
      setKind('video')
      setVideoFilePath(state.filePath ?? '')
      setVideoName(state.name ?? '')
      setImageDataUrl('')
      canvasRef.current?.clear()
    } else if (state.dataUrl) {
      setKind('image')
      setVideoFilePath('')
      setVideoName('')
      resetForNewImage(state.dataUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  useEffect(() => {
    window.electronAPI?.onCaptureReady(({ dataUrl }) => {
      // capture:ready is screenshot-only — switch back to image mode if the
      // user happened to be viewing a video when the next capture landed.
      setKind('image')
      setVideoFilePath('')
      setVideoName('')
      // Fresh capture has no existing history entry yet, so wipe any lingering
      // annotation context from a previously-opened history item.
      setHistoryId(undefined)
      setInitialAnnotations(undefined)
      resetForNewImage(dataUrl)
    })
    Promise.all([
      window.electronAPI?.getTemplates(),
      window.electronAPI?.getSettings(),
    ]).then(([t, s]) => {
      if (t) setTemplates(t)
      if (s?.activeWorkflowId) setActiveWorkflowId(s.activeWorkflowId)
      setGdriveConnected(!!s?.googleDriveRefreshToken)
      setImgurConfigured(!!s?.imgurClientId)
      setCustomConfigured(!!s?.customUploadUrl)
    })
    return () => { window.electronAPI?.removeAllListeners('capture:ready') }
  }, [])

  useEffect(() => {
    window.electronAPI?.getHistory().then((items: HistoryItem[]) => {
      setClipboardHistory(
        items
          .filter((i) => i.type === 'screenshot' && !i.fileMissing && (i.thumbnailUrl || i.dataUrl))
          .slice(0, 20)
          .map((i) => ({
            id: i.id,
            thumbnailUrl: (i.thumbnailUrl ?? i.dataUrl)!,
            filePath: i.filePath,
            legacyDataUrl: i.filePath ? undefined : i.dataUrl,
            name: i.name,
            timestamp: i.timestamp,
          })),
      )
    })
  }, [])

  const loadClipboardItem = useCallback(async (entry: { id: string; filePath?: string; legacyDataUrl?: string }) => {
    if (entry.filePath) {
      try {
        const dataUrl = await window.electronAPI?.readHistoryFile(entry.filePath)
        if (dataUrl) return dataUrl
        // null → file disappeared between getHistory and click. Drop the
        // entry from the panel so the next click doesn't repeat the miss.
        setClipboardHistory(prev => prev.filter(c => c.id !== entry.id))
        return undefined
      } catch { /* fall through to legacy */ }
    }
    return entry.legacyDataUrl
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); canvasRef.current?.zoomIn(); return }
        if (e.key === '-')                  { e.preventDefault(); canvasRef.current?.zoomOut(); return }
        if (e.key === '0')                  { e.preventDefault(); canvasRef.current?.zoomReset(); return }
      }
      const match = matchToolShortcut(e.key)
      if (match) setTool(match)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const showToast = useCallback((message: string, icon: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, icon, type })
    setTimeout(() => setToast(null), 2500)
  }, [])

  // ── Video action handlers ─────────────────────────────────────────────────
  // Video in this editor is view-only — Save / Copy / Upload act on the source
  // recording file directly. (Annotating video / freeze-frame export were
  // removed to keep the flow simple; bring them back in a dedicated video
  // editing module when needed.)
  // Unified action dispatcher — both modes share the same button list (from
  // deriveActions) so order and styling stay consistent. Video routes clicks
  // to file-level IPCs since there's no composite frame pipeline.
  const runVideoAction = useCallback(async (btn: ActionBtn) => {
    if (!videoFilePath) return
    setActionBusy(btn.key)
    try {
      if (btn.actionType === 'clipboard') {
        const res = await window.electronAPI?.videoCopyFile?.(videoFilePath)
        if (res?.fallback === 'text') showToast('Copied file path (clipboard file copy unsupported here)', 'content_copy')
        else                          showToast('Video copied', 'content_copy')
      } else if (btn.actionType === 'save') {
        const res = await window.electronAPI?.videoSaveAs?.(videoFilePath)
        if (res && !res.canceled && res.savedPath) showToast('Recording saved', 'check_circle')
      } else if (btn.destinationIndex !== undefined) {
        const dest = activeTemplate?.destinations[btn.destinationIndex]
        if (dest?.type === 'r2') {
          const res = await window.electronAPI?.videoUploadR2?.(videoFilePath)
          if (res?.success && res.url) showToast('Uploaded — link copied', 'check_circle')
          else                         showToast(res?.error ?? 'Upload failed', 'error', 'error')
        } else {
          showToast(`${dest?.type ?? 'Destination'} doesn't support video yet`, 'error', 'error')
        }
      }
    } catch (err: any) {
      showToast(err?.message ?? 'Action failed', 'error', 'error')
    } finally {
      setActionBusy(null)
    }
  }, [videoFilePath, activeTemplate, showToast])

  // Debounce timer for auto-saving annotation JSON as the user draws. Full
  // saves (with the flattened PNG sidecar + fresh thumbnail) happen on every
  // action trigger via handleExport — this debounce is purely so annotations
  // survive an Editor close that isn't accompanied by an action.
  //
  // `pendingSave` holds the payload the timer is scheduled to write. On
  // unmount (Back button, closing the editor, app quit) we flush it
  // synchronously so work in progress isn't dropped when the debounce
  // doesn't reach its 600ms window.
  const annotationSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingAnnotationSave = useRef<{ historyId: string; objects: AnnotationObject[] } | null>(null)
  useEffect(() => () => {
    if (annotationSaveTimer.current) {
      clearTimeout(annotationSaveTimer.current)
      annotationSaveTimer.current = null
    }
    const pending = pendingAnnotationSave.current
    pendingAnnotationSave.current = null
    if (pending) {
      window.electronAPI?.saveHistoryAnnotations(pending.historyId, pending.objects).catch(() => {})
    }
  }, [])

  const handleExport = useCallback((dataUrl: string) => {
    setExportedDataUrl(dataUrl)
    setExportTrigger(0)

    const pendingRaw = pendingAction.current
    pendingAction.current = null
    const pending = pendingRaw ? JSON.parse(pendingRaw) as {
      key: string; templateId: string; destinationIndex?: number; actionType?: 'clipboard' | 'save'
    } : null

    // Save is pure file I/O to a user-chosen path — never mutate history. For
    // every other action (Copy, Share, workflow destinations) commit the
    // current annotations + flattened sidecar so the next Editor session
    // rehydrates the shapes and Dashboard surfaces see annotated pixels.
    if (historyId && !isVideo && canvasRef.current && pending?.actionType !== 'save') {
      if (annotationSaveTimer.current) { clearTimeout(annotationSaveTimer.current); annotationSaveTimer.current = null }
      pendingAnnotationSave.current = null  // action save supersedes any pending debounced save
      const objects = canvasRef.current.getObjects() as AnnotationObject[]
      window.electronAPI?.saveHistoryAnnotations(historyId, objects, dataUrl).catch((err) => {
        console.error('[editor] failed to save annotations', err)
      })
    }

    if (!pending) return
    const { key, templateId, destinationIndex, actionType } = pending
    setActionBusy(key)
    if (actionType) {
      window.electronAPI?.runInlineAction(actionType, dataUrl)
        .then((res) => {
          if (res?.canceled) return // user dismissed the save dialog
          showToast(actionType === 'clipboard' ? 'Copied to clipboard' : 'Saved to file', 'check_circle')
        })
        .catch(() => showToast('Action failed', 'error', 'error'))
        .finally(() => setActionBusy(null))
      return
    }
    window.electronAPI?.runWorkflow(templateId, dataUrl, destinationIndex, historyId)
      .then((r) => {
        if (r?.uploads?.some(u => u.url))  showToast('Uploaded — link copied', 'check_circle')
        else if (r?.copiedToClipboard)     showToast('Copied to clipboard', 'check_circle')
        else if (r?.savedPath)             showToast('Saved to file', 'check_circle')
        else                               showToast('Done', 'check_circle')
      })
      .catch(() => showToast('Action failed', 'error', 'error'))
      .finally(() => setActionBusy(null))
  }, [historyId, isVideo, showToast])

  const triggerAction = (key: string, templateId: string, destinationIndex?: number, actionType?: 'clipboard' | 'save') => {
    pendingAction.current = JSON.stringify({ key, templateId, destinationIndex, actionType })
    setExportTrigger((n) => n + 1)
  }

  const handleHistoryChange = useCallback((u: boolean, r: boolean) => {
    setCanUndo(u)
    setCanRedo(r)
    // Lightweight auto-save: just the annotation JSON, no flattened PNG. That
    // way closing the Editor without clicking an action doesn't lose work.
    // The flattened sidecar + thumbnail get refreshed on the next action via
    // handleExport, which is the right moment since that's when external
    // surfaces (Dashboard Share/Copy) need an up-to-date pixel version.
    //
    // Skip when the stack is at its blank root (no undo, no redo) — that's
    // either the Canvas's first render before replay fills it, or a cleared
    // state with no editing history. In both cases saving an empty array
    // would wipe the user's persisted annotations.
    if (!u && !r) return
    if (historyId && !isVideo && canvasRef.current) {
      const objects = canvasRef.current.getObjects() as AnnotationObject[]
      pendingAnnotationSave.current = { historyId, objects }
      if (annotationSaveTimer.current) clearTimeout(annotationSaveTimer.current)
      annotationSaveTimer.current = setTimeout(() => {
        const pending = pendingAnnotationSave.current
        pendingAnnotationSave.current = null
        annotationSaveTimer.current = null
        if (pending) {
          window.electronAPI?.saveHistoryAnnotations(pending.historyId, pending.objects).catch(() => {})
        }
      }, 600)
    }
  }, [historyId, isVideo])

  const handleAutoBlurScan = useCallback(async () => {
    if (!imageDataUrl || autoBlurScanning) return
    setAutoBlurScanning(true)
    setShowAutoBlur(true)
    try {
      const result = await window.electronAPI?.ocrScan(imageDataUrl)
      if (result) {
        setAutoBlurRegions(result.regions)
        setAutoBlurSelected(new Set(result.regions.map(r => r.id)))
        setAutoBlurOcrTime(result.ocrTimeMs)
        setAutoBlurDetectTime(result.detectTimeMs)
        if (result.regions.length === 0) showToast('No sensitive info detected', 'verified_user')
      }
    } catch {
      showToast('OCR scan failed', 'error', 'error')
    } finally {
      setAutoBlurScanning(false)
    }
  }, [imageDataUrl, autoBlurScanning, showToast])

  const handleApplyAutoBlur = useCallback(async () => {
    const selected = autoBlurRegions.filter(r => autoBlurSelected.has(r.id))
    if (selected.length === 0) return
    try {
      const blurred = await window.electronAPI?.ocrApplyBlur(imageDataUrl, selected, 10)
      if (blurred) {
        setAutoBlurHistory(prev => [...prev, imageDataUrl])
        setImageDataUrl(blurred)
        setAutoBlurRegions([])
        setAutoBlurSelected(new Set())
        showToast(`Blurred ${selected.length} region${selected.length > 1 ? 's' : ''}`, 'blur_on')
      }
    } catch {
      showToast('Failed to apply blur', 'error', 'error')
    }
  }, [autoBlurRegions, autoBlurSelected, imageDataUrl, showToast])

  const handleAutoBlurUndo = useCallback(() => {
    setAutoBlurHistory(prev => {
      if (prev.length === 0) return prev
      const next = [...prev]
      const restored = next.pop()!
      setImageDataUrl(restored)
      setAutoBlurRegions([])
      setAutoBlurSelected(new Set())
      showToast('Blur undone', 'undo')
      return next
    })
  }, [showToast])

  /* ── Empty state (no source at all — covers both image and video modes) ── */
  const hasSource = isVideo ? !!videoFilePath : !!imageDataUrl
  if (!hasSource) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-6">
        <div className="relative">
          <div className="absolute -inset-8 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative p-7 rounded-3xl bg-white/[0.03] border border-white/[0.06] shadow-2xl">
            <span className="material-symbols-outlined text-5xl text-slate-500" style={{ fontVariationSettings: "'FILL' 0, 'wght' 300" }}>
              {isVideo ? 'videocam' : 'photo_camera'}
            </span>
          </div>
        </div>
        <div className="text-center space-y-2">
          <p className="text-lg font-bold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>Ready to annotate</p>
          <p className="text-sm text-slate-500 max-w-[260px]">
            {isVideo
              ? 'Open a recording from the History page to start editing'
              : 'Capture your screen or pick a recent screenshot to start editing'}
          </p>
        </div>
        <div className="flex gap-3 mt-1">
          <button
            onClick={() => navigate('/dashboard')}
            className="px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            Dashboard
          </button>
          <button
            onClick={triggerNewCapture}
            className="primary-gradient text-slate-900 font-bold px-5 py-2.5 rounded-xl text-sm hover:scale-[1.02] active:scale-95 transition-transform flex items-center gap-2"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            <span className="material-symbols-outlined text-base">screenshot_region</span>
            New Capture
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed top-12 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-2 px-4 py-2 backdrop-blur-xl border rounded-xl shadow-lg animate-slide-up ${
          toast.type === 'error' ? 'bg-red-500/20 border-red-500/30' : 'bg-emerald-500/20 border-emerald-500/30'
        }`}>
          <span className={`material-symbols-outlined text-sm ${toast.type === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>{toast.icon}</span>
          <span className="text-xs font-semibold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>{toast.message}</span>
        </div>
      )}

      {/* ── Top bar: title + actions ── */}
      <header className="h-10 liquid-glass flex items-center px-3 border-b border-white/5 flex-shrink-0 gap-2">
        {/* Back */}
        <button
          onClick={() => navigate('/dashboard')}
          className="h-7 w-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all flex-shrink-0"
          title="Back"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        </button>

        {/* Zoom — image only (Konva-managed; video player has its own scaling). */}
        {!isVideo && (
          <>
            <div className="w-px h-5 bg-white/10" />
            <div className="flex items-center gap-0.5">
              <TinyBtn icon="remove" title="Zoom out (Ctrl+-)" onClick={() => canvasRef.current?.zoomOut()} />
              <button
                onClick={() => canvasRef.current?.zoomReset()}
                className="h-7 px-2 rounded-lg text-[11px] font-bold text-slate-400 hover:text-white hover:bg-white/10 transition-all tabular-nums min-w-[44px] text-center"
                title="Reset zoom (Ctrl+0 / Double click)"
                style={{ fontFamily: 'Manrope, sans-serif' }}
              >
                {Math.round(zoomLevel * 100)}%
              </button>
              <TinyBtn icon="add" title="Zoom in (Ctrl+=)" onClick={() => canvasRef.current?.zoomIn()} />
            </div>
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* New capture */}
        <button
          onClick={triggerNewCapture}
          className="h-7 px-2.5 rounded-lg bg-white/5 hover:bg-white/10 flex items-center gap-1.5 text-slate-400 hover:text-white transition-all flex-shrink-0"
          title="New capture"
        >
          <span className="material-symbols-outlined text-[15px]">add_a_photo</span>
          <span className="text-[11px] font-semibold" style={{ fontFamily: 'Manrope, sans-serif' }}>New</span>
        </button>

        {/* Recent captures */}
        <button
          onClick={() => setShowClipPanel(p => !p)}
          className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 transition-all flex-shrink-0 ${
            showClipPanel ? 'bg-primary/20 text-primary' : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
          }`}
          title="Recent captures"
        >
          <span className="material-symbols-outlined text-[15px]">history</span>
          <span className="text-[11px] font-semibold" style={{ fontFamily: 'Manrope, sans-serif' }}>History</span>
        </button>

        {actionBtns.length > 0 && <div className="w-px h-5 bg-white/10" />}

        {/* Shared action buttons — same list, order, and styling for image and
             video. Click dispatches via kind: image → workflow/inline-action,
             video → file-level IPCs (save-as copy, clipboard file, R2 upload). */}
        {actionBtns.map((btn) => (
          <button
            key={btn.key}
            onClick={() => isVideo
              ? runVideoAction(btn)
              : triggerAction(btn.key, btn.templateId, btn.destinationIndex, btn.actionType)}
            disabled={!!actionBusy || (isVideo && !videoFilePath)}
            title={btn.label}
            className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 transition-all flex-shrink-0 disabled:opacity-40 text-[11px] font-semibold ${
              actionBusy === btn.key
                ? 'bg-primary/20 text-primary'
                : btn.primary
                  ? 'primary-gradient text-slate-900 hover:brightness-110'
                  : 'bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white'
            }`}
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            {actionBusy === btn.key
              ? <div className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
              : <span className="material-symbols-outlined text-[14px]">{btn.icon}</span>
            }
            {btn.label}
          </button>
        ))}
      </header>

      {/* ── Main area ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Canvas container ── */}
        <div
          className="flex-1 relative overflow-hidden"
          style={{ background: 'radial-gradient(circle at 30% 40%, rgba(15,23,42,0.9) 0%, #020617 100%)' }}
        >
          <div
            className="absolute inset-0 opacity-[0.025] pointer-events-none"
            style={{
              backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)`,
              backgroundSize: '24px 24px',
            }}
          />
          {isVideo ? (
            /* Plain HTML5 video player — annotation isn't supported on video in
             *  this build; showing a live video through Konva is overkill when
             *  we're not drawing on it. Native controls give smooth playback. */
            videoSrc ? (
              <video
                ref={el => { videoRef.current = el }}
                src={videoSrc}
                controls
                playsInline
                preload="auto"
                onLoadedMetadata={fixWebmDuration}
                className="w-full h-full object-contain"
                style={{ maxHeight: '100%' }}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-500">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm" style={{ fontFamily: 'Manrope, sans-serif' }}>Loading video…</span>
              </div>
            )
          ) : (
            <AnnotationCanvas
              ref={canvasRef}
              key={imageDataUrl}
              background={{ kind: 'image', dataUrl: imageDataUrl }}
              tool={tool}
              color={color}
              strokeWidth={strokeWidth}
              onExport={handleExport}
              exportTrigger={exportTrigger}
              onHistoryChange={handleHistoryChange}
              onZoomChange={setZoomLevel}
              initialObjects={initialAnnotations as DrawObject[] | undefined}
            />
          )}
        </div>

        {/* ── Auto-blur panel ── */}
        {showAutoBlur && (
          <aside className="w-60 flex-shrink-0 glass-refractive border-l border-white/5 flex flex-col overflow-hidden">
            <AutoBlurPanel
              regions={autoBlurRegions}
              selectedIds={autoBlurSelected}
              scanning={autoBlurScanning}
              canUndo={autoBlurHistory.length > 0}
              ocrTimeMs={autoBlurOcrTime}
              onToggleRegion={(id) => setAutoBlurSelected(prev => {
                const next = new Set(prev)
                next.has(id) ? next.delete(id) : next.add(id)
                return next
              })}
              onSelectAll={() => setAutoBlurSelected(new Set(autoBlurRegions.map(r => r.id)))}
              onDeselectAll={() => setAutoBlurSelected(new Set())}
              onApplyBlur={handleApplyAutoBlur}
              onScan={handleAutoBlurScan}
              onUndo={handleAutoBlurUndo}
              onClose={() => setShowAutoBlur(false)}
            />
          </aside>
        )}

        {/* ── Clipboard history panel ── */}
        {showClipPanel && (
          <aside className="w-60 flex-shrink-0 glass-refractive border-l border-white/5 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-shrink-0">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Recent Captures
              </span>
              <button onClick={() => setShowClipPanel(false)} className="text-slate-500 hover:text-white transition-colors">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {clipboardHistory.length === 0 ? (
                <div className="flex flex-col items-center py-10 gap-3">
                  <span className="material-symbols-outlined text-2xl text-slate-700">collections</span>
                  <p className="text-xs text-slate-600 text-center px-4">Your recent captures will appear here</p>
                </div>
              ) : (
                clipboardHistory.map((item) => (
                  <div
                    key={item.id}
                    className="group/clip flex items-center gap-2.5 p-2 rounded-xl cursor-pointer transition-all bg-white/[0.02] hover:bg-white/[0.06] border border-transparent"
                    onClick={async () => {
                      const dataUrl = await loadClipboardItem(item)
                      if (dataUrl) resetForNewImage(dataUrl)
                    }}
                  >
                    <img src={item.thumbnailUrl} className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-white/10" draggable={false} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-slate-300 truncate font-medium">{item.name}</p>
                      <p className="text-[9px] text-slate-600 mt-0.5">{relativeTime(item.timestamp)}</p>
                    </div>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        const dataUrl = await loadClipboardItem(item)
                        if (!dataUrl) return
                        window.electronAPI?.runWorkflow('builtin-clipboard', dataUrl)
                        showToast('Copied to clipboard', 'check_circle')
                      }}
                      className="opacity-0 group-hover/clip:opacity-100 p-1.5 rounded-lg bg-white/10 hover:bg-primary/20 text-slate-400 hover:text-primary transition-all flex-shrink-0"
                      title="Copy to clipboard"
                    >
                      <span className="material-symbols-outlined text-xs">content_copy</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Annotation toolbar — image mode only. Video is view-only in this
           build; to annotate, extract a frame via the History page or rebuild
           the dedicated video annotator. */}
      {!isVideo && (
        <AnnotationToolBar
          tool={tool} setTool={setTool}
          color={color} setColor={setColor}
          strokeWidth={strokeWidth} setStrokeWidth={setStrokeWidth}
          canUndo={canUndo} canRedo={canRedo}
          onUndo={() => canvasRef.current?.undo()}
          onRedo={() => canvasRef.current?.redo()}
          onClear={() => canvasRef.current?.clear()}
          extraLeft={
            <button
              title="AI blur sensitive info"
              onClick={() => { setShowAutoBlur(p => !p); if (!showAutoBlur && autoBlurRegions.length === 0) setShowAutoBlur(true) }}
              className={`flex flex-col items-center justify-center gap-0.5 w-12 h-9 rounded-lg transition-all ${
                showAutoBlur
                  ? 'bg-orange-500/20 text-orange-400 shadow-[0_0_12px_rgba(251,146,60,0.15)]'
                  : 'text-slate-400 hover:text-orange-400 hover:bg-orange-500/10'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">security</span>
              <span className="text-[9px] font-medium leading-none" style={{ fontFamily: 'Manrope, sans-serif' }}>AI Blur</span>
            </button>
          }
        />
      )}

      {/* No playback bar — the native HTML5 <video controls> provides
           play/pause/seek/volume without any custom UI. */}

    </div>
  )
}

/* ── Tiny icon button (top bar) ── */
function TinyBtn({ icon, title, onClick, disabled }: { icon: string; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all disabled:opacity-25 disabled:cursor-not-allowed"
    >
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
    </button>
  )
}

