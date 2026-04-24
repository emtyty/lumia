import { useState, useEffect, useRef } from 'react'

interface AppSettings {
  imgurClientId: string
  customUploadUrl: string
  customUploadHeaders: Record<string, string>
  customUploadFieldName: string
  theme: 'dark' | 'light' | 'system'
  googleDriveRefreshToken: string
  googleDriveAccessToken: string
  googleDriveTokenExpiresAt: number
  googleDriveFolderId: string
  launchAtStartup: boolean
  historyRetentionDays: number
}

const DEFAULT_SETTINGS: AppSettings = {
  imgurClientId: '',
  customUploadUrl: '',
  customUploadHeaders: {},
  customUploadFieldName: 'file',
  theme: 'system',
  googleDriveRefreshToken: '',
  googleDriveAccessToken: '',
  googleDriveTokenExpiresAt: 0,
  googleDriveFolderId: '',
  launchAtStartup: true,
  historyRetentionDays: 0
}

const RETENTION_OPTIONS = [
  { value: 0, label: 'Keep forever' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 180, label: '180 days' },
  { value: 365, label: '1 year' },
]

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [savedToast, setSavedToast] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const originalRef = useRef<AppSettings>(DEFAULT_SETTINGS)
  const [gdriveConnecting, setGdriveConnecting] = useState(false)
  const [gdriveError, setGdriveError] = useState('')

  useEffect(() => {
    window.electronAPI?.getSettings().then(s => {
      // defaultSavePath is managed automatically by the save dialog — not part of the UI state.
      const { defaultSavePath: _ignored, ...ui } = s
      void _ignored
      setSettings(ui)
      originalRef.current = ui
      setLoading(false)
    })
  }, [])

  const isDirty = JSON.stringify(settings) !== JSON.stringify(originalRef.current)

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  const applyTheme = (mode: 'dark' | 'light' | 'system') => {
    const resolved = mode === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode
    document.documentElement.classList.toggle('light', resolved === 'light')
  }

  const handleThemeChange = async (next: 'dark' | 'light' | 'system') => {
    update('theme', next)
    applyTheme(next)
    originalRef.current = { ...originalRef.current, theme: next }
    await window.electronAPI?.setSetting('theme', next)
    window.electronAPI?.setTitleBarTheme(next)
    window.dispatchEvent(new CustomEvent('lumia:theme-changed', { detail: next }))
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const next = (e as CustomEvent<'dark' | 'light' | 'system'>).detail
      setSettings(prev => ({ ...prev, theme: next }))
      originalRef.current = { ...originalRef.current, theme: next }
    }
    window.addEventListener('lumia:theme-changed', handler)
    return () => window.removeEventListener('lumia:theme-changed', handler)
  }, [])

  const handleSave = async () => {
    for (const [key, value] of Object.entries(settings)) {
      await window.electronAPI?.setSetting(key as keyof AppSettings, value)
    }
    originalRef.current = { ...settings }
    setSavedToast(true)
    setTimeout(() => setSavedToast(false), 2500)
  }

  const gdriveConnected = !!settings.googleDriveRefreshToken

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const handleGdriveAuth = async () => {
    setGdriveConnecting(true)
    setGdriveError('')
    const result = await window.electronAPI?.gdriveStartAuth()
    if (result?.success) {
      const s = await window.electronAPI?.getSettings()
      if (s) { setSettings(s); originalRef.current = s }
    } else {
      setGdriveError(result?.error ?? 'Authorization failed')
    }
    setGdriveConnecting(false)
  }

  const handleGdriveDisconnect = async () => {
    await window.electronAPI?.gdriveDisconnect()
    update('googleDriveRefreshToken', '')
    update('googleDriveAccessToken', '')
  }

  const platform = window.electronAPI?.platform
  const supportsStartup = platform === 'win32' || platform === 'darwin'

  const handleLaunchAtStartupChange = async (next: boolean) => {
    update('launchAtStartup', next)
    originalRef.current = { ...originalRef.current, launchAtStartup: next }
    await window.electronAPI?.setSetting('launchAtStartup', next)
  }

  const handleHistoryRetentionChange = async (next: number) => {
    update('historyRetentionDays', next)
    originalRef.current = { ...originalRef.current, historyRetentionDays: next }
    await window.electronAPI?.setSetting('historyRetentionDays', next)
  }

  const NAV_ITEMS = [
    { id: 'general', icon: 'tune', label: 'General' },
    { id: 'appearance', icon: 'palette', label: 'Appearance' },
    { id: 'imgur', icon: 'image', label: 'Imgur' },
    { id: 'gdrive', icon: 'add_to_drive', label: 'Google Drive' },
    { id: 'custom', icon: 'api', label: 'Custom Upload' },
    { id: 'hotkeys', icon: 'keyboard', label: 'Hotkeys' },
  ]

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-14 liquid-glass flex items-center justify-between px-6 flex-shrink-0 border-b border-white/5">
        <div>
          <h1 className="text-sm font-bold text-white leading-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>Settings</h1>
          <p className="text-[11px] text-slate-500 leading-tight">Configure uploads, paths and integrations</p>
        </div>
        {(isDirty || savedToast) && (
          <button
            onClick={handleSave}
            disabled={savedToast}
            className={`font-bold px-5 py-2 rounded-xl text-xs flex items-center gap-2 transition-all animate-slide-up ${
              savedToast
                ? 'bg-secondary/15 text-secondary border border-secondary/25'
                : 'primary-gradient text-slate-900 hover:scale-[1.02] active:scale-95'
            }`}
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            <span className="material-symbols-outlined text-sm">
              {savedToast ? 'check_circle' : 'save'}
            </span>
            {savedToast ? 'Saved!' : 'Save Changes'}
          </button>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left nav */}
        <nav className="w-48 flex-shrink-0 border-r border-white/5 p-3 space-y-0.5">
          {NAV_ITEMS.map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => {
                setActiveSection(id)
                document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                activeSection === id
                  ? 'active-nav-bg text-primary'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{icon}</span>
              <span className="text-xs font-semibold" style={{ fontFamily: 'Manrope, sans-serif' }}>{label}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <div
          className="flex-1 overflow-y-auto p-8 space-y-6"
          onScroll={(e) => {
            const container = e.currentTarget
            for (const { id } of NAV_ITEMS) {
              const el = document.getElementById(`settings-${id}`)
              if (el) {
                const rect = el.getBoundingClientRect()
                const containerRect = container.getBoundingClientRect()
                if (rect.top >= containerRect.top && rect.top < containerRect.top + containerRect.height / 2) {
                  setActiveSection(id)
                  break
                }
              }
            }
          }}
        >
          <div className="max-w-xl space-y-6">

            {/* General */}
            <Section id="general" title="General" icon="tune">
              {supportsStartup && (
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-slate-300 block" style={{ fontFamily: 'Manrope, sans-serif' }}>
                      Launch at Startup
                    </span>
                    <p className="text-[11px] text-slate-500">
                      {platform === 'darwin'
                        ? 'Start Lumia automatically when you log in, minimized to the menu bar.'
                        : 'Start Lumia automatically when Windows boots, minimized to the system tray.'}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.launchAtStartup}
                    onChange={e => handleLaunchAtStartupChange(e.target.checked)}
                    className="w-4 h-4 accent-primary cursor-pointer flex-shrink-0"
                  />
                </label>
              )}
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-slate-300 block" style={{ fontFamily: 'Manrope, sans-serif' }}>
                    Delete history after
                  </span>
                  <p className="text-[11px] text-slate-500">
                    Automatically remove captures older than the selected period. Keep forever by default.
                  </p>
                </div>
                <select
                  value={settings.historyRetentionDays}
                  onChange={e => handleHistoryRetentionChange(Number(e.target.value))}
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-primary/30 cursor-pointer flex-shrink-0"
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  {RETENTION_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </Section>

            {/* Appearance */}
            <Section id="appearance" title="Appearance" icon="palette">
              <Field
                label="Theme"
                description="Choose how Lumia looks. System will automatically match your OS preference."
              >
                <div className="flex gap-2">
                  {([
                    { value: 'light' as const, icon: 'light_mode', label: 'Light' },
                    { value: 'dark' as const, icon: 'dark_mode', label: 'Dark' },
                    { value: 'system' as const, icon: 'contrast', label: 'System' },
                  ]).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => handleThemeChange(opt.value)}
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                        settings.theme === opt.value
                          ? 'bg-primary/15 text-primary border border-primary/30'
                          : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 hover:text-white'
                      }`}
                      style={{ fontFamily: 'Manrope, sans-serif' }}
                    >
                      <span className="material-symbols-outlined text-sm">{opt.icon}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </Field>
            </Section>

            {/* Imgur */}
            <Section id="imgur" title="Imgur Upload" icon="image">
              <Field
                label="Client ID"
                description="Your Imgur app Client ID. Leave blank to use the built-in anonymous key (rate-limited)."
              >
                <input
                  value={settings.imgurClientId}
                  onChange={e => update('imgurClientId', e.target.value)}
                  placeholder="e.g. f0ea04148a54268"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-primary/30 transition-colors"
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

            {/* Google Drive */}
            <Section id="gdrive" title="Google Drive" icon="add_to_drive">
              {gdriveConnected ? (
                <div className="flex items-center justify-between p-3 bg-secondary/10 border border-secondary/20 rounded-xl">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-secondary text-lg">check_circle</span>
                    <span className="text-xs font-semibold text-secondary" style={{ fontFamily: 'Manrope, sans-serif' }}>Connected</span>
                  </div>
                  <button
                    onClick={handleGdriveDisconnect}
                    className="px-3 py-1.5 text-[11px] font-semibold text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg transition-all"
                    style={{ fontFamily: 'Manrope, sans-serif' }}
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    onClick={handleGdriveAuth}
                    disabled={gdriveConnecting}
                    className="flex items-center gap-2 px-4 py-2.5 primary-gradient text-slate-900 font-bold rounded-xl text-xs hover:scale-[1.02] active:scale-95 transition-transform disabled:opacity-50 disabled:scale-100"
                    style={{ fontFamily: 'Manrope, sans-serif' }}
                  >
                    <span className="material-symbols-outlined text-sm">
                      {gdriveConnecting ? 'hourglass_empty' : 'add_to_drive'}
                    </span>
                    {gdriveConnecting ? 'Waiting for authorization…' : 'Connect Google Drive'}
                  </button>
                  {gdriveError && (
                    <p className="text-[11px] text-red-400 flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">error</span>
                      {gdriveError}
                    </p>
                  )}
                </div>
              )}
              <Field
                label="Folder ID (optional)"
                description="Upload to a specific Drive folder. Leave blank for root."
              >
                <input
                  value={settings.googleDriveFolderId}
                  onChange={e => update('googleDriveFolderId', e.target.value)}
                  placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2wtTs"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-primary/30 transition-colors"
                />
              </Field>
            </Section>

            {/* Custom Upload */}
            <Section id="custom" title="Custom HTTP Upload" icon="api">
              <Field
                label="Endpoint URL"
                description="POST endpoint that receives the image file. Leave blank to disable."
              >
                <input
                  value={settings.customUploadUrl}
                  onChange={e => update('customUploadUrl', e.target.value)}
                  placeholder="https://your-server.com/upload"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-primary/30 transition-colors"
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
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-primary/30 transition-colors"
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
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-primary/30 transition-colors"
                />
              </Field>
            </Section>

            {/* Hotkeys */}
            <Section id="hotkeys" title="Keyboard Shortcuts" icon="keyboard">
              <div className="space-y-1">
                {HOTKEY_REFERENCE.map(({ action, key }) => (
                  <div key={action} className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
                    <span className="text-xs font-medium text-slate-300" style={{ fontFamily: 'Manrope, sans-serif' }}>{action}</span>
                    <kbd className="px-2.5 py-1 bg-white/5 border border-white/10 rounded-lg text-[11px] font-mono text-slate-400">{key}</kbd>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-3">Hotkey rebinding coming in a future release.</p>
            </Section>

          </div>
        </div>
      </div>
    </div>
  )
}

const HOTKEY_REFERENCE = [
  { action: 'Region Screenshot',   key: 'Ctrl+Shift+1' },
  { action: 'Active Window',       key: 'Ctrl+Shift+2' },
  { action: 'Screen',              key: 'Ctrl+Shift+3' },
  { action: 'All Screens',         key: 'Ctrl+Shift+4' },
  { action: 'Scrolling Capture',   key: 'Ctrl+Shift+5' },
  { action: 'Screen Recorder',     key: 'Ctrl+Shift+R' },
  { action: 'GIF Recorder',        key: 'Ctrl+Shift+G' },
  { action: 'Stop Recording',      key: 'Ctrl+Shift+S' },
  { action: 'Open Main Window',    key: 'Ctrl+Shift+X' },
]

function Section({ id, title, icon, children }: { id: string; title: string; icon: string; children: React.ReactNode }) {
  return (
    <div id={`settings-${id}`} className="card-organic p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
          <span className="material-symbols-outlined text-primary text-lg">{icon}</span>
        </div>
        <h3
          className="text-xs font-bold text-white uppercase tracking-[0.12em]"
          style={{ fontFamily: 'Manrope, sans-serif' }}
        >
          {title}
        </h3>
      </div>
      {children}
    </div>
  )
}

function Field({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-300" style={{ fontFamily: 'Manrope, sans-serif' }}>{label}</label>
      {children}
      <p className="text-[11px] text-slate-500">{description}</p>
    </div>
  )
}
