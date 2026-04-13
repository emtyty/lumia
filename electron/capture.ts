import { desktopCapturer, ipcMain, screen, Notification, nativeImage, clipboard } from 'electron'
import { getMainWindow, createOverlayWindow, getOverlayWindow, getHistoryStore, getOverlayDisplayId } from './index'

export type CaptureMode = 'fullscreen' | 'region' | 'window' | 'active-monitor'

// macOS needs slightly more time due to window animation; Windows is faster
const HIDE_DELAY_MS = process.platform === 'darwin' ? 250 : 200

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

/**
 * Match a desktopCapturer source to a specific display.
 * Use source.display_id (available since Electron 22) for reliable matching,
 * with index-based fallback for edge cases.
 */
function findSourceForDisplay(
  sources: Electron.DesktopCapturerSource[],
  allDisplays: Electron.Display[],
  displayId: number
): Electron.DesktopCapturerSource {
  if (sources.length === 1) return sources[0]
  // Primary: match by display_id (string) to Display.id (number)
  const byId = sources.find(s => s.display_id === String(displayId))
  if (byId) return byId
  // Fallback: index-based matching (assumes same ordering — not always true)
  const idx = allDisplays.findIndex(d => d.id === displayId)
  if (idx >= 0 && idx < sources.length) return sources[idx]
  return sources[0]
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

  // Capture the display containing the cursor so multi-monitor users get the expected screen
  const cursorPoint = screen.getCursorScreenPoint()
  const allDisplays = screen.getAllDisplays()
  const targetDisplay = screen.getDisplayNearestPoint(cursorPoint)
  const { width, height } = targetDisplay.size
  const scaleFactor = targetDisplay.scaleFactor

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: width * scaleFactor, height: height * scaleFactor }
  })

  const source = findSourceForDisplay(sources, allDisplays, targetDisplay.id)
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
  // Use the display that the overlay was shown on — not always the primary display
  const allDisplays = screen.getAllDisplays()
  const overlayId = getOverlayDisplayId()
  const targetDisplay = allDisplays.find(d => d.id === overlayId) ?? screen.getPrimaryDisplay()
  const { width, height } = targetDisplay.size
  const scaleFactor = targetDisplay.scaleFactor

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: width * scaleFactor, height: height * scaleFactor }
  })

  // rect coords are clientX/clientY from the overlay window, which is positioned
  // at the display's origin — so they are already display-local, no offset needed
  const full = findSourceForDisplay(sources, allDisplays, targetDisplay.id).thumbnail
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

  const cursorPoint = screen.getCursorScreenPoint()
  const allDisplays = screen.getAllDisplays()
  const activeDisplay = screen.getDisplayNearestPoint(cursorPoint)
  const { width, height } = activeDisplay.size
  const scaleFactor = activeDisplay.scaleFactor

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: width * scaleFactor, height: height * scaleFactor }
  })

  const source = findSourceForDisplay(sources, allDisplays, activeDisplay.id)
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
