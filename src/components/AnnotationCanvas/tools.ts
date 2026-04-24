/** Shared tool / palette constants used by both the image editor and video
 *  annotator. Keep this file free of React imports so it can be consumed by
 *  pure render helpers too. */

export type Tool = 'select' | 'pen' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'blur'

export interface ToolDef {
  id: Tool
  icon: string
  label: string
  shortcut: string
}

export const DRAW_TOOLS: ToolDef[] = [
  { id: 'pen',     icon: 'draw',              label: 'Pen',       shortcut: 'P' },
  { id: 'blur',    icon: 'blur_on',           label: 'Blur',      shortcut: 'B' },
  { id: 'text',    icon: 'title',             label: 'Text',      shortcut: 'T' },
]

export const SHAPE_TOOLS: ToolDef[] = [
  { id: 'rect',    icon: 'crop_square',       label: 'Rectangle', shortcut: 'R' },
  { id: 'ellipse', icon: 'circle',            label: 'Ellipse',   shortcut: 'E' },
  { id: 'arrow',   icon: 'arrow_forward',     label: 'Arrow',     shortcut: 'A' },
]

export const SELECT_TOOLS: ToolDef[] = [
  { id: 'select',  icon: 'arrow_selector_tool', label: 'Select',  shortcut: 'V' },
]

/** All tools in a single lookup — used for keyboard shortcut handling. */
export const ALL_TOOLS: ToolDef[] = [...DRAW_TOOLS, ...SHAPE_TOOLS, ...SELECT_TOOLS]

/** Canonical color palette. Keep order stable — users learn positions. */
export const COLORS = [
  '#f87171', // red
  '#fb923c', // orange
  '#fbbf24', // amber
  '#34d399', // emerald
  '#60a5fa', // blue
  '#a78bfa', // violet
  '#f472b6', // pink
  '#ffffff', // white
  '#000000', // black
] as const

/** Stroke-width quick picks shown alongside the slider. */
export const STROKE_PRESETS = [2, 4, 8] as const

/** Return tool id for a keyboard key (case-insensitive). Null = no match. */
export function matchToolShortcut(key: string): Tool | null {
  const upper = key.toUpperCase()
  return ALL_TOOLS.find(t => t.shortcut === upper)?.id ?? null
}
