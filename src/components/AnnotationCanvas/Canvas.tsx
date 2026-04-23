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

export type Tool = 'select' | 'pen' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'blur'

interface DrawObject {
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
}

interface Props {
  imageDataUrl: string
  tool: Tool
  color: string
  strokeWidth: number
  onExport: (dataUrl: string) => void
  exportTrigger: number
  /** Called whenever the undo/redo availability changes so the parent can
   *  reflect the state in its own UI (e.g. toolbar buttons). */
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void
  onZoomChange?: (zoom: number) => void
}

let idCounter = 0
const uid = () => `obj-${++idCounter}-${Date.now()}`

const AnnotationCanvas = forwardRef<CanvasHandle, Props>(
  function AnnotationCanvas(
    { imageDataUrl, tool, color, strokeWidth, onExport, exportTrigger, onHistoryChange, onZoomChange },
    ref,
  ) {
    const [bgImage] = useImage(imageDataUrl)
    const [blurredBg, setBlurredBg] = useState<HTMLCanvasElement | null>(null)
    const stageRef     = useRef<Konva.Stage>(null)

    // Pre-compute a blurred version of the background once per image load.
    // Blur regions sample from this canvas, so mousemove while drawing doesn't
    // trigger a new filter pass.
    useEffect(() => {
      if (!bgImage) { setBlurredBg(null); return }
      const c = document.createElement('canvas')
      c.width  = bgImage.width
      c.height = bgImage.height
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.filter = 'blur(12px)'
      ctx.drawImage(bgImage, 0, 0)
      setBlurredBg(c)
    }, [bgImage])
    const containerRef = useRef<HTMLDivElement>(null)
    const [isDrawing, setIsDrawing] = useState(false)
    const [currentObj, setCurrentObj] = useState<DrawObject | null>(null)
    const drawStart = useRef({ x: 0, y: 0 })
    const [, setSelectedId] = useState<string | null>(null)
    const [textInput, setTextInput] = useState<{
      x: number; y: number; screenX: number; screenY: number
    } | null>(null)
    const textInputRef = useRef<HTMLInputElement>(null)
    const [textValue, setTextValue] = useState('')
    const trRef = useRef<Konva.Transformer>(null)
    const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })

    // ── Zoom ────────────────────────────────────────────────────────────────
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
      clear,
    } = useHistory<DrawObject[]>([])

    // Expose imperative handle to parent
    useImperativeHandle(ref, () => ({ undo, redo, clear, canUndo, canRedo, zoomIn, zoomOut, zoomReset, zoomLevel: userZoom }), [
      undo, redo, clear, canUndo, canRedo, zoomIn, zoomOut, zoomReset, userZoom,
    ])

    // Notify parent when undo/redo availability changes
    useEffect(() => {
      onHistoryChange?.(canUndo, canRedo)
    }, [canUndo, canRedo, onHistoryChange])

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

    const naturalW = bgImage?.width  ?? 800
    const naturalH = bgImage?.height ?? 600

    // Base scale: fit image into container.
    // For very tall images (scroll captures), fit to width only and allow vertical scrolling.
    const isTallImage = naturalH / naturalW > 2
    const baseScale = containerSize.w > 0 && containerSize.h > 0
      ? isTallImage
        ? Math.min((containerSize.w - 32) / naturalW, 1)
        : Math.min((containerSize.w - 32) / naturalW, (containerSize.h - 32) / naturalH, 1)
      : 1

    const scale = baseScale * userZoom

    useEffect(() => { onZoomChange?.(userZoom) }, [userZoom, onZoomChange])

    // Scroll to zoom, anchored at the cursor position
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
          // Exponential step: zoom feels linear in perceived size regardless of
          // current level, and scales smoothly with high-resolution wheel/trackpad.
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

    // Double-click to reset zoom + pan to center
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

    // ── Export ────────────────────────────────────────────────────────────────
    useEffect(() => {
      if (exportTrigger > 0 && stageRef.current) {
        const dataUrl = stageRef.current.toDataURL({
          mimeType: 'image/png',
          pixelRatio: 1 / scale,
        })
        onExport(dataUrl)
      }
    }, [exportTrigger, onExport, scale])

    // ── Drawing handlers ──────────────────────────────────────────────────────
    const handleMouseDown = useCallback(
      (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (e.evt.button === 2) return
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
      [tool, color, strokeWidth, scale],
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
      // Skip committing shapes that are too small — these come from accidental
      // clicks (e.g. double-click to reset zoom while in a shape tool).
      if (isTrivialShape(currentObj)) { setCurrentObj(null); return }
      commitObjects(prev => [...prev, currentObj])
      setCurrentObj(null)
    }, [isDrawing, currentObj, commitObjects])

    // Global mouseup — commits the in-progress shape even if the cursor left
    // the stage before the button was released.
    useEffect(() => {
      if (!isDrawing) return
      const onUp = (e: MouseEvent) => {
        if (e.button !== 0) return
        handleMouseUp()
      }
      window.addEventListener('mouseup', onUp)
      return () => window.removeEventListener('mouseup', onUp)
    }, [isDrawing, handleMouseUp])

    // ── Rendering ─────────────────────────────────────────────────────────────
    const renderObj = (obj: DrawObject, isPreview = false) => {
      // Hide preview for trivially-small shapes so accidental clicks (e.g. the
      // double-click-to-reset-zoom gesture) don't flash an arrowhead/rect on-screen.
      if (isPreview && isTrivialShape(obj)) return null
      const key = isPreview ? 'preview' : obj.id

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
            draggable={tool === 'select'}
            onClick={() => !isPreview && setSelectedId(obj.id)}
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
            draggable={tool === 'select'}
            onClick={() => !isPreview && setSelectedId(obj.id)}
          />
        )
      }
      if (obj.type === 'blur') {
        const bx = obj.x ?? 0, by = obj.y ?? 0
        const bw = obj.width ?? 0, bh = obj.height ?? 0
        if (!blurredBg || bw <= 0 || bh <= 0) {
          return (
            <Rect
              key={key}
              id={obj.id}
              x={bx} y={by} width={bw} height={bh}
              fill="rgba(128,128,128,0.35)"
              stroke="rgba(255,255,255,0.4)"
              dash={[4, 4]}
            />
          )
        }
        return (
          <Group
            key={key}
            id={obj.id}
            clipX={bx} clipY={by} clipWidth={bw} clipHeight={bh}
            draggable={tool === 'select'}
            onClick={() => !isPreview && setSelectedId(obj.id)}
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
            draggable={tool === 'select'}
            onClick={() => !isPreview && setSelectedId(obj.id)}
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
            draggable={tool === 'select'}
            onClick={() => !isPreview && setSelectedId(obj.id)}
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
            fill={obj.color}
            draggable={!isPreview}
            onClick={() => !isPreview && setSelectedId(obj.id)}
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

    // ── Text input commit helpers ──────────────────────────────────────────────
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
          style={{
            cursor: isPanningState ? 'grabbing'
              : tool === 'pen' ? 'crosshair'
              : tool === 'text' ? 'text'
              : 'default',
          }}
        >
          <Layer>
            {bgImage && <KonvaImage image={bgImage} width={naturalW} height={naturalH} />}
            {objects.map(obj => renderObj(obj))}
            {currentObj && renderObj(currentObj, true)}
            <Transformer ref={trRef} />
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
                // Delay to avoid Konva mouseUp immediately triggering blur
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
