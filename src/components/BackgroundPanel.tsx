import { type Dispatch, type SetStateAction } from 'react'

/* ── Types ── */

export interface GradientDef {
  angle: number
  stops: Array<{ offset: number; color: string }>
}

export interface BgSettings {
  type: 'none' | 'gradient' | 'solid'
  gradientIndex: number
  solidColor: string
  padding: number
  inset: number
  autoBalance: boolean
  shadow: number
  corners: number
  alignment: string
  ratio: string
}

export const DEFAULT_BG: BgSettings = {
  type: 'none',
  gradientIndex: 3,
  solidColor: '#000000',
  padding: 48,
  inset: 0,
  autoBalance: true,
  shadow: 40,
  corners: 12,
  alignment: 'mc',
  ratio: 'auto',
}

/* ── Presets ── */

export const GRADIENT_PRESETS: GradientDef[] = [
  { angle: 135, stops: [{ offset: 0, color: '#f5af19' }, { offset: 1, color: '#f12711' }] },
  { angle: 135, stops: [{ offset: 0, color: '#a855f7' }, { offset: 1, color: '#ec4899' }] },
  { angle: 135, stops: [{ offset: 0, color: '#1e293b' }, { offset: 0.5, color: '#334155' }, { offset: 1, color: '#1e293b' }] },
  { angle: 135, stops: [{ offset: 0, color: '#2dd4bf' }, { offset: 0.5, color: '#67e8f9' }, { offset: 1, color: '#818cf8' }] },
  { angle: 135, stops: [{ offset: 0, color: '#ef4444' }, { offset: 1, color: '#f97316' }] },
  { angle: 135, stops: [{ offset: 0, color: '#e11d48' }, { offset: 1, color: '#be185d' }] },
  { angle: 135, stops: [{ offset: 0, color: '#b45309' }, { offset: 1, color: '#d97706' }] },
  { angle: 135, stops: [{ offset: 0, color: '#44403c' }, { offset: 1, color: '#78716c' }] },
  { angle: 135, stops: [{ offset: 0, color: '#4f46e5' }, { offset: 0.5, color: '#7c3aed' }, { offset: 1, color: '#a855f7' }] },
  { angle: 135, stops: [{ offset: 0, color: '#ec4899' }, { offset: 0.5, color: '#d946ef' }, { offset: 1, color: '#a78bfa' }] },
]

const PLAIN_COLORS = [
  '#000000', '#374151', '#ef4444', '#f97316', '#f59e0b', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899',
  '#1f2937', '#6b7280', '#fca5a5', '#fdba74', '#fcd34d', '#86efac',
  '#5eead4', '#67e8f9', '#93c5fd', '#c4b5fd', '#f0abfc', '#f9a8d4',
]

const ALIGNMENTS = [
  ['tl', 'tc', 'tr'],
  ['ml', 'mc', 'mr'],
  ['bl', 'bc', 'br'],
]

/* ── Helpers ── */

export function gradientToCSS(g: GradientDef): string {
  return `linear-gradient(${g.angle}deg, ${g.stops.map(s => `${s.color} ${s.offset * 100}%`).join(', ')})`
}

export function drawGradientOnCanvas(
  ctx: CanvasRenderingContext2D,
  g: GradientDef,
  w: number,
  h: number,
) {
  const rad = ((g.angle - 90) * Math.PI) / 180
  const diag = Math.sqrt(w * w + h * h) / 2
  const cx = w / 2
  const cy = h / 2
  const grad = ctx.createLinearGradient(
    cx - Math.cos(rad) * diag,
    cy - Math.sin(rad) * diag,
    cx + Math.cos(rad) * diag,
    cy + Math.sin(rad) * diag,
  )
  g.stops.forEach(s => grad.addColorStop(s.offset, s.color))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
}

export function getBackgroundCSS(bg: BgSettings): string {
  if (bg.type === 'gradient') return gradientToCSS(GRADIENT_PRESETS[bg.gradientIndex])
  if (bg.type === 'solid') return bg.solidColor
  return 'radial-gradient(circle, #18181b 0%, #09090b 100%)'
}

export function getShadowCSS(shadow: number): string {
  if (shadow <= 0) return 'none'
  const alpha = Math.min(shadow / 120, 0.65)
  return `0 ${Math.round(shadow / 4)}px ${Math.round(shadow * 1.2)}px rgba(0,0,0,${alpha.toFixed(2)})`
}

/* ── Component ── */

interface Props {
  bg: BgSettings
  onChange: Dispatch<SetStateAction<BgSettings>>
}

export default function BackgroundPanel({ bg, onChange }: Props) {
  const set = <K extends keyof BgSettings>(key: K, val: BgSettings[K]) =>
    onChange(prev => ({ ...prev, [key]: val }))

  return (
    <aside className="w-[280px] flex-shrink-0 glass-refractive border-r border-white/5 flex flex-col overflow-y-auto overflow-x-hidden">
      <div className="p-5 space-y-5">
        {/* None */}
        <button
          onClick={() => set('type', 'none')}
          className={`w-full py-2 rounded-lg text-sm font-semibold transition-all ${
            bg.type === 'none'
              ? 'bg-white/15 text-white'
              : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'
          }`}
          style={{ fontFamily: 'Manrope, sans-serif' }}
        >
          None
        </button>

        {/* Gradients */}
        <Section label="Gradients">
          <div className="grid grid-cols-5 gap-2">
            {GRADIENT_PRESETS.map((g, i) => (
              <button
                key={i}
                onClick={() => onChange(p => ({ ...p, type: 'gradient', gradientIndex: i }))}
                className={`aspect-square rounded-xl transition-all hover:scale-110 ${
                  bg.type === 'gradient' && bg.gradientIndex === i
                    ? 'ring-2 ring-primary ring-offset-2 ring-offset-slate-900 scale-105'
                    : 'border border-white/10'
                }`}
                style={{ background: gradientToCSS(g) }}
              />
            ))}
          </div>
        </Section>

        {/* Plain color */}
        <Section label="Plain color">
          <div className="flex flex-wrap gap-1.5">
            {PLAIN_COLORS.map(c => (
              <button
                key={c}
                onClick={() => onChange(p => ({ ...p, type: 'solid', solidColor: c }))}
                className={`w-[18px] h-[18px] rounded-full transition-all hover:scale-125 flex-shrink-0 ${
                  bg.type === 'solid' && bg.solidColor === c
                    ? 'ring-2 ring-white ring-offset-1 ring-offset-slate-900 scale-110'
                    : ''
                }`}
                style={{ background: c, border: c === '#000000' ? '1px solid rgba(255,255,255,0.15)' : undefined }}
              />
            ))}
          </div>
        </Section>

        <div className="h-px bg-white/5" />

        {/* Padding */}
        <Slider label="Padding" value={bg.padding} min={0} max={120}
          onChange={v => set('padding', v)} />

        {/* Inset + Auto-balance */}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Slider label="Inset" value={bg.inset} min={0} max={60}
              onChange={v => set('inset', v)} />
          </div>
          <label className="flex items-center gap-1.5 pb-0.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={bg.autoBalance}
              onChange={e => set('autoBalance', e.target.checked)}
              className="accent-primary w-3.5 h-3.5 rounded"
            />
            <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">Auto-balance</span>
          </label>
        </div>

        {/* Shadow + Corners */}
        <div className="grid grid-cols-2 gap-4">
          <Slider label="Shadow" value={bg.shadow} min={0} max={100}
            onChange={v => set('shadow', v)} />
          <Slider label="Corners" value={bg.corners} min={0} max={48}
            onChange={v => set('corners', v)} />
        </div>

        {/* Alignment + Ratio */}
        <div className="flex items-start gap-5">
          <div>
            <SectionLabel>Alignment</SectionLabel>
            <div className="grid grid-cols-3 gap-1 mt-2">
              {ALIGNMENTS.flat().map(pos => (
                <button
                  key={pos}
                  onClick={() => set('alignment', pos)}
                  className={`w-6 h-6 rounded-md border transition-all flex items-center justify-center ${
                    bg.alignment === pos
                      ? 'bg-primary/30 border-primary/50'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className={`w-2 h-2 rounded-[2px] ${
                    bg.alignment === pos ? 'bg-primary' : 'bg-slate-600'
                  }`} />
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1">
            <SectionLabel>Ratio</SectionLabel>
            <select
              value={bg.ratio}
              onChange={e => set('ratio', e.target.value)}
              className="mt-2 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-primary/40 cursor-pointer"
            >
              <option value="auto">Auto</option>
              <option value="16:9">16:9</option>
              <option value="4:3">4:3</option>
              <option value="1:1">1:1</option>
              <option value="9:16">9:16</option>
            </select>
          </div>
        </div>
      </div>
    </aside>
  )
}

/* ── Sub-components ── */

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-2.5">{children}</div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block"
      style={{ fontFamily: 'Manrope, sans-serif' }}
    >
      {children}
    </span>
  )
}

function Slider({ label, value, min, max, onChange }: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-primary h-1 cursor-pointer"
      />
    </div>
  )
}
