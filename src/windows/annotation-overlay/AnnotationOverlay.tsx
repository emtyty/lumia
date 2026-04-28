import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Line, Arrow, Rect, Ellipse, Group, Circle, Transformer } from 'react-konva'
import type Konva from 'konva'

type Tool = 'none' | 'select' | 'pen' | 'arrow' | 'rect' | 'ellipse' | 'highlighter'

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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)

  // Drop the selection whenever the user switches away from select mode
  // (drawing on top of the X handle would be confusing) or the shape it
  // points at goes away (e.g. via Clear / Undo).
  useEffect(() => {
    if (draw.tool !== 'select') setSelectedId(null)
  }, [draw.tool])
  useEffect(() => {
    if (selectedId && !shapes.some(s => s.id === selectedId)) setSelectedId(null)
  }, [shapes, selectedId])

  // Attach the Konva Transformer to the currently selected shape's group
  // so the user gets the same resize-frame affordance the post-capture
  // editor surfaces around its selected objects.
  useEffect(() => {
    const tr = trRef.current
    const stage = stageRef.current
    if (!tr || !stage) return
    if (!selectedId) { tr.nodes([]); tr.getLayer()?.batchDraw(); return }
    const node = stage.findOne('#' + selectedId)
    if (node) { tr.nodes([node]); tr.getLayer()?.batchDraw() }
    else tr.nodes([])
  }, [selectedId, shapes])

  useEffect(() => {
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
  }, [])

  // Cursor reflects what kind of click the overlay will register:
  //   none   -> default (overlay is click-through anyway)
  //   select -> arrow, with each shape switching to pointer on hover
  //             via Konva's listener config below
  //   draw   -> crosshair
  useEffect(() => {
    document.body.style.cursor =
      draw.tool === 'none' ? 'default' :
      draw.tool === 'select' ? 'default' :
      'crosshair'
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

  /** null when the active tool isn't a drawing tool. Caller bails on null. */
  const startShape = (x: number, y: number): Shape | null => {
    if (draw.tool === 'none' || draw.tool === 'select') return null
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

  /** Bake a (dx, dy) offset into a shape's underlying coordinates so the
   *  next React render of the data alone reproduces the dragged position
   *  without relying on the Konva node's transient x/y. */
  const translateShape = (s: Shape, dx: number, dy: number): Shape => {
    if (s.kind === 'free') {
      return { ...s, points: s.points.map((p, i) => i % 2 === 0 ? p + dx : p + dy) }
    }
    if (s.kind === 'rect') return { ...s, x: s.x + dx, y: s.y + dy }
    if (s.kind === 'ellipse') return { ...s, x: s.x + dx, y: s.y + dy }
    return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }
  }

  const onPointerDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const stage = e.target.getStage()
    const pos = stage?.getPointerPosition()
    if (!pos) return
    if (draw.tool === 'select') {
      // Clicking empty stage area in select mode dismisses the X handle.
      // Per-shape clicks are handled by their own onClick listener and
      // don't bubble up here because Konva stops propagation by default
      // when a child sets a target.
      if (e.target === stage) setSelectedId(null)
      return
    }
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

  const renderShape = (s: Shape, key: number | string, isPreview = false) => {
    const isHighlight = s.highlight === true
    const opacity = isHighlight ? 0.35 : 1
    // In select mode, every committed shape is interactive: listening +
    // draggable, click selects it. The currently-being-drawn preview is
    // still rendered every frame so we exclude it from selection / drag
    // — it has no committed id yet.
    const selectable = !isPreview && draw.tool === 'select'

    // Visual node — colours and geometry. Konva's hit-testing cascades
    // from the wrapping Group's `listening`, so we don't need to explicitly
    // set listening here. hitStrokeWidth makes thin pen strokes easier to
    // grab when the user is in select mode.
    const inner = (() => {
      const visual = {
        stroke: s.color,
        strokeWidth: s.strokeWidth,
        opacity,
        hitStrokeWidth: Math.max(s.strokeWidth + 8, 14),
      }
      if (s.kind === 'free') {
        return (
          <Line
            {...visual}
            points={s.points}
            lineCap="round"
            lineJoin="round"
            tension={0.4}
          />
        )
      }
      if (s.kind === 'rect') {
        const x = s.w < 0 ? s.x + s.w : s.x
        const y = s.h < 0 ? s.y + s.h : s.y
        return <Rect {...visual} x={x} y={y} width={Math.abs(s.w)} height={Math.abs(s.h)} />
      }
      if (s.kind === 'ellipse') {
        return <Ellipse {...visual} x={s.x} y={s.y} radiusX={s.rx} radiusY={s.ry} />
      }
      return (
        <Arrow
          {...visual}
          points={[s.x1, s.y1, s.x2, s.y2]}
          fill={s.color}
          pointerLength={Math.max(8, s.strokeWidth * 3)}
          pointerWidth={Math.max(8, s.strokeWidth * 3)}
        />
      )
    })()

    if (isPreview) return <Group key={key} listening={false}>{inner}</Group>

    return (
      <Group
        key={key}
        id={s.id}
        listening={selectable}
        draggable={selectable}
        onClick={(e) => { if (selectable) { e.cancelBubble = true; setSelectedId(s.id) } }}
        onMouseEnter={() => { if (selectable) document.body.style.cursor = 'pointer' }}
        onMouseLeave={() => { if (selectable) document.body.style.cursor = 'default' }}
        onDragEnd={(e) => {
          const node = e.target
          const dx = node.x()
          const dy = node.y()
          if (dx === 0 && dy === 0) return
          setShapes(prev => prev.map(p => p.id === s.id ? translateShape(p, dx, dy) : p))
          // Reset the Group's position so the next render (which already
          // bakes the offset into the data) doesn't double-apply it.
          node.position({ x: 0, y: 0 })
        }}
      >
        {inner}
      </Group>
    )
  }

  // Track the top-right of the selected shape's Konva node so the X
  // delete handle stays glued to the corner during drag / transform —
  // querying the node directly avoids waiting for React state updates.
  const [deleteHandle, setDeleteHandle] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!selectedId) { setDeleteHandle(null); return }
    const stage = stageRef.current
    if (!stage) { setDeleteHandle(null); return }
    const node = stage.findOne('#' + selectedId)
    const layer = node?.getLayer() ?? null
    if (!node || !layer) { setDeleteHandle(null); return }
    const update = () => {
      const box = node.getClientRect({ relativeTo: layer as any })
      setDeleteHandle({ x: box.x + box.width, y: box.y })
    }
    update()
    node.on('dragmove.deletehandle transform.deletehandle', update)
    return () => { node.off('dragmove.deletehandle transform.deletehandle') }
  }, [selectedId, shapes])

  const selectedShape = selectedId ? shapes.find(s => s.id === selectedId) ?? null : null
  const deleteSelected = () => {
    if (!selectedId) return
    setShapes(prev => prev.filter(s => s.id !== selectedId))
    setSelectedId(null)
  }

  return (
    <Stage
      ref={stageRef}
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
        {drawingPreview && renderShape(drawingPreview, 'preview', true)}
        <Transformer
          ref={trRef}
          rotateEnabled={false}
          borderStroke="#a78bfa"
          anchorStroke="#a78bfa"
          anchorFill="#ffffff"
          anchorSize={8}
        />
        {deleteHandle && selectedShape && (
          <Group
            x={deleteHandle.x + 12}
            y={deleteHandle.y - 12}
            onClick={(e) => { e.cancelBubble = true; deleteSelected() }}
            onMouseEnter={() => { document.body.style.cursor = 'pointer' }}
            onMouseLeave={() => { document.body.style.cursor = 'default' }}
          >
            <Circle radius={11} fill="#ef4444" stroke="#ffffff" strokeWidth={2} shadowColor="#000" shadowBlur={6} shadowOpacity={0.4} />
            <Line points={[-4, -4, 4, 4]} stroke="#ffffff" strokeWidth={2} lineCap="round" />
            <Line points={[-4, 4, 4, -4]} stroke="#ffffff" strokeWidth={2} lineCap="round" />
          </Group>
        )}
      </Layer>
    </Stage>
  )
}
