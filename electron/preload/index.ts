import { contextBridge, ipcRenderer } from 'electron'

export type CaptureMode = 'fullscreen' | 'region' | 'window' | 'active-monitor'
export type RecordMode = 'fullscreen' | 'window' | 'region'

contextBridge.exposeInMainWorld('electronAPI', {
  // Capture
  captureScreenshot: (mode: CaptureMode) =>
    ipcRenderer.invoke('capture:screenshot', mode),

  // Recording
  getRecordingSources: () => ipcRenderer.invoke('record:getSources'),
  saveRecording: (buffer: ArrayBuffer, filename: string) =>
    ipcRenderer.invoke('record:save', buffer, filename),
  hideForRecording: () => ipcRenderer.invoke('record:hide'),
  showAfterRecording: () => ipcRenderer.invoke('record:show'),

  // Workflow
  runWorkflow: (templateId: string, imageData: string, destinationIndex?: number) =>
    ipcRenderer.invoke('workflow:run', templateId, imageData, destinationIndex),
  runInlineAction: (actionType: 'clipboard' | 'save', imageData: string) =>
    ipcRenderer.invoke('workflow:inlineAction', actionType, imageData),
  getTemplates: () => ipcRenderer.invoke('workflow:getTemplates'),
  saveTemplate: (template: unknown) => ipcRenderer.invoke('workflow:saveTemplate', template),
  deleteTemplate: (id: string) => ipcRenderer.invoke('workflow:deleteTemplate', id),

  // History
  getHistory: () => ipcRenderer.invoke('history:get'),
  deleteHistoryItem: (id: string) => ipcRenderer.invoke('history:delete', id),
  openHistoryFile: (filePath: string) => ipcRenderer.invoke('history:openFile', filePath),
  addHistoryItem: (item: unknown) => ipcRenderer.invoke('history:addCapture', item),

  // Hotkeys
  getHotkeys: () => ipcRenderer.invoke('hotkeys:get'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),

  // Google Drive
  gdriveStartAuth: () => ipcRenderer.invoke('gdrive:startAuth'),
  gdriveDisconnect: () => ipcRenderer.invoke('gdrive:disconnect'),
  onGdriveConnected: (cb: () => void) => ipcRenderer.on('gdrive:connected', cb),

  // Save file
  saveFile: (dataUrl: string, filePath: string) => ipcRenderer.invoke('capture:saveFile', dataUrl, filePath),

  // Read local file as ArrayBuffer (for video blob URL playback)
  readLocalFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),

  // App actions (for renderer custom menu)
  quitApp: () => ipcRenderer.invoke('app:quit'),
  toggleDevTools: () => ipcRenderer.invoke('devtools:toggle'),
  reloadWindow: () => ipcRenderer.invoke('window:reload'),
  forceReloadWindow: () => ipcRenderer.invoke('window:force-reload'),

  // Update native titlebar overlay colors on theme change (Windows)
  setTitleBarTheme: (theme: 'dark' | 'light') => ipcRenderer.invoke('titlebar:setTheme', theme),

  // Navigation (tell main which view to show in the same window)
  navigate: (route: string) => ipcRenderer.invoke('navigate', route),

  // Events from main → renderer
  onCaptureReady: (cb: (data: { dataUrl: string; source: string }) => void) => {
    ipcRenderer.on('capture:ready', (_e, data) => cb(data))
  },
  onNavigate: (cb: (route: string, state?: Record<string, unknown>) => void) => {
    ipcRenderer.on('navigate', (_e, route, state) => cb(route, state))
  },
  onRegionSelected: (cb: (rect: { x: number; y: number; width: number; height: number }) => void) => {
    ipcRenderer.on('region:selected', (_e, rect) => cb(rect))
  },
  onRecorderOpen: (cb: () => void) => { ipcRenderer.on('recorder:open', cb) },
  onRecorderOpenGif: (cb: () => void) => { ipcRenderer.on('recorder:open-gif', cb) },
  onRecorderStop: (cb: () => void) => { ipcRenderer.on('recorder:stop', cb) },
  onUpdateDownloaded: (cb: (version: string) => void) => { ipcRenderer.on('update:downloaded', (_e, version: string) => cb(version)) },
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onAbout: (cb: () => void) => { ipcRenderer.on('app:about', () => cb()) },
  getAppVersion: () => ipcRenderer.invoke('app:version'),

  // Scrolling capture
  startScrollCapture: (opts: unknown) =>
    ipcRenderer.invoke('scroll-capture:start', opts),
  cancelScrollCapture: () =>
    ipcRenderer.invoke('scroll-capture:cancel'),
  onScrollCaptureProgress: (cb: (data: { frame: number; maxFrames: number }) => void) =>
    ipcRenderer.on('scroll-capture:progress', (_e, data) => cb(data)),
  onScrollCaptureResult: (cb: (data: { dataUrl: string }) => void) =>
    ipcRenderer.on('scroll-capture:result', (_e, data) => cb(data)),
  onScrollCaptureOpen: (cb: () => void) =>
    ipcRenderer.on('scroll-capture:open', cb),
  onScrollCaptureError: (cb: (data: { error: string }) => void) =>
    ipcRenderer.on('scroll-capture:error', (_e, data) => cb(data)),
  confirmScrollRegion: (rect: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('scroll-region:confirm', rect),
  cancelScrollRegion: () =>
    ipcRenderer.invoke('scroll-region:cancel'),
  getOverlayMode: () =>
    ipcRenderer.invoke('overlay:get-mode'),

  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel),

  // Overlay-specific
  confirmRegion: (rect: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('region:confirm', rect),
  cancelRegion: () => ipcRenderer.invoke('region:cancel'),
  onOverlaySetActive: (cb: (active: boolean) => void) => {
    ipcRenderer.on('overlay:set-active', (_e, active) => cb(active))
  },
  overlayDrawing: (drawing: boolean) => ipcRenderer.send('overlay:drawing', drawing),

  // OCR & Auto-Blur
  ocrScan: (dataUrl: string) =>
    ipcRenderer.invoke('ocr:scan', dataUrl),
  ocrApplyBlur: (dataUrl: string, regions: unknown[], blockSize?: number) =>
    ipcRenderer.invoke('ocr:apply-blur', dataUrl, regions, blockSize),

  // Shell
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
  showSaveDialog: (opts: unknown) => ipcRenderer.invoke('dialog:save', opts),
  showOpenDialog: (opts: unknown) => ipcRenderer.invoke('dialog:open', opts),

  // App info
  platform: process.platform
})
