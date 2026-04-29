import { useState, useEffect } from 'react'

/** First-run prompt asking whether to bind the physical PrintScreen key to
 *  Lumia's "New Capture" action. Fires once: on the first app launch where
 *  printScreenPromptShown is still false. Either button (Yes/No) marks it
 *  as shown so we never re-ask; the user can change their answer later in
 *  Settings → General.
 *
 *  Windows-only on purpose — built-in Mac keyboards don't have PrintScreen,
 *  so the prompt would be meaningless to most macOS users. Mac users on an
 *  external PC keyboard can opt in manually from Settings.
 */
export function PrintScreenPromptDialog() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [warning, setWarning] = useState('')

  useEffect(() => {
    if (window.electronAPI?.platform !== 'win32') return
    window.electronAPI?.getSettings?.().then(s => {
      if (s && !s.printScreenPromptShown) setOpen(true)
    }).catch(() => { /* ignore — prompt will simply not show this session */ })
  }, [])

  const close = () => { setOpen(false); setWarning('') }

  const handleYes = async () => {
    setBusy(true)
    try {
      const res = await window.electronAPI?.setPrintScreenAsCapture?.(true)
      // setPrintScreenAsCapture already flips printScreenPromptShown=true
      // server-side, so a "Yes" click costs one IPC instead of two.
      if (res?.warning) setWarning(res.warning)
      else              close()
    } finally {
      setBusy(false)
    }
  }

  const handleNo = async () => {
    setBusy(true)
    try {
      // Don't flip printScreenAsCapture — leave the default off. We only need
      // to record that we asked, so future launches stay quiet.
      await window.electronAPI?.setSetting?.('printScreenPromptShown', true)
      close()
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="glass-card rounded-2xl p-7 flex flex-col gap-5 max-w-md mx-4 shadow-2xl border border-white/10">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-primary">keyboard</span>
          </div>
          <div className="space-y-1.5">
            <h2 className="text-base font-bold text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Use PrintScreen for capture?
            </h2>
            <p className="text-[13px] text-slate-400 leading-relaxed">
              Bind the PrtSc key to "New Capture" — pressing it instantly replays your last capture mode. Lumia will turn off the Windows "PrintScreen opens Snipping Tool" shortcut so the keypress reaches us.
            </p>
            <p className="text-[11px] text-slate-500">You can change this anytime in Settings → General.</p>
          </div>
        </div>

        {warning && (
          <p className="text-[11px] text-amber-400 leading-snug bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
            <span className="material-symbols-outlined text-[14px] align-middle mr-1">warning</span>
            {warning}
          </p>
        )}

        <div className="flex justify-end gap-2">
          {warning ? (
            <button
              disabled={busy}
              onClick={close}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors cursor-pointer disabled:opacity-50"
            >
              Got it
            </button>
          ) : (
            <>
              <button
                disabled={busy}
                onClick={handleNo}
                className="px-4 py-2 text-sm rounded-lg bg-white/5 text-slate-300 hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50"
              >
                Not now
              </button>
              <button
                disabled={busy}
                onClick={handleYes}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors cursor-pointer disabled:opacity-50"
              >
                Use PrintScreen
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
