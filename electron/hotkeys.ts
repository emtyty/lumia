import { globalShortcut, app } from 'electron'
import Store from 'electron-store'
import { sendCaptureToEditor } from './capture'
import { createOverlayWindow } from './index'
import { getMainWindow } from './index'

interface HotkeyConfig {
  [action: string]: string
}

const defaultHotkeys: HotkeyConfig = {
  RectangleRegion:   'Ctrl+Shift+4',
  PrintScreen:       'Ctrl+Shift+3',
  ActiveWindow:      'Ctrl+Shift+2',
  ActiveMonitor:     'Ctrl+Shift+1',
  ScreenRecorder:    'Ctrl+Shift+R',
  ScreenRecorderGIF: 'Ctrl+Shift+G',
  StopScreenRecording: 'Ctrl+Shift+S',
  OpenMainWindow:    'Ctrl+Shift+X',
  WorkflowPicker:    'Ctrl+Shift+Q'
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
  'DisableHotkeys', 'OpenMainWindow', 'OpenScreenshotsFolder',
  'OpenHistory', 'OpenImageHistory', 'ToggleActionsToolbar',
  'ToggleTrayMenu', 'ExitShareAnywhere', 'WorkflowPicker'
]

const store = new Store<{ hotkeys: HotkeyConfig }>({
  name: 'hotkeys',
  defaults: { hotkeys: defaultHotkeys }
})

export function getHotkeys(): HotkeyConfig {
  return store.get('hotkeys')
}

export function saveHotkeys(hotkeys: HotkeyConfig) {
  store.set('hotkeys', hotkeys)
  teardownHotkeys()
  setupHotkeys()
}

export function setupHotkeys() {
  const hotkeys = getHotkeys()

  const hideMain = (): Promise<void> => new Promise(resolve => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) { resolve(); return }
    win.hide()
    setTimeout(resolve, 200)
  })

  const handlers: Record<string, () => void> = {
    RectangleRegion: async () => {
      await hideMain()
      createOverlayWindow()
    },
    PrintScreen: async () => {
      await hideMain()
      const { desktopCapturer, screen } = await import('electron')
      const cursorPoint = screen.getCursorScreenPoint()
      const allDisplays = screen.getAllDisplays()
      const d = screen.getDisplayNearestPoint(cursorPoint)
      const sf = d.scaleFactor
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: d.size.width * sf, height: d.size.height * sf }
      })
      const idx = allDisplays.findIndex(disp => disp.id === d.id)
      const source = (idx >= 0 && idx < sources.length) ? sources[idx] : sources[0]
      sendCaptureToEditor(source.thumbnail.toDataURL(), 'fullscreen')
    },
    ActiveWindow: async () => {
      await hideMain()
      const { desktopCapturer } = await import('electron')
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1920, height: 1080 }
      })
      const filtered = sources.filter(s =>
        !s.name.includes('ShareAnywhere') && !s.thumbnail.isEmpty()
      )
      if (filtered[0]) sendCaptureToEditor(filtered[0].thumbnail.toDataURL(), 'window')
    },
    ActiveMonitor: async () => {
      await hideMain()
      const { desktopCapturer, screen } = await import('electron')
      const cursorPoint = screen.getCursorScreenPoint()
      const allDisplays = screen.getAllDisplays()
      const activeDisplay = screen.getDisplayNearestPoint(cursorPoint)
      const { width, height } = activeDisplay.size
      const sf = activeDisplay.scaleFactor

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: width * sf, height: height * sf }
      })

      const idx = allDisplays.findIndex(d => d.id === activeDisplay.id)
      const source = (sources.length > 1 && idx >= 0 && idx < sources.length) ? sources[idx] : sources[0]
      if (source) sendCaptureToEditor(source.thumbnail.toDataURL(), 'active-monitor')
    },
    ScreenRecorder: () => {
      const win = getMainWindow()
      win?.show()
      win?.focus()
      win?.webContents.send('recorder:open')
    },
    ScreenRecorderGIF: () => {
      const win = getMainWindow()
      win?.show()
      win?.focus()
      win?.webContents.send('recorder:open-gif')
    },
    StopScreenRecording: () => {
      getMainWindow()?.webContents.send('recorder:stop')
    },
    OpenMainWindow: () => {
      const win = getMainWindow()
      win?.show()
      win?.focus()
    },
    ExitShareAnywhere: () => app.quit()
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
