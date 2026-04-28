import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Line, Arrow, Rect, Ellipse } from 'react-konva'
import type Konva from 'konva'

type Tool = 'none' | 'pen' | 'arrow' | 'rect' | 'ellipse' | 'highlighter'

interface DrawState {
  tool: Tool
  color: string
  strokeWidth: number
}

interface BaseShape {
  id: string
  tool: Tool
  color: string
  strokeWidth: number
  // Highlighter draws with reduced alpha + larger width — capture the
  // "intended" properties rather than baking the visual tweak into the
  // base width so undo/replay stays consistent.
  highlight?: boolean
}

interface FreeShape extends BaseShape { kind: 'free'; points: number[] }
interface RectShape extends BaseShape { kind: 'rect'; x: number; y: number; w: number; h: number }
interface EllipseShape extends BaseShape { kind: 'ellipse'; x: number; y: number; rx: number; ry: number }
interface ArrowShape extends BaseShape { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number }

type Shape = FreeShape | RectShape | EllipseShape | ArrowShape

let shapeIdCounter = 0
const nextId = () => `${Date.now()}-${++shapeIdCounter}`

export default function AnnotationOverlay() {
  const [draw, setDraw] = useState<DrawState>({ tool: 'none', color: '#f87171', strokeWidth: 4 })
  const [shapes, setShapes] = useState<Shape[]>([])
  const drawingRef = useRef<Shape | null>(null)
  const [drawingPreview, setDrawingPreview] = useState<Shape | null>(null)
  const [stageSize, setStageSize] = useState({ w: window.innerWidth, h: window.innerHeight })

  useEffect(() => {
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
  }, [])

  // Cursor reflects whether a drawing tool is active. With no tool selected
  // the cursor reverts to the default arrow so the user knows clicks won't
  // start a stroke yet.
  useEffect(() => {
    document.body.style.cursor = draw.tool === 'none' ? 'default' : 'crosshair'
  }, [draw.tool])

  useEffect(() => {
    const onResize = () => setStageSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Pull initial state from main, then listen for live updates.
  useEffect(() => {
    window.electronAPI?.annotationGetState?.().then((s) => {
      if (s) setDraw({ tool: s.tool as Tool, color: s.color, strokeWidth: s.strokeWidth })
    }).catch(() => {})

    window.electronAPI?.onAnnotationState?.((s) => {
      setDraw({ tool: s.tool as Tool, color: s.color, strokeWidth: s.strokeWidth })
    })
    window.electronAPI?.onAnnotationClear?.(() => {
      drawingRef.current = null
      setDrawingPreview(null)
      setShapes([])
    })
    window.electronAPI?.onAnnotationUndo?.(() => {
      setShapes(prev => prev.slice(0, -1))
    })

    return () => {
      window.electronAPI?.removeAllListeners?.('annotation:state')
      window.electronAPI?.removeAllListeners?.('annotation:clear')
      window.electronAPI?.removeAllListeners?.('annotation:undo')
    }
  }, [])

  /** null when no tool is selected — caller should bail out of pointerDown. */
  const startShape = (x: number, y: number): Shape | null => {
    if (draw.tool === 'none') return null
    const id = nextId()
    const base = { id, tool: draw.tool, color: draw.color, strokeWidth: draw.strokeWidth }
    switch (draw.tool) {
      case 'pen':
        return { ...base, kind: 'free', points: [x, y] }
      case 'highlighter':
        return { ...base, kind: 'free', points: [x, y], highlight: true, strokeWidth: draw.strokeWidth * 4 }
      case 'rect':
        return { ...base, kind: 'rect', x, y, w: 0, h: 0 }
      case 'ellipse':
        return { ...base, kind: 'ellipse', x, y, rx: 0, ry: 0 }
      case 'arrow':
        return { ...base, kind: 'arrow', x1: x, y1: y, x2: x, y2: y }
    }
  }

  const updateShape = (s: Shape, x: number, y: number): Shape => {
    if (s.kind === 'free') return { ...s, points: [...s.points, x, y] }
    if (s.kind === 'rect') return { ...s, w: x - s.x, h: y - s.y }
    if (s.kind === 'ellipse') return { ...s, rx: Math.abs(x - s.x), ry: Math.abs(y - s.y) }
    return { ...s, x2: x, y2: y }
  }

  const onPointerDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const stage = e.target.getStage()
    const pos = stage?.getPointerPosition()
    if (!pos) return
    const s = startShape(pos.x, pos.y)
    if (!s) return
    drawingRef.current = s
    setDrawingPreview(s)
  }

  const onPointerMove = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!drawingRef.current) return
    const stage = e.target.getStage()
    const pos = stage?.getPointerPosition()
    if (!pos) return
    const next = updateShape(drawingRef.current, pos.x, pos.y)
    drawingRef.current = next
    setDrawingPreview(next)
  }

  const onPointerUp = () => {
    const s = drawingRef.current
    drawingRef.current = null
    setDrawingPreview(null)
    if (!s) return
    // Drop zero-area shapes — happens when the user clicks without dragging
    // for non-pen tools, leaving a degenerate shape that's just visual noise.
    if (s.kind === 'rect' && s.w === 0 && s.h === 0) return
    if (s.kind === 'ellipse' && s.rx === 0 && s.ry === 0) return
    if (s.kind === 'arrow' && s.x1 === s.x2 && s.y1 === s.y2) return
    setShapes(prev => [...prev, s])
  }

  const renderShape = (s: Shape, key: number | string) => {
    const isHighlight = s.highlight === true
    const opacity = isHighlight ? 0.35 : 1

    if (s.kind === 'free') {
      return (
        <Line
          key={key}
          points={s.points}
          stroke={s.color}
          strokeWidth={s.strokeWidth}
          lineCap="round"
          lineJoin="round"
          tension={0.4}
          opacity={opacity}
        />
      )
    }
    if (s.kind === 'rect') {
      const x = s.w < 0 ? s.x + s.w : s.x
      const y = s.h < 0 ? s.y + s.h : s.y
      return (
        <Rect
          key={key}
          x={x}
          y={y}
          width={Math.abs(s.w)}
          height={Math.abs(s.h)}
          stroke={s.color}
          strokeWidth={s.strokeWidth}
          opacity={opacity}
        />
      )
    }
    if (s.kind === 'ellipse') {
      return (
        <Ellipse
          key={key}
          x={s.x}
          y={s.y}
          radiusX={s.rx}
          radiusY={s.ry}
          stroke={s.color}
          strokeWidth={s.strokeWidth}
          opacity={opacity}
        />
      )
    }
    return (
      <Arrow
        key={key}
        points={[s.x1, s.y1, s.x2, s.y2]}
        stroke={s.color}
        fill={s.color}
        strokeWidth={s.strokeWidth}
        pointerLength={Math.max(8, s.strokeWidth * 3)}
        pointerWidth={Math.max(8, s.strokeWidth * 3)}
        opacity={opacity}
      />
    )
  }

  return (
    <Stage
      width={stageSize.w}
      height={stageSize.h}
      onMouseDown={onPointerDown}
      onMouseMove={onPointerMove}
      onMouseUp={onPointerUp}
      onTouchStart={onPointerDown}
      onTouchMove={onPointerMove}
      onTouchEnd={onPointerUp}
      style={{ position: 'fixed', inset: 0 }}
    >
      <Layer>
        {shapes.map((s, i) => renderShape(s, s.id || i))}
        {drawingPreview && renderShape(drawingPreview, 'preview')}
      </Layer>
    </Stage>
  )
}
