import { useState } from 'react'
import type { WorkflowResult } from '../types'

interface Props {
  imageDataUrl: string
  templateId?: string
  onClose: () => void
}

type Status = 'idle' | 'loading' | 'done' | 'error'

export default function ShareDialog({ imageDataUrl, templateId, onClose }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<WorkflowResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const addToHistory = (savedPath?: string) =>
    window.electronAPI?.addHistoryItem({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      name: savedPath ? savedPath.split(/[\\/]/).pop() : `capture-${new Date().toLocaleString()}`,
      dataUrl: imageDataUrl,
      filePath: savedPath,
      type: 'screenshot',
      uploads: []
    })

  const handleCopyClipboard = async () => {
    setStatus('loading')
    try {
      // runWorkflow saves to history internally — no need to addToHistory here
      await window.electronAPI?.runWorkflow('builtin-clipboard', imageDataUrl)
      setStatus('done')
      setTimeout(onClose, 1200)
    } catch (e) {
      setErrorMsg(String(e))
      setStatus('error')
    }
  }

  const handleSave = async () => {
    setStatus('loading')
    const res = await window.electronAPI?.showSaveDialog({
      defaultPath: `capture-${Date.now()}.png`,
      filters: [{ name: 'Images', extensions: ['png'] }]
    })
    if (!res || res.canceled || !res.filePath) { setStatus('idle'); return }
    try {
      await window.electronAPI?.saveFile(imageDataUrl, res.filePath)
      addToHistory(res.filePath)
      setStatus('done')
      setTimeout(onClose, 1200)
    } catch (e) {
      setErrorMsg(String(e))
      setStatus('error')
    }
  }

  const handleRunWorkflow = async () => {
    if (!templateId) return
    setStatus('loading')
    try {
      const r = await window.electronAPI?.runWorkflow(templateId, imageDataUrl)
      setResult(r ?? null)
      setStatus('done')
    } catch (e) {
      setErrorMsg(String(e))
      setStatus('error')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="glass-refractive rounded-3xl p-8 w-[480px] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>Share Capture</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Preview */}
        <div className="aspect-video bg-slate-900 rounded-2xl overflow-hidden mb-6 border border-white/10">
          <img src={imageDataUrl} className="w-full h-full object-contain" />
        </div>

        {status === 'idle' && (
          <div className="space-y-3">
            {templateId && (
              <button
                onClick={handleRunWorkflow}
                className="w-full primary-gradient text-slate-900 font-bold py-4 rounded-2xl flex items-center justify-center gap-3 hover:scale-[1.02] transition-transform"
                style={{ fontFamily: 'Manrope, sans-serif' }}
              >
                <span className="material-symbols-outlined">rocket_launch</span>
                Run Workflow
              </button>
            )}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleCopyClipboard}
                className="flex items-center justify-center gap-2 py-3 bg-white/5 hover:bg-white/10 rounded-2xl text-sm font-semibold text-white transition-all border border-white/10"
                style={{ fontFamily: 'Manrope, sans-serif' }}
              >
                <span className="material-symbols-outlined text-sm">content_copy</span>
                Copy
              </button>
              <button
                onClick={handleSave}
                className="flex items-center justify-center gap-2 py-3 bg-white/5 hover:bg-white/10 rounded-2xl text-sm font-semibold text-white transition-all border border-white/10"
                style={{ fontFamily: 'Manrope, sans-serif' }}
              >
                <span className="material-symbols-outlined text-sm">save</span>
                Save
              </button>
            </div>
          </div>
        )}

        {status === 'loading' && (
          <div className="flex items-center justify-center py-8 gap-4">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-slate-400 text-sm">Processing...</span>
          </div>
        )}

        {status === 'done' && result && (
          <div className="space-y-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>Results</p>
            {result.copiedToClipboard && (
              <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                <span className="material-symbols-outlined text-secondary">check_circle</span>
                <span className="text-sm text-slate-200">Copied to clipboard</span>
              </div>
            )}
            {result.savedPath && (
              <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                <span className="material-symbols-outlined text-secondary">check_circle</span>
                <span className="text-sm text-slate-200 truncate">Saved: {result.savedPath}</span>
              </div>
            )}
            {result.uploads.map((u, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-white/5 rounded-xl">
                <div className="flex items-center gap-3">
                  <span className={`material-symbols-outlined ${u.success ? 'text-secondary' : 'text-tertiary'}`}>
                    {u.success ? 'check_circle' : 'error'}
                  </span>
                  <span className="text-sm text-slate-200 capitalize">{u.destination}</span>
                </div>
                {u.url && (
                  <button
                    onClick={() => window.electronAPI?.openExternal(u.url!)}
                    className="text-xs text-primary hover:underline"
                  >
                    Open ↗
                  </button>
                )}
                {u.error && <span className="text-xs text-tertiary truncate max-w-32">{u.error}</span>}
              </div>
            ))}
          </div>
        )}

        {status === 'done' && !result && (
          <div className="flex items-center gap-3 py-4">
            <span className="material-symbols-outlined text-secondary">check_circle</span>
            <span className="text-sm text-slate-200">Done!</span>
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-center gap-3 py-4">
            <span className="material-symbols-outlined text-tertiary">error</span>
            <span className="text-sm text-tertiary">{errorMsg}</span>
          </div>
        )}
      </div>
    </div>
  )
}
