import { useState, useEffect } from 'react'

interface AppSettings {
  imgurClientId: string
  defaultSavePath: string
  customUploadUrl: string
  customUploadHeaders: Record<string, string>
  customUploadFieldName: string
  theme: 'dark' | 'light'
}

const DEFAULT_SETTINGS: AppSettings = {
  imgurClientId: '',
  defaultSavePath: '',
  customUploadUrl: '',
  customUploadHeaders: {},
  customUploadFieldName: 'file',
  theme: 'dark'
}

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.electronAPI?.getSettings().then(s => {
      setSettings(s)
      setLoading(false)
    })
  }, [])

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  const handleSave = async () => {
    for (const [key, value] of Object.entries(settings)) {
      await window.electronAPI?.setSetting(key as keyof AppSettings, value)
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const handlePickFolder = async () => {
    const result = await window.electronAPI?.showOpenDialog({
      title: 'Select default save folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result && !result.canceled && result.filePaths[0]) {
      update('defaultSavePath', result.filePaths[0])
    }
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-screen overflow-y-auto pt-[6.5rem]">
      {/* Top bar */}
      <header
        className="fixed top-10 right-0 h-16 liquid-glass flex items-center justify-between px-8 z-40"
        style={{ left: '16rem' }}
      >
        <div>
          <h2 className="text-base font-bold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>Settings</h2>
          <p className="text-[11px] text-slate-400">Configure uploads, paths and integrations</p>
        </div>
        <button
          onClick={handleSave}
          className="primary-gradient text-slate-900 font-bold px-6 py-2.5 rounded-xl text-sm flex items-center gap-2 hover:scale-105 transition-transform"
          style={{ fontFamily: 'Manrope, sans-serif' }}
        >
          <span className="material-symbols-outlined text-sm">
            {saved ? 'check_circle' : 'save'}
          </span>
          {saved ? 'Saved!' : 'Save Changes'}
        </button>
      </header>

      <div className="p-10 space-y-8 max-w-2xl">

        {/* Capture */}
        <Section title="Capture" icon="add_a_photo">
          <Field
            label="Default Save Path"
            description="Where screenshots and recordings are saved when using 'Save to Disk' steps"
          >
            <div className="flex gap-2">
              <input
                value={settings.defaultSavePath}
                onChange={e => update('defaultSavePath', e.target.value)}
                placeholder="e.g. C:\Users\You\Pictures\ShareAnywhere"
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary/40"
              />
              <button
                onClick={handlePickFolder}
                className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-slate-400 hover:text-white transition-all"
                title="Browse"
              >
                <span className="material-symbols-outlined text-sm">folder_open</span>
              </button>
            </div>
          </Field>
        </Section>

        {/* Imgur */}
        <Section title="Imgur Upload" icon="image">
          <Field
            label="Client ID"
            description="Your Imgur app Client ID. Leave blank to use the built-in anonymous key (rate-limited)."
          >
            <input
              value={settings.imgurClientId}
              onChange={e => update('imgurClientId', e.target.value)}
              placeholder="e.g. f0ea04148a54268"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary/40"
            />
          </Field>
          <p className="text-[11px] text-slate-500 mt-2">
            Register a free app at{' '}
            <button
              onClick={() => window.electronAPI?.openExternal('https://api.imgur.com/oauth2/addclient')}
              className="text-primary hover:underline"
            >
              api.imgur.com
            </button>{' '}
            to get your own Client ID and avoid rate limits.
          </p>
        </Section>

        {/* Custom Upload */}
        <Section title="Custom HTTP Upload" icon="api">
          <Field
            label="Endpoint URL"
            description="POST endpoint that receives the image file. Leave blank to disable."
          >
            <input
              value={settings.customUploadUrl}
              onChange={e => update('customUploadUrl', e.target.value)}
              placeholder="https://your-server.com/upload"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary/40"
            />
          </Field>
          <Field
            label="Form Field Name"
            description="The multipart field name for the image file"
          >
            <input
              value={settings.customUploadFieldName}
              onChange={e => update('customUploadFieldName', e.target.value)}
              placeholder="file"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary/40"
            />
          </Field>
          <Field
            label="Authorization Header"
            description="Optional Bearer token sent with every upload request"
          >
            <input
              value={settings.customUploadHeaders['Authorization'] ?? ''}
              onChange={e => update('customUploadHeaders', {
                ...settings.customUploadHeaders,
                ...(e.target.value ? { Authorization: e.target.value } : (() => {
                  const h = { ...settings.customUploadHeaders }
                  delete h['Authorization']
                  return h
                })())
              })}
              placeholder="Bearer your-token"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary/40"
            />
          </Field>
        </Section>

        {/* Hotkeys (read-only reference) */}
        <Section title="Default Hotkeys" icon="keyboard">
          <div className="space-y-2">
            {HOTKEY_REFERENCE.map(({ action, key }) => (
              <div key={action} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <span className="text-sm text-slate-300" style={{ fontFamily: 'Manrope, sans-serif' }}>{action}</span>
                <kbd className="px-3 py-1 bg-white/5 border border-white/10 rounded-lg text-xs font-mono text-slate-400">{key}</kbd>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-4">Hotkey rebinding coming in a future release.</p>
        </Section>

      </div>
    </div>
  )
}

const HOTKEY_REFERENCE = [
  { action: 'Region Screenshot',   key: 'Ctrl+Shift+4' },
  { action: 'Fullscreen',          key: 'Ctrl+Shift+3' },
  { action: 'Active Window',       key: 'Ctrl+Shift+2' },
  { action: 'Screen Recorder',     key: 'Ctrl+Shift+R' },
  { action: 'GIF Recorder',        key: 'Ctrl+Shift+G' },
  { action: 'Stop Recording',      key: 'Ctrl+Shift+S' },
  { action: 'Open Main Window',    key: 'Ctrl+Shift+X' },
]

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="glass-refractive rounded-3xl p-6 space-y-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
          <span className="material-symbols-outlined text-primary text-lg">{icon}</span>
        </div>
        <h3 className="text-sm font-bold text-white uppercase tracking-widest" style={{ fontFamily: 'Manrope, sans-serif' }}>{title}</h3>
      </div>
      {children}
    </div>
  )
}

function Field({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold text-slate-300" style={{ fontFamily: 'Manrope, sans-serif' }}>{label}</label>
      {children}
      <p className="text-[11px] text-slate-500">{description}</p>
    </div>
  )
}
