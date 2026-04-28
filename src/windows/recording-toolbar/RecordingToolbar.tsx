import { useEffect, useRef, useState } from 'react'

type Phase = 'init' | 'countdown' | 'recording' | 'paused' | 'stopping' | 'saving' | 'done' | 'error'

const COUNTDOWN_START = 3

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function RecordingToolbar() {
  const [phase, setPhase] = useState<Phase>('init')
  const [elapsed, setElapsed] = useState(0)
  const [countdown, setCountdown] = useState(COUNTDOWN_START)
  const [micEnabled, setMicEnabled] = useState(false)
  const [error, setError] = useState<string>('')

  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Body transparent
  useEffect(() => {
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
  }, [])

  // Listen for state updates from main
  useEffect(() => {
    const handler = (s: { phase?: Phase; elapsedMs?: number; countdown?: number; micEnabled?: boolean; error?: string }) => {
      if (s.phase === 'countdown') {
        // Start local countdown (main just kicks it off)
        setPhase('countdown')
        setCountdown(COUNTDOWN_START)
        if (countdownTimer.current) clearInterval(countdownTimer.current)
        let c = COUNTDOWN_START
        countdownTimer.current = setInterval(() => {
          c -= 1
          setCountdown(c)
          if (c <= 0) {
            if (countdownTimer.current) { clearInterval(countdownTimer.current); countdownTimer.current = null }
            window.electronAPI?.toolbarBegin?.()
          }
        }, 1000)
        return
      }
      // Some state messages (e.g. mic toggle) carry only a payload field
      // and intentionally omit `phase` so they don't disturb the current
      // toolbar phase — for instance, toggling mic mid-countdown must not
      // flip the toolbar to 'recording' before MediaRecorder actually starts.
      if (s.phase) setPhase(s.phase)
      if (typeof s.elapsedMs === 'number') setElapsed(s.elapsedMs)
      if (typeof s.micEnabled === 'boolean') setMicEnabled(s.micEnabled)
      if (s.error) setError(s.error)
    }
    window.electronAPI?.onToolbarState?.(handler)
    return () => { window.electronAPI?.removeAllListeners?.('toolbar:state') }
  }, [])

  // Cleanup countdown interval on unmount
  useEffect(() => {
    return () => { if (countdownTimer.current) clearInterval(countdownTimer.current) }
  }, [])

  const handleStop   = () => window.electronAPI?.toolbarStop?.()
  const handleCancel = () => window.electronAPI?.toolbarCancel?.()
  const handlePause  = () => window.electronAPI?.toolbarPause?.()
  const handleResume = () => window.electronAPI?.toolbarResume?.()
  const handleMic    = () => {
    const next = !micEnabled
    setMicEnabled(next)
    window.electronAPI?.toolbarToggleMic?.(next)
  }

  const isRecording = phase === 'recording'
  const isPaused = phase === 'paused'
  const isBusy = phase === 'stopping' || phase === 'saving'

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ fontFamily: 'Manrope, sans-serif' }}>
      <div
        className="flex items-center gap-2 px-3 py-2 glass-refractive rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        style={{
          WebkitAppRegion: 'drag',
          background: 'rgba(20,20,28,0.85)',
          border: '1px solid rgba(255,255,255,0.08)',
        } as React.CSSProperties}
      >
        {/* Countdown view */}
        {phase === 'countdown' && (
          <div className="flex items-center gap-3 px-3">
            <span className="text-xs font-bold uppercase tracking-widest text-red-400">Starting in</span>
            <span
              className="text-3xl font-black text-white tabular-nums"
              style={{ minWidth: 36, textAlign: 'center' }}
              key={countdown}
            >
              {countdown}
            </span>
            <div className="w-px h-6 bg-white/10" />
            {/* Mic toggle — RecorderHost has already pre-acquired the mic
                track during this countdown window, so flipping it here is
                instant and stays in effect once recording begins. */}
            <ToolbarBtn
              icon={micEnabled ? 'mic' : 'mic_off'}
              label={micEnabled ? 'Mute microphone' : 'Enable microphone'}
              onClick={handleMic}
              active={micEnabled}
              accent={micEnabled ? 'red' : 'neutral'}
            />
          </div>
        )}

        {/* Saving / done / error view */}
        {(phase === 'stopping' || phase === 'saving') && (
          <div className="flex items-center gap-3 px-4">
            <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-semibold text-slate-200">Saving…</span>
          </div>
        )}
        {phase === 'done' && (
          <div className="flex items-center gap-3 px-4">
            <span className="material-symbols-outlined text-emerald-400">check_circle</span>
            <span className="text-xs font-semibold text-slate-200">Saved</span>
          </div>
        )}
        {phase === 'error' && (
          <div className="flex items-center gap-3 px-4">
            <span className="material-symbols-outlined text-red-400">error</span>
            <span className="text-xs font-semibold text-red-300 max-w-[320px] truncate" title={error}>{error || 'Recording failed'}</span>
          </div>
        )}

        {/* Recording / paused view */}
        {(isRecording || isPaused) && (
          <>
            {/* LIVE indicator */}
            <div className="flex items-center gap-2 pl-2 pr-1">
              <span
                className={`w-2.5 h-2.5 rounded-full bg-red-500 ${isRecording ? 'animate-pulse' : 'opacity-50'}`}
                style={{ boxShadow: isRecording ? '0 0 10px rgba(239,68,68,0.8)' : 'none' }}
              />
              <span
                className="text-sm font-black text-white tabular-nums"
                style={{ minWidth: 56, textAlign: 'center' }}
              >
                {formatTime(elapsed)}
              </span>
            </div>

            <div className="w-px h-6 bg-white/10" />

            {/* Mic toggle */}
            <ToolbarBtn
              icon={micEnabled ? 'mic' : 'mic_off'}
              label={micEnabled ? 'Mute microphone' : 'Enable microphone'}
              onClick={handleMic}
              active={micEnabled}
              accent={micEnabled ? 'red' : 'neutral'}
            />

            {/* Pause / Resume */}
            {isRecording ? (
              <ToolbarBtn
                icon="pause"
                label="Pause"
                onClick={handlePause}
              />
            ) : (
              <ToolbarBtn
                icon="play_arrow"
                label="Resume"
                onClick={handleResume}
                accent="red"
                active
              />
            )}

            {/* Stop */}
            <ToolbarBtn
              icon="stop"
              label="Stop recording"
              onClick={handleStop}
              accent="red"
              active
              disabled={isBusy}
            />

            <div className="w-px h-6 bg-white/10" />

            {/* Cancel */}
            <ToolbarBtn
              icon="close"
              label="Cancel (discard)"
              onClick={handleCancel}
              disabled={isBusy}
              compact
            />
          </>
        )}
      </div>
    </div>
  )
}

function ToolbarBtn({
  icon, label, onClick, active = false, accent = 'neutral', disabled = false, compact = false,
}: {
  icon: string
  label: string
  onClick: () => void
  active?: boolean
  accent?: 'neutral' | 'red'
  disabled?: boolean
  compact?: boolean
}) {
  const base = 'flex items-center justify-center rounded-full transition-all disabled:opacity-40 disabled:cursor-not-allowed'
  const size = compact ? 'w-7 h-7' : 'w-9 h-9'
  let color: string
  if (active && accent === 'red') {
    color = 'bg-red-500/90 text-white hover:bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]'
  } else if (active) {
    color = 'bg-white/15 text-white hover:bg-white/25'
  } else {
    color = 'text-slate-300 hover:text-white hover:bg-white/10'
  }
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      className={`${base} ${size} ${color}`}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <span className={`material-symbols-outlined ${compact ? 'text-[16px]' : 'text-[18px]'}`}>{icon}</span>
    </button>
  )
}
