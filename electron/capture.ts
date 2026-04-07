import { desktopCapturer, ipcMain, screen, Notification, nativeImage, clipboard } from 'electron'
import { getMainWindow, createOverlayWindow, getOverlayWindow, getHistoryStore } from './index'

export type CaptureMode = 'fullscreen' | 'region' | 'window' | 'active-monitor'

const HIDE_DELAY_MS = 200 // wait for window to fully disappear before capturing

function hideMainWindow(): Promise<void> {
  return new Promise(resolve => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) { resolve(); return }
    win.hide()
    // Give the OS time to actually remove the window from screen
    setTimeout(resolve, HIDE_DELAY_MS)
  })
}

function showMainWindow() {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  win.show()
  win.focus()
}

export function setupCapture() {
  ipcMain.handle('capture:screenshot', async (_e, mode: CaptureMode) => {
    switch (mode) {
      case 'fullscreen': return captureFullscreen()
      case 'region':     return captureRegion()
      case 'window':     return captureWindow()
      case 'active-monitor': return captureActiveMonitor()
    }
  })

  // Overlay sends confirmed rect back to main process
  ipcMain.handle('region:confirm', async (_e, rect: { x: number; y: number; width: number; height: number }) => {
    getOverlayWindow()?.close()
    return captureRect(rect)
  })

  ipcMain.handle('region:cancel', () => {
    getOverlayWindow()?.close()
    showMainWindow()
  })
}

async function captureFullscreen(): Promise<string> {
  await hideMainWindow()

  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.size
  const scaleFactor = primaryDisplay.scaleFactor

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: width * scaleFactor, height: height * scaleFactor }
  })

  const source = sources.find(s => s.name === 'Entire Screen' || s.name === 'Screen 1') ?? sources[0]
  const dataUrl = source.thumbnail.toDataURL()

  await sendCaptureToEditor(dataUrl, 'fullscreen')
  return dataUrl
}

async function captureWindow(): Promise<void> {
  await hideMainWindow()

  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 1920, height: 1080 }
  })

  // Filter out the ShareAnywhere window and empty thumbnails
  const filtered = sources.filter(s =>
    !s.name.includes('ShareAnywhere') &&
    !s.thumbnail.isEmpty()
  )
  const source = filtered[0] ?? sources[0]

  if (source) {
    await sendCaptureToEditor(source.thumbnail.toDataURL(), 'window')
  } else {
    showMainWindow()
  }
}

async function captureRegion(): Promise<void> {
  await hideMainWindow()
  createOverlayWindow()
  // Capture happens after overlay fires region:confirm
}

async function captureRect(rect: { x: number; y: number; width: number; height: number }): Promise<string> {
  const primaryDisplay = screen.getPrimaryDisplay()
  const scaleFactor = primaryDisplay.scaleFactor
  const { width, height } = primaryDisplay.size

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: width * scaleFactor, height: height * scaleFactor }
  })

  const full = sources[0].thumbnail
  const cropped = full.crop({
    x: Math.round(rect.x * scaleFactor),
    y: Math.round(rect.y * scaleFactor),
    width: Math.round(rect.width * scaleFactor),
    height: Math.round(rect.height * scaleFactor)
  })

  const dataUrl = cropped.toDataURL()
  await sendCaptureToEditor(dataUrl, 'region')
  return dataUrl
}


async function captureActiveMonitor(): Promise<string> {
  await hideMainWindow()

  // Detect which display contains the mouse cursor
  const cursorPoint = screen.getCursorScreenPoint()
  const activeDisplay = screen.getDisplayNearestPoint(cursorPoint)
  const { width, height } = activeDisplay.size
  const scaleFactor = activeDisplay.scaleFactor
  const { x, y } = activeDisplay.bounds

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: width * scaleFactor, height: height * scaleFactor }
  })

  // Match the source to the active display by comparing bounds
  // desktopCapturer returns sources ordered by display, pick the matching one
  let source = sources[0]
  if (sources.length > 1) {
    const allDisplays = screen.getAllDisplays()
    const idx = allDisplays.findIndex(d => d.id === activeDisplay.id)
    if (idx >= 0 && idx < sources.length) source = sources[idx]
  }

  const dataUrl = source.thumbnail.toDataURL()
  await sendCaptureToEditor(dataUrl, 'active-monitor')
  return dataUrl
}
export async function sendCaptureToEditor(dataUrl: string, source: string) {
  const mainWin = getMainWindow()
  if (!mainWin || mainWin.isDestroyed()) return

  // Auto-copy capture to clipboard immediately
  try {
    const img = nativeImage.createFromDataURL(dataUrl)
    clipboard.writeImage(img)
  } catch { /* silent */ }

  // Add capture to history immediately (before annotation)
  try {
    const historyStore = getHistoryStore()
    if (historyStore) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      historyStore.add({
        id: require('crypto').randomUUID(),
        timestamp: Date.now(),
        name: `capture-${ts}`,
        dataUrl,
        type: 'screenshot',
        uploads: []
      })
    }
  } catch { /* silent */ }

  mainWin.webContents.send('navigate', '/editor', { dataUrl, source })
  showMainWindow()

  const label = source === 'region' ? 'Region' : source === 'window' ? 'Window' : source === 'active-monitor' ? 'Active Monitor' : 'Fullscreen'
  new Notification({ title: 'ShareAnywhere', body: `${label} captured — copied to clipboard` }).show()
}
