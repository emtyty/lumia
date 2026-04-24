import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import {
  Arrow,
  Ellipse,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
  Transformer,
} from 'react-konva'
import useImage from 'use-image'
import type Konva from 'konva'
import { useHistory } from '../../hooks/useHistory'
import type { Tool } from './tools'

export type { Tool }

/** Pluggable background source for the annotation stage. */
export type CanvasBackground =
  | { kind: 'image'; dataUrl: string }
  | { kind: 'video'; element: HTMLVideoElement | null; naturalWidth: number; naturalHeight: number }

export interface DrawObject {
  id: string
  type: Tool
  points?: number[]
  x?: number; y?: number
  width?: number; height?: number
  radiusX?: number; radiusY?: number
  text?: string
  color: string
  strokeWidth: number
  fill?: string
  isBlur?: boolean
}

/** Imperative handle exposed to parent via ref. */
export interface CanvasHandle {
  undo: () => void
  redo: () => void
  clear: () => void
  canUndo: boolean
  canRedo: boolean
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  zoomLevel: number
  /** Snapshot the current composite (background + annotations) as a PNG data URL.
   *  Resolution follows the source's natural pixel dimensions. */
  toDataURL: () => string
  /** Same composite as a fresh canvas. Useful for feeding MediaRecorder during
   *  video export (canvas.captureStream). */
  toCanvas: () => HTMLCanvasElement | null
  /** Render ONLY the annotations (no background) to a fresh canvas at natural
   *  resolution. Lets callers composite annotations on top of arbitrary frames
   *  — used by the video exporter to paint annotations only during the freeze
   *  phase while letting raw video frames flow through otherwise. */
  toAnnotationsCanvas: () => HTMLCanvasElement | null
  /** Current list of annotation shapes — plain data, JSON-serializable. Used
   *  by history persistence so annotations survive across Editor sessions. */
  getObjects: () => DrawObject[]
}

interface Props {
  background: CanvasBackground
  tool: Tool
  color: string
  strokeWidth: number
  /** Optional: if provided, hitting Enter/clicking an action button writes the
   *  composite PNG here. Video callers should prefer the `toDataURL` ref method. */
  onExport?: (dataUrl: string) => void
  exportTrigger?: number
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void
  onZoomChange?: (zoom: number) => void
  /** Disable pointer-driven drawing (used by video mode while the video is
   *  actively playing — lets users watch without accidental strokes). */
  readOnly?: boolean
  /** Seed the annotation layer on mount with previously persisted shapes.
   *  Each shape is replayed as a separate commit, so native Undo walks back
   *  through them one at a time — same UX as if the user had just drawn
   *  them. Only read at mount; later changes are ignored so parent
   *  re-renders don't clobber in-progress edits. */
  initialObjects?: DrawObject[]
}

let idCounter = 0
const uid = () => `obj-${++idCounter}-${Date.now()}`

const AnnotationCanvas = forwardRef<CanvasHandle, Props>(
  function AnnotationCanvas(
    { background, tool, color, strokeWidth, onExport, exportTrigger = 0, onHistoryChange, onZoomChange, readOnly = false, initialObjects },
    ref,
  ) {
    // ── Background ────────────────────────────────────────────────────────────
    const imageDataUrl = background.kind === 'image' ? background.dataUrl : ''
    const [bgImage] = useImage(imageDataUrl)
    const [blurredBg, setBlurredBg] = useState<HTMLCanvasElement | null>(null)

    // Pre-compute a blurred version of the image once on load. Blur tool samples
    // from this canvas so mouse-drag doesn't trigger a new filter pass.
    useEffect(() => {
      if (background.kind !== 'image' || !bgImage) { setBlurredBg(null); return }
      const c = document.createElement('canvas')
      c.width  = bgImage.width
      c.height = bgImage.height
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.filter = 'blur(12px)'
      ctx.drawImage(bgImage, 0, 0)
      setBlurredBg(c)
    }, [bgImage, background.kind])

    // For video: repaint the Konva layer on every new frame. The KonvaImage's
    // `image` prop keeps the same HTMLVideoElement reference, so React/Konva
    // won't redraw on their own — we have to call batchDraw() imperatively.
    useEffect(() => {
      if (background.kind !== 'video' || !background.element) return
      const video = background.element
      const anyVideo = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number
        cancelVideoFrameCallback?: (id: number) => void
      }
      if (typeof anyVideo.requestVideoFrameCallback === 'function') {
        let id = 0
        const onFrame = () => {
          layerRef.current?.batchDraw()
          id = anyVideo.requestVideoFrameCallback!(onFrame)
        }
        id = anyVideo.requestVideoFrameCallback!(onFrame)
        return () => anyVideo.cancelVideoFrameCallback?.(id)
      }
      // Fallback: RAF loop while the video is actually playing.
      let raf = 0
      const tick = () => {
        if (!video.paused && !video.ended) layerRef.current?.batchDraw()
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    }, [background])

    const stageRef     = useRef<Konva.Stage>(null)
    const layerRef     = useRef<Konva.Layer>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isDrawing, setIsDrawing] = useState(false)
    const [currentObj, setCurrentObj] = useState<DrawObject | null>(null)
    const drawStart = useRef({ x: 0, y: 0 })
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [textInput, setTextInput] = useState<{
      x: number; y: number; screenX: number; screenY: number
    } | null>(null)
    const textInputRef = useRef<HTMLInputElement>(null)
    const [textValue, setTextValue] = useState('')
    const trRef = useRef<Konva.Transformer>(null)
    const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })

    // ── Zoom ──────────────────────────────────────────────────────────────────
    const [userZoom, setUserZoom] = useState(1)
    const clampZoom = (z: number) => Math.max(0.1, Math.min(z, 5))
    const zoomIn  = useCallback(() => setUserZoom(z => clampZoom(z + 0.1)), [])
    const zoomOut = useCallback(() => setUserZoom(z => clampZoom(z - 0.1)), [])
    const zoomReset = useCallback(() => { setUserZoom(1); setPanOffset({ x: 0, y: 0 }) }, [])

    // ── Pan (right-click drag) ────────────────────────────────────────────────
    const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
    const panOffsetRef = useRef(panOffset)
    useEffect(() => { panOffsetRef.current = panOffset }, [panOffset])
    const [isPanningState, setIsPanningState] = useState(false)
    const isPanning = useRef(false)
    const panStart  = useRef({ x: 0, y: 0 })

    // ── History ───────────────────────────────────────────────────────────────
    const {
      state: objects,
      set: commitObjects,
      undo,
      redo,
      canUndo,
      canRedo,
    } = useHistory<DrawObject[]>([])

    // Rehydrate persisted annotations by replaying each shape as its own
    // commit — Undo then walks back through them one-at-a-time, identical to
    // the session that created them. Guarded by a ref so StrictMode's double
    // effect invocation doesn't double-push the stack.
    const replayedRef = useRef(false)
    useEffect(() => {
      if (replayedRef.current) return
      replayedRef.current = true
      if (!initialObjects || initialObjects.length === 0) return
      for (let i = 0; i < initialObjects.length; i++) {
        commitObjects(initialObjects.slice(0, i + 1))
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const objectsRef = useRef(objects)
    useEffect(() => { objectsRef.current = objects }, [objects])

    // Notify parent on every commit. Depending on `canUndo`/`canRedo` alone
    // would miss changes where those booleans don't toggle — e.g. after the
    // first shape lands `canUndo` stays `true`, so every subsequent shape
    // would be invisible to the parent and the Editor's debounced save would
    // never be scheduled.
    useEffect(() => {
      onHistoryChange?.(canUndo, canRedo)
    }, [objects, canUndo, canRedo, onHistoryChange])

    // ── Container sizing ──────────────────────────────────────────────────────
    useEffect(() => {
      const el = containerRef.current
      if (!el) return
      const ro = new ResizeObserver(entries => {
        const { width, height } = entries[0].contentRect
        setContainerSize({ w: width, h: height })
      })
      ro.observe(el)
      return () => ro.disconnect()
    }, [])

    // Focus text input — delayed to prevent Konva mouseUp stealing focus
    useEffect(() => {
      if (textInput && textInputRef.current) {
        const t = setTimeout(() => textInputRef.current?.focus(), 50)
        return () => clearTimeout(t)
      }
    }, [textInput])

    // ── Natural dimensions ────────────────────────────────────────────────────
    const naturalW = background.kind === 'image'
      ? (bgImage?.width  ?? 800)
      : (background.naturalWidth  || 800)
    const naturalH = background.kind === 'image'
      ? (bgImage?.height ?? 600)
      : (background.naturalHeight || 600)

    // Base scale: fit content into container.
    const isTallImage = naturalH / naturalW > 2
    const baseScale = containerSize.w > 0 && containerSize.h > 0
      ? isTallImage
        ? Math.min((containerSize.w - 32) / naturalW, 1)
        : Math.min((containerSize.w - 32) / naturalW, (containerSize.h - 32) / naturalH, 1)
      : 1

    const scale = baseScale * userZoom

    useEffect(() => { onZoomChange?.(userZoom) }, [userZoom, onZoomChange])

    // Scroll-to-zoom, anchored at cursor
    useEffect(() => {
      const el = containerRef.current
      if (!el) return
      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const pan = panOffsetRef.current

        setUserZoom(prevZoom => {
          const factor = Math.exp(-e.deltaY * 0.0015)
          const nextZoom = clampZoom(prevZoom * factor)
          if (nextZoom === prevZoom) return prevZoom

          const prevScale = baseScale * prevZoom
          const nextScale = baseScale * nextZoom
          const prevStageW = naturalW * prevScale
          const prevStageH = naturalH * prevScale
          const nextStageW = naturalW * nextScale
          const nextStageH = naturalH * nextScale
          const prevLeft = (rect.width  - prevStageW) / 2 + pan.x
          const prevTop  = (rect.height - prevStageH) / 2 + pan.y

          const imgX = (mx - prevLeft) / prevScale
          const imgY = (my - prevTop)  / prevScale

          const newPanX = mx - (rect.width  - nextStageW) / 2 - imgX * nextScale
          const newPanY = my - (rect.height - nextStageH) / 2 - imgY * nextScale
          setPanOffset({ x: newPanX, y: newPanY })
          panOffsetRef.current = { x: newPanX, y: newPanY }

          return nextZoom
        })
      }
      el.addEventListener('wheel', onWheel, { passive: false })
      return () => el.removeEventListener('wheel', onWheel)
    }, [baseScale, naturalW, naturalH])

    // Double-click to reset zoom + pan
    useEffect(() => {
      const el = containerRef.current
      if (!el) return
      const onDblClick = () => {
        setUserZoom(1)
        setPanOffset({ x: 0, y: 0 })
      }
      el.addEventListener('dblclick', onDblClick)
      return () => el.removeEventListener('dblclick', onDblClick)
    }, [])

    // Right-click drag to pan
    useEffect(() => {
      const el = containerRef.current
      if (!el) return
      const onMouseDown = (e: MouseEvent) => {
        if (e.button !== 2) return
        e.preventDefault()
        isPanning.current = true
        setIsPanningState(true)
        panStart.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y }
      }
      const onMouseMove = (e: MouseEvent) => {
        if (!isPanning.current) return
        setPanOffset({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y })
      }
      const onMouseUp = (e: MouseEvent) => {
        if (e.button !== 2) return
        isPanning.current = false
        setIsPanningState(false)
      }
      const onContextMenu = (e: MouseEvent) => e.preventDefault()

      el.addEventListener('mousedown', onMouseDown)
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
      el.addEventListener('contextmenu', onContextMenu)
      return () => {
        el.removeEventListener('mousedown', onMouseDown)
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
        el.removeEventListener('contextmenu', onContextMenu)
      }
    }, [panOffset])

    const stageWidth  = Math.round(naturalW * scale)
    const stageHeight = Math.round(naturalH * scale)

    // ── Composite snapshot (current background + annotations at natural res) ──
    const toDataURL = useCallback((): string => {
      const stage = stageRef.current
      if (!stage) return ''
      return stage.toDataURL({ mimeType: 'image/png', pixelRatio: 1 / scale })
    }, [scale])

    const toCanvas = useCallback((): HTMLCanvasElement | null => {
      const stage = stageRef.current
      if (!stage) return null
      return stage.toCanvas({ pixelRatio: 1 / scale })
    }, [scale])

    const toAnnotationsCanvas = useCallback((): HTMLCanvasElement | null => {
      const stage = stageRef.current
      if (!stage) return null
      // Temporarily hide the background node so the export contains only the
      // annotation shapes. Transformer stays hidden via `nodes([])` when idle,
      // so it rarely shows up in snapshots — but hide it too to be safe.
      const bg = stage.findOne('#__bg__')
      const tr = trRef.current
      const prevBg = bg?.visible() ?? true
      const prevTrNodes = tr?.nodes() ?? []
      bg?.visible(false)
      tr?.nodes([])
      stage.batchDraw()
      const out = stage.toCanvas({ pixelRatio: 1 / scale })
      bg?.visible(prevBg)
      if (tr && prevTrNodes.length > 0) tr.nodes(prevTrNodes)
      stage.batchDraw()
      return out
    }, [scale])

    const getObjects = useCallback((): DrawObject[] => objectsRef.current, [])

    // User-initiated Clear: commit an empty state instead of resetting the
    // history stack. That way the parent's `onHistoryChange` sees `canUndo`
    // flip to `true` (so the Editor's debounced save fires and the sidecar
    // PNG + thumbnail get regenerated from the original image), and the user
    // can undo the clear to recover the shapes if it was accidental.
    const clearViaCommit = useCallback(() => {
      commitObjects([])
    }, [commitObjects])

    // Expose imperative handle to parent
    useImperativeHandle(ref, () => ({
      undo, redo, clear: clearViaCommit, canUndo, canRedo,
      zoomIn, zoomOut, zoomReset, zoomLevel: userZoom,
      toDataURL, toCanvas, toAnnotationsCanvas, getObjects,
    }), [undo, redo, clearViaCommit, canUndo, canRedo, zoomIn, zoomOut, zoomReset, userZoom, toDataURL, toCanvas, toAnnotationsCanvas, getObjects])

    // ── Export trigger (legacy path — kept for Editor's workflow buttons) ────
    useEffect(() => {
      if (exportTrigger > 0 && stageRef.current && onExport) {
        onExport(toDataURL())
      }
    }, [exportTrigger, onExport, toDataURL])

    // ── Transformer attachment ────────────────────────────────────────────────
    useEffect(() => {
      const tr = trRef.current
      if (!tr) return
      if (!selectedId) { tr.nodes([]); tr.getLayer()?.batchDraw(); return }
      const stage = stageRef.current
      if (!stage) return
      const node = stage.findOne('#' + selectedId)
      if (node) { tr.nodes([node]); tr.getLayer()?.batchDraw() }
      else tr.nodes([])
    }, [selectedId, objects])

    // Deselect when switching away from the Select tool.
    useEffect(() => { if (tool !== 'select') setSelectedId(null) }, [tool])

    // ── Keyboard: Delete / Backspace removes the selected shape ──────────────
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
          e.preventDefault()
          commitObjects(prev => prev.filter(o => o.id !== selectedId))
          setSelectedId(null)
        }
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }, [selectedId, commitObjects])

    // ── Drawing handlers ──────────────────────────────────────────────────────
    const handleMouseDown = useCallback(
      (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (readOnly || e.evt.button === 2) return
        if (tool === 'select') {
          if (e.target === e.target.getStage()) setSelectedId(null)
          return
        }
        const raw = e.target.getStage()!.getPointerPosition()!
        const pos = { x: raw.x / scale, y: raw.y / scale }
        setIsDrawing(true)
        drawStart.current = pos

        const base: DrawObject = { id: uid(), type: tool, color, strokeWidth }

        if (tool === 'pen') {
          setCurrentObj({ ...base, points: [pos.x, pos.y] })
        } else if (tool === 'rect' || tool === 'blur') {
          setCurrentObj({ ...base, x: pos.x, y: pos.y, width: 0, height: 0 })
        } else if (tool === 'ellipse') {
          setCurrentObj({ ...base, x: pos.x, y: pos.y, radiusX: 0, radiusY: 0 })
        } else if (tool === 'arrow') {
          setCurrentObj({ ...base, points: [pos.x, pos.y, pos.x, pos.y] })
        } else if (tool === 'text') {
          setTextInput({ x: pos.x, y: pos.y, screenX: raw.x, screenY: raw.y })
          setTextValue('')
          setIsDrawing(false)
          return
        }
      },
      [tool, color, strokeWidth, scale, readOnly],
    )

    const handleMouseMove = useCallback(
      (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (!isDrawing || !currentObj) return
        const raw = e.target.getStage()!.getPointerPosition()!
        const pos = { x: raw.x / scale, y: raw.y / scale }

        if (currentObj.type === 'pen') {
          setCurrentObj(prev =>
            prev ? { ...prev, points: [...(prev.points ?? []), pos.x, pos.y] } : null,
          )
        } else if (currentObj.type === 'rect' || currentObj.type === 'blur') {
          const s = drawStart.current
          const nx = Math.min(s.x, pos.x)
          const ny = Math.min(s.y, pos.y)
          const nw = Math.abs(pos.x - s.x)
          const nh = Math.abs(pos.y - s.y)
          setCurrentObj(prev =>
            prev ? { ...prev, x: nx, y: ny, width: nw, height: nh } : null,
          )
        } else if (currentObj.type === 'ellipse') {
          const s = drawStart.current
          setCurrentObj(prev =>
            prev
              ? {
                  ...prev,
                  radiusX: Math.abs(pos.x - s.x) / 2,
                  radiusY: Math.abs(pos.y - s.y) / 2,
                  x: (s.x + pos.x) / 2,
                  y: (s.y + pos.y) / 2,
                }
              : null,
          )
        } else if (currentObj.type === 'arrow') {
          const pts = currentObj.points ?? []
          setCurrentObj(prev =>
            prev ? { ...prev, points: [pts[0], pts[1], pos.x, pos.y] } : null,
          )
        }
      },
      [isDrawing, currentObj, scale],
    )

    const MIN_SHAPE_SIZE = 4
    const isTrivialShape = (obj: DrawObject) => {
      if (obj.type === 'pen') return (obj.points?.length ?? 0) < 4
      if (obj.type === 'arrow') {
        const p = obj.points ?? []
        return p.length < 4 || (Math.abs(p[2] - p[0]) < MIN_SHAPE_SIZE && Math.abs(p[3] - p[1]) < MIN_SHAPE_SIZE)
      }
      if (obj.type === 'rect' || obj.type === 'blur') {
        return Math.abs(obj.width ?? 0) < MIN_SHAPE_SIZE || Math.abs(obj.height ?? 0) < MIN_SHAPE_SIZE
      }
      if (obj.type === 'ellipse') {
        return (obj.radiusX ?? 0) < MIN_SHAPE_SIZE / 2 || (obj.radiusY ?? 0) < MIN_SHAPE_SIZE / 2
      }
      return false
    }

    const handleMouseUp = useCallback(() => {
      if (!isDrawing || !currentObj) return
      setIsDrawing(false)
      if (isTrivialShape(currentObj)) { setCurrentObj(null); return }
      commitObjects(prev => [...prev, currentObj])
      setCurrentObj(null)
    }, [isDrawing, currentObj, commitObjects])

    // Global mouseup so a shape still commits if the pointer exits the stage
    useEffect(() => {
      if (!isDrawing) return
      const onUp = (e: MouseEvent) => {
        if (e.button !== 0) return
        handleMouseUp()
      }
      window.addEventListener('mouseup', onUp)
      return () => window.removeEventListener('mouseup', onUp)
    }, [isDrawing, handleMouseUp])

    // ── Per-object shape renderer ─────────────────────────────────────────────
    const selectable = tool === 'select'
    const renderObj = (obj: DrawObject, isPreview = false) => {
      if (isPreview && isTrivialShape(obj)) return null
      const key = isPreview ? 'preview' : obj.id

      const commonInteractive = !isPreview && {
        onClick: () => { if (selectable) setSelectedId(obj.id) },
        onTap:   () => { if (selectable) setSelectedId(obj.id) },
      }

      if (obj.type === 'pen') {
        return (
          <Line
            key={key}
            id={obj.id}
            points={obj.points ?? []}
            stroke={obj.color}
            strokeWidth={obj.strokeWidth}
            tension={0.5}
            lineCap="round"
            lineJoin="round"
            globalCompositeOperation="source-over"
            draggable={selectable}
            {...commonInteractive}
          />
        )
      }
      if (obj.type === 'rect') {
        return (
          <Rect
            key={key}
            id={obj.id}
            x={obj.x}
            y={obj.y}
            width={obj.width}
            height={obj.height}
            fill="transparent"
            stroke={obj.color}
            strokeWidth={obj.strokeWidth}
            draggable={selectable}
            {...commonInteractive}
          />
        )
      }
      if (obj.type === 'blur') {
        const bx = obj.x ?? 0, by = obj.y ?? 0
        const bw = obj.width ?? 0, bh = obj.height ?? 0
        // Video background has no pre-blurred sample — fall through to the
        // placeholder frosted rect. (Video blur is a v1.5 feature.)
        if (!blurredBg || bw <= 0 || bh <= 0) {
          return (
            <Rect
              key={key}
              id={obj.id}
              x={bx} y={by} width={bw} height={bh}
              fill="rgba(128,128,128,0.35)"
              stroke="rgba(255,255,255,0.4)"
              dash={[4, 4]}
              draggable={selectable}
              {...commonInteractive}
            />
          )
        }
        return (
          <Group
            key={key}
            id={obj.id}
            clipX={bx} clipY={by} clipWidth={bw} clipHeight={bh}
            draggable={selectable}
            {...commonInteractive}
          >
            <KonvaImage
              image={blurredBg}
              width={naturalW}
              height={naturalH}
              listening={false}
            />
          </Group>
        )
      }
      if (obj.type === 'ellipse') {
        return (
          <Ellipse
            key={key}
            id={obj.id}
            x={obj.x}
            y={obj.y}
            radiusX={obj.radiusX ?? 0}
            radiusY={obj.radiusY ?? 0}
            stroke={obj.color}
            strokeWidth={obj.strokeWidth}
            fill="transparent"
            draggable={selectable}
            {...commonInteractive}
          />
        )
      }
      if (obj.type === 'arrow') {
        return (
          <Arrow
            key={key}
            id={obj.id}
            points={obj.points ?? []}
            stroke={obj.color}
            strokeWidth={obj.strokeWidth}
            fill={obj.color}
            draggable={selectable}
            {...commonInteractive}
          />
        )
      }
      if (obj.type === 'text') {
        return (
          <Text
            key={key}
            id={obj.id}
            x={obj.x}
            y={obj.y}
            text={obj.text ?? ''}
            fontSize={obj.strokeWidth * 6 + 12}
            fontFamily="Manrope, sans-serif"
            fontStyle="bold"
            fill={obj.color}
            draggable={!isPreview}
            {...commonInteractive}
            onDragEnd={e => {
              if (!isPreview) {
                const node = e.target
                commitObjects(prev =>
                  prev.map(o =>
                    o.id === obj.id ? { ...o, x: node.x(), y: node.y() } : o,
                  ),
                )
              }
            }}
          />
        )
      }
      return null
    }

    const commitText = useCallback(
      (pos: { x: number; y: number }, value: string) => {
        if (!value.trim()) return
        commitObjects(prev => [
          ...prev,
          { id: uid(), type: 'text' as Tool, x: pos.x, y: pos.y, text: value, color, strokeWidth },
        ])
      },
      [commitObjects, color, strokeWidth],
    )

    // ── Cursor ────────────────────────────────────────────────────────────────
    const cursor = isPanningState ? 'grabbing'
      : readOnly ? 'default'
      : tool === 'pen' ? 'crosshair'
      : tool === 'text' ? 'text'
      : tool === 'select' ? 'default'
      : 'crosshair'

    // ── Background Konva node (image or video) ───────────────────────────────
    const bgElement = background.kind === 'image'
      ? bgImage
      : background.element

    return (
      <div
        ref={containerRef}
        className="w-full h-full relative overflow-hidden"
        style={{ cursor: isPanningState ? 'grabbing' : undefined }}
      >
        <div style={{
          position: 'absolute',
          left: (containerSize.w - stageWidth) / 2 + panOffset.x,
          top:  (containerSize.h - stageHeight) / 2 + panOffset.y,
          width: stageWidth,
          height: stageHeight,
        }}>
          <Stage
            ref={stageRef}
            width={stageWidth}
            height={stageHeight}
            scaleX={scale}
            scaleY={scale}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            style={{ cursor }}
          >
            <Layer ref={layerRef}>
              {bgElement && (
                <KonvaImage
                  id="__bg__"
                  image={bgElement as any}
                  width={naturalW}
                  height={naturalH}
                  listening={false}
                />
              )}
              {objects.map(obj => renderObj(obj))}
              {currentObj && renderObj(currentObj, true)}
              <Transformer
                ref={trRef}
                rotateEnabled={false}
                borderStroke="#a78bfa"
                anchorStroke="#a78bfa"
                anchorFill="#ffffff"
                anchorSize={8}
              />
            </Layer>
          </Stage>
        </div>

        {textInput && (
          <div
            className="absolute z-10"
            style={{ left: textInput.screenX, top: textInput.screenY }}
            onMouseDown={e => e.stopPropagation()}
          >
            <input
              ref={textInputRef}
              value={textValue}
              onChange={e => setTextValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  commitText(textInput, textValue)
                  setTextInput(null)
                  setTextValue('')
                } else if (e.key === 'Escape') {
                  setTextInput(null)
                  setTextValue('')
                }
              }}
              onBlur={() => {
                setTimeout(() => {
                  setTextInput(prev => {
                    if (!prev) return null
                    const val = textInputRef.current?.value ?? ''
                    commitText(prev, val)
                    return null
                  })
                  setTextValue('')
                }, 150)
              }}
              className="bg-slate-900/90 border border-primary/50 text-white text-sm px-3 py-2 rounded-xl outline-none min-w-[160px] backdrop-blur-sm shadow-lg"
              style={{ fontFamily: 'Manrope, sans-serif' }}
              placeholder="Type text, Enter to confirm..."
            />
          </div>
        )}
      </div>
    )
  },
)

export default AnnotationCanvas
