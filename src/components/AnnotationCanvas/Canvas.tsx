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
}

let idCounter = 0
const uid = () => `obj-${++idCounter}-${Date.now()}`

const AnnotationCanvas = forwardRef<CanvasHandle, Props>(
  function AnnotationCanvas(
    { imageDataUrl, tool, color, strokeWidth, onExport, exportTrigger, onHistoryChange },
    ref,
  ) {
    const [bgImage] = useImage(imageDataUrl)
    const stageRef     = useRef<Konva.Stage>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isDrawing, setIsDrawing] = useState(false)
    const [currentObj, setCurrentObj] = useState<DrawObject | null>(null)
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [textInput, setTextInput] = useState<{
      x: number; y: number; screenX: number; screenY: number
    } | null>(null)
    const textInputRef = useRef<HTMLInputElement>(null)
    const [textValue, setTextValue] = useState('')
    const trRef = useRef<Konva.Transformer>(null)
    const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })

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
    useImperativeHandle(ref, () => ({ undo, redo, clear, canUndo, canRedo }), [
      undo, redo, clear, canUndo, canRedo,
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

    // Fit to container, never enlarge beyond natural size
    const scale = containerSize.w > 0 && containerSize.h > 0
      ? Math.min((containerSize.w - 32) / naturalW, (containerSize.h - 32) / naturalH, 1)
      : 1

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
        if (tool === 'select') {
          if (e.target === e.target.getStage()) setSelectedId(null)
          return
        }
        const raw = e.target.getStage()!.getPointerPosition()!
        const pos = { x: raw.x / scale, y: raw.y / scale }
        setIsDrawing(true)

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
          setCurrentObj(prev =>
            prev
              ? { ...prev, width: pos.x - (prev.x ?? 0), height: pos.y - (prev.y ?? 0) }
              : null,
          )
        } else if (currentObj.type === 'ellipse') {
          setCurrentObj(prev =>
            prev
              ? {
                  ...prev,
                  radiusX: Math.abs(pos.x - (prev.x ?? 0)) / 2,
                  radiusY: Math.abs(pos.y - (prev.y ?? 0)) / 2,
                  x: ((prev.x ?? 0) + pos.x) / 2,
                  y: ((prev.y ?? 0) + pos.y) / 2,
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

    const handleMouseUp = useCallback(() => {
      if (!isDrawing || !currentObj) return
      setIsDrawing(false)
      // Commit the completed object into history
      commitObjects(prev => [...prev, currentObj])
      setCurrentObj(null)
    }, [isDrawing, currentObj, commitObjects])

    // ── Rendering ─────────────────────────────────────────────────────────────
    const renderObj = (obj: DrawObject, isPreview = false) => {
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
      if (obj.type === 'rect' || obj.type === 'blur') {
        return (
          <Rect
            key={key}
            id={obj.id}
            x={obj.x}
            y={obj.y}
            width={obj.width}
            height={obj.height}
            fill={obj.type === 'blur' ? 'rgba(0,0,0,0.5)' : 'transparent'}
            stroke={obj.type === 'blur' ? undefined : obj.color}
            strokeWidth={obj.type === 'blur' ? 0 : obj.strokeWidth}
            draggable={tool === 'select'}
            onClick={() => !isPreview && setSelectedId(obj.id)}
            filters={obj.type === 'blur' ? [] : undefined}
          />
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
      <div ref={containerRef} className="w-full h-full flex items-center justify-center relative">
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
            cursor:
              tool === 'pen' ? 'crosshair' : tool === 'text' ? 'text' : 'default',
          }}
        >
          <Layer>
            {bgImage && <KonvaImage image={bgImage} width={naturalW} height={naturalH} />}
            {objects.map(obj => renderObj(obj))}
            {currentObj && renderObj(currentObj, true)}
            <Transformer ref={trRef} />
          </Layer>
        </Stage>

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
