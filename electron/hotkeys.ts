import { globalShortcut, app } from 'electron'
import Store from 'electron-store'
import { dispatchCapture } from './capture'
import { createOverlayWindows, getMainWindow, getOverlayWindow, markQuitting } from './index'
import { startVideoCapture, requestStop as requestVideoStop, isRecordingActive } from './video'

export interface HotkeyConfig {
  [action: string]: string
}

export const defaultHotkeys: HotkeyConfig = {
  RectangleRegion:      'Ctrl+Shift+1',
  ActiveWindow:         'Ctrl+Shift+2',
  ActiveMonitor:        'Ctrl+Shift+3',
  PrintScreen:          'Ctrl+Shift+4',
  ScrollingCapture:     'Ctrl+Shift+5',
  // `ScreenRecorder` kept as the "Region" video entry for backwards compat
  // with saved configs from older releases.
  ScreenRecorder:       'Ctrl+Shift+6',
  ScreenRecorderWindow: 'Ctrl+Shift+7',
  ScreenRecorderScreen: 'Ctrl+Shift+8'
}

// All 75 action types from ShareX, user can assign any
export const ALL_ACTIONS = [
  // Upload
  'FileUpload', 'FolderUpload', 'ClipboardUpload', 'ClipboardUploadWithContentViewer',
  'UploadText', 'UploadURL', 'DragDropUpload', 'ShortenURL', 'StopUploads',
  // Screen Capture
  'PrintScreen', 'ActiveWindow', 'CustomWindow', 'ActiveMonitor',
  'RectangleRegion', 'RectangleLight', 'RectangleTransparent',
  'CustomRegion', 'LastRegion', 'ScrollingCapture', 'AutoCapture',
  'StartAutoCapture', 'StopAutoCapture',
  // Screen Record
  'ScreenRecorder', 'ScreenRecorderActiveWindow', 'ScreenRecorderCustomRegion',
  'StartScreenRecorder', 'ScreenRecorderGIF', 'ScreenRecorderGIFActiveWindow',
  'ScreenRecorderGIFCustomRegion', 'StartScreenRecorderGIF',
  'StopScreenRecording', 'PauseScreenRecording', 'AbortScreenRecording',
  // Tools
  'ColorPicker', 'ScreenColorPicker', 'Ruler', 'PinToScreen',
  'PinToScreenFromScreen', 'PinToScreenFromClipboard', 'PinToScreenFromFile',
  'PinToScreenCloseAll', 'ImageEditor', 'ImageBeautifier', 'ImageEffects',
  'ImageViewer', 'ImageCombiner', 'ImageSplitter', 'ImageThumbnailer',
  'VideoConverter', 'VideoThumbnailer', 'AnalyzeImage', 'OCR',
  'QRCode', 'QRCodeDecodeFromScreen', 'QRCodeScanRegion',
  'HashCheck', 'Metadata', 'StripMetadata', 'IndexFolder',
  'ClipboardViewer', 'BorderlessWindow', 'ActiveWindowBorderless',
  'ActiveWindowTopMost', 'InspectWindow', 'MonitorTest',
  // App
  'DisableHotkeys', 'OpenScreenshotsFolder',
  'OpenHistory', 'OpenImageHistory', 'ToggleActionsToolbar',
  'ToggleTrayMenu', 'ExitLumia'
]

// Bump this whenever the default capture-mode bindings change in a way that
// should retake control from users who never hand-customized. On load, if the
// stored version is stale we rewrite the capture/recorder bindings to the new
// defaults while leaving app-level hotkeys alone (those have stable defaults).
const HOTKEY_SCHEMA_VERSION = 6
const CAPTURE_ACTIONS = [
  'RectangleRegion', 'ActiveWindow', 'ActiveMonitor', 'PrintScreen', 'ScrollingCapture',
  'ScreenRecorder', 'ScreenRecorderWindow', 'ScreenRecorderScreen',
] as const
// Actions that were removed (or renamed) in a migration — stripped from the
// saved config so stale bindings don't linger and accidentally block new keys
// (e.g. S was `StopScreenRecording` and is now `ScreenRecorderScreen`).
// `ExitShareAnywhere` was renamed to `ExitLumia` after the rebrand.
const REMOVED_ACTIONS = ['StopScreenRecording', 'OpenMainWindow', 'WorkflowPicker', 'ExitShareAnywhere'] as const

const store = new Store<{ hotkeys: HotkeyConfig; schemaVersion?: number }>({
  name: 'hotkeys',
  defaults: { hotkeys: defaultHotkeys }
})

export function getHotkeys(): HotkeyConfig {
  // `has` reads the on-disk file directly, bypassing the `defaults` merge — so
  // a missing key genuinely means "this install predates the schema bump".
  const storedVersion = store.has('schemaVersion') ? store.get('schemaVersion') ?? 1 : 1
  const saved = store.get('hotkeys')
  if (storedVersion < HOTKEY_SCHEMA_VERSION) {
    // Migrate: overwrite the capture/recorder bindings with the new defaults,
    // drop actions that no longer exist, keep any app-level customizations.
    const migrated: HotkeyConfig = { ...saved }
    for (const action of REMOVED_ACTIONS) delete migrated[action]
    for (const action of CAPTURE_ACTIONS) migrated[action] = defaultHotkeys[action]
    store.set('hotkeys', migrated)
    store.set('schemaVersion', HOTKEY_SCHEMA_VERSION)
    return { ...defaultHotkeys, ...migrated }
  }
  // Merge defaults for any new actions not yet in the user's saved config
  return { ...defaultHotkeys, ...saved }
}

export function saveHotkeys(hotkeys: HotkeyConfig) {
  store.set('hotkeys', hotkeys)
  teardownHotkeys()
  setupHotkeys()
}

export function resetHotkeys(): HotkeyConfig {
  store.set('hotkeys', { ...defaultHotkeys })
  store.set('schemaVersion', HOTKEY_SCHEMA_VERSION)
  teardownHotkeys()
  setupHotkeys()
  return { ...defaultHotkeys }
}

export function setupHotkeys() {
  const hotkeys = getHotkeys()

  let isCapturing = false

  // Route capture hotkeys through the same `dispatchCapture` the Dashboard
  // buttons invoke, so the behavior (overlay pickers, multi-display
  // compositing, etc.) stays consistent across entry points. The lock guards
  // against re-entrancy when the user mashes the hotkey or clicks during a
  // running capture.
  const withLock = (fn: () => Promise<void>) => async () => {
    if (isCapturing) return
    if (getOverlayWindow()) return
    isCapturing = true
    try { await fn() } finally { isCapturing = false }
  }

  const handlers: Record<string, () => void> = {
    RectangleRegion: withLock(async () => { await dispatchCapture('region') }),
    PrintScreen:     withLock(async () => { await dispatchCapture('fullscreen') }),
    ActiveWindow:    withLock(async () => { await dispatchCapture('window') }),
    ActiveMonitor:   withLock(async () => { await dispatchCapture('active-monitor') }),
    ScrollingCapture: withLock(async () => {
      const main = getMainWindow()
      if (main && !main.isDestroyed()) main.hide()
      await new Promise(r => setTimeout(r, 200))
      const { setOverlayMode } = await import('./scroll-capture')
      setOverlayMode('scroll-region')
      createOverlayWindows()
    }),
    // All three video hotkeys toggle: pressing any of them while recording
    // stops (matches Snipping Tool's UX), otherwise starts in that mode.
    ScreenRecorder:       () => { if (isRecordingActive()) requestVideoStop(); else startVideoCapture('region') },
    ScreenRecorderWindow: () => { if (isRecordingActive()) requestVideoStop(); else startVideoCapture('window') },
    ScreenRecorderScreen: () => { if (isRecordingActive()) requestVideoStop(); else startVideoCapture('screen') },
    ExitLumia: () => { markQuitting(); app.quit() }
  }

  for (const [action, shortcut] of Object.entries(hotkeys)) {
    if (!shortcut) continue
    const handler = handlers[action]
    if (!handler) continue
    try {
      globalShortcut.register(shortcut, handler)
    } catch {
      console.warn(`Failed to register hotkey ${shortcut} for ${action}`)
    }
  }
}

export function teardownHotkeys() {
  globalShortcut.unregisterAll()
}
