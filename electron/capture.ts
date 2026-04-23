import { desktopCapturer, ipcMain, screen, Notification, nativeImage, clipboard } from 'electron'
import { getMainWindow, createOverlayWindows, closeAllOverlays, getHistoryStore, getOverlayDisplayId, broadcastToOverlays } from './index'
import { getWindowAtPointPhysical } from './native-input'
import { setOverlayMode } from './scroll-capture'
import { localTimestamp } from './utils'

export type CaptureMode = 'fullscreen' | 'region' | 'window' | 'active-monitor'

const HIDE_DELAY_MS = process.platform === 'darwin' ? 250 : 200
const OVERLAY_GONE_DELAY_MS = 120

function waitForOverlayGone(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, OVERLAY_GONE_DELAY_MS))
}

function hideMainWindow(): Promise<void> {
  return new Promise(resolve => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) { resolve(); return }
    win.hide()
    setTimeout(resolve, HIDE_DELAY_MS)
  })
}

function showMainWindow() {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  win.show()
  win.focus()
}

function findSourceForDisplay(
  sources: Electron.DesktopCapturerSource[],
  allDisplays: Electron.Display[],
  displayId: number
): Electron.DesktopCapturerSource {
  if (sources.length === 1) return sources[0]
  const byId = sources.find(s => s.display_id === String(displayId))
  if (byId) return byId
  const idx = allDisplays.findIndex(d => d.id === displayId)
  if (idx >= 0 && idx < sources.length) return sources[idx]
  return sources[0]
}

// Map webContentsId → source payload for overlay pull
const overlaySourcePayloads = new Map<number, { sourceId: string; scaleFactor: number }>()

export function dispatchCapture(mode: CaptureMode) {
  switch (mode) {
    case 'fullscreen':      return captureFullscreen()
    case 'region':          return captureRegion()
    case 'window':          return captureWindow()
    case 'active-monitor':  return captureActiveMonitor()
  }
}

export function setupCapture() {
  ipcMain.handle('capture:screenshot', async (_e, mode: CaptureMode) => dispatchCapture(mode))

  ipcMain.handle('region:confirm', async (_e, payload: { dataUrl: string; rect: { x: number; y: number; width: number; height: number } }) => {
    const displayId = getOverlayDisplayId()
    const { resetOverlayMode } = await import('./scroll-capture')
    resetOverlayMode()
    closeAllOverlays()
    await waitForOverlayGone()
    const dataUrl = await captureRect(payload.rect, displayId)
    await sendCaptureToEditor(dataUrl, 'region')
    return dataUrl
  })

  ipcMain.handle('overlay:get-source', (e) => {
    return overlaySourcePayloads.get(e.sender.id) ?? null
  })

  // Window-pick mode: return window rect at screen coords
  ipcMain.handle('window-pick:get-window-at', (_e, x: number, y: number) => {
    try {
      const displayId = getOverlayDisplayId()
      const allDisplays = screen.getAllDisplays()
      const display = allDisplays.find(d => d.id === displayId) ?? screen.getPrimaryDisplay()

      // Overlay's (x,y) is in its local DIP coords. Convert to virtual-screen DIP.
      const dipX = x + display.bounds.x
      const dipY = y + display.bounds.y
      const sfCursor = display.scaleFactor || 1

      // Call Win32 at the DIP point (process is PMv2-aware; on a per-monitor-aware
      // thread, Win32 point APIs accept physical px, but Electron's main thread is
      // effectively system-aware from the FFI side — empirically the DIP point works
      // across all displays here).
      const raw = getWindowAtPointPhysical(Math.round(dipX), Math.round(dipY))
      if (!raw) return null

      // In a per-monitor-v2 DPI-aware process (Electron's default), Win32 returns
      // rects in physical pixels. On a 1x display that's indistinguishable from DIP,
      // but on a scaled display we must divide by the display's scale factor.
      const isPhysical = sfCursor !== 1

      const winDisplay = display
      const sfWin = sfCursor
      let dipRect: { x: number; y: number; width: number; height: number }
      if (isPhysical) {
        // raw is physical px. Compute each display's physical origin in virtual-
        // screen space by cumulatively summing physical widths along each axis,
        // ordered by DIP position. With per-monitor-v2, Windows packs physical
        // pixels contiguously in virtual-screen coords.
        const byX = [...allDisplays].sort((a, b) => a.bounds.x - b.bounds.x)
        const byY = [...allDisplays].sort((a, b) => a.bounds.y - b.bounds.y)
        const phOriginX = new Map<number, number>()
        const phOriginY = new Map<number, number>()
        // X axis: displays at x<0 go left of origin, x>=0 go right.
        let cursorX = 0
        for (const d of byX.filter(d => d.bounds.x >= 0)) {
          phOriginX.set(d.id, cursorX)
          cursorX += d.size.width * (d.scaleFactor || 1)
        }
        cursorX = 0
        for (const d of [...byX.filter(d => d.bounds.x < 0)].reverse()) {
          cursorX -= d.size.width * (d.scaleFactor || 1)
          phOriginX.set(d.id, cursorX)
        }
        let cursorY = 0
        for (const d of byY.filter(d => d.bounds.y >= 0)) {
          phOriginY.set(d.id, cursorY)
          cursorY += d.size.height * (d.scaleFactor || 1)
        }
        cursorY = 0
        for (const d of [...byY.filter(d => d.bounds.y < 0)].reverse()) {
          cursorY -= d.size.height * (d.scaleFactor || 1)
          phOriginY.set(d.id, cursorY)
        }

        const pox = phOriginX.get(winDisplay.id) ?? 0
        const poy = phOriginY.get(winDisplay.id) ?? 0
        dipRect = {
          x: winDisplay.bounds.x + (raw.x - pox) / sfWin,
          y: winDisplay.bounds.y + (raw.y - poy) / sfWin,
          width:  raw.width  / sfWin,
          height: raw.height / sfWin,
        }
      } else {
        dipRect = { x: raw.x, y: raw.y, width: raw.width, height: raw.height }
      }

      // Floor top-left and ceil bottom-right so sub-pixel results from /sfWin
      // don't shrink the rect inside the visible window border.
      const left   = Math.max(display.bounds.x, Math.floor(dipRect.x))
      const top    = Math.max(display.bounds.y, Math.floor(dipRect.y))
      const right  = Math.min(display.bounds.x + display.bounds.width,  Math.ceil(dipRect.x + dipRect.width))
      const bottom = Math.min(display.bounds.y + display.bounds.height, Math.ceil(dipRect.y + dipRect.height))
      if (right <= left || bottom <= top) return null
      return {
        x: left - display.bounds.x,
        y: top - display.bounds.y,
        width: right - left,
        height: bottom - top,
      }
    } catch (err: any) {
      console.error('[window-pick] error:', err?.message ?? err)
      return null
    }
  })

  // Window-pick confirm: capture the rect same as region
  ipcMain.handle('window-pick:confirm', async (_e, rect: { x: number; y: number; width: number; height: number }) => {
    const displayId = getOverlayDisplayId()
    const { resetOverlayMode } = await import('./scroll-capture')
    resetOverlayMode()
    closeAllOverlays()
    await waitForOverlayGone()
    const dataUrl = await captureRect(rect, displayId)
    await sendCaptureToEditor(dataUrl, 'window')
    return dataUrl
  })

  ipcMain.handle('window-pick:cancel', () => {
    import('./scroll-capture').then(m => m.resetOverlayMode())
    closeAllOverlays()
    showMainWindow()
  })

  ipcMain.handle('region:cancel', () => {
    import('./scroll-capture').then(m => m.resetOverlayMode())
    closeAllOverlays()
    showMainWindow()
  })

  // Switch between overlay capture modes without closing the overlay.
  ipcMain.handle('overlay:switch-mode', (_e, mode: 'region' | 'window-pick' | 'monitor-pick') => {
    setOverlayMode(mode)
    broadcastToOverlays('overlay:mode-changed', mode)
  })

  // Monitor-pick: user clicked an overlay → capture that display
  ipcMain.handle('monitor-pick:confirm', async () => {
    const displayId = getOverlayDisplayId()
    const allDisplays = screen.getAllDisplays()
    const target = allDisplays.find(d => d.id === displayId) ?? screen.getPrimaryDisplay()
    const { resetOverlayMode } = await import('./scroll-capture')
    resetOverlayMode()
    closeAllOverlays()
    await waitForOverlayGone()
    const dataUrl = await captureDisplay(target, allDisplays)
    await sendCaptureToEditor(dataUrl, 'active-monitor')
    return dataUrl
  })

  ipcMain.handle('monitor-pick:cancel', () => {
    import('./scroll-capture').then(m => m.resetOverlayMode())
    closeAllOverlays()
    showMainWindow()
  })
}

interface CompositeItem { bitmap: Buffer; srcW: number; srcH: number; dx: number; dy: number }

// Composite raw BGRA buffers directly in Node — no PNG encode/decode round-trip,
// no BrowserWindow. Memory copies only, then a single PNG encode at the end.
function compositeBGRA(items: CompositeItem[], totalW: number, totalH: number): string {
  const out = Buffer.alloc(totalW * totalH * 4)
  for (const it of items) {
    const { bitmap, srcW, srcH, dx, dy } = it
    const rowBytes = srcW * 4
    for (let row = 0; row < srcH; row++) {
      const destY = dy + row
      if (destY < 0 || destY >= totalH) continue
      const destOffset = (destY * totalW + dx) * 4
      const srcOffset  = row * rowBytes
      bitmap.copy(out, destOffset, srcOffset, srcOffset + rowBytes)
    }
  }
  return nativeImage.createFromBuffer(out, { width: totalW, height: totalH }).toDataURL()
}

async function captureFullscreen(): Promise<string> {
  const allDisplays = screen.getAllDisplays()
  await hideMainWindow()

  // Single-display fast path
  if (allDisplays.length <= 1) {
    const d = allDisplays[0] ?? screen.getPrimaryDisplay()
    const sf = d.scaleFactor || 1
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width:  Math.max(1, Math.round(d.size.width  * sf)),
        height: Math.max(1, Math.round(d.size.height * sf)),
      }
    })
    const dataUrl = findSourceForDisplay(sources, allDisplays, d.id).thumbnail.toDataURL()
    await sendCaptureToEditor(dataUrl, 'fullscreen')
    return dataUrl
  }

  // Keep each display at its native physical resolution. Position in physical-
  // pixel space using DIP neighbor relationships: a display's physical X origin
  // is the sum of the physical widths of displays whose DIP right edge is <= its
  // DIP left edge (same rule for Y). Handles side-by-side, stacked, and mixed
  // layouts without cumulating across independent rows/columns.
  const grabs = await Promise.all(allDisplays.map(async d => {
    const sf = d.scaleFactor || 1
    const physW = Math.max(1, Math.round(d.size.width  * sf))
    const physH = Math.max(1, Math.round(d.size.height * sf))
    const srcs = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: physW, height: physH }
    })
    return { display: d, thumb: findSourceForDisplay(srcs, allDisplays, d.id).thumbnail, physW, physH }
  }))

  const phBounds = new Map<number, { x: number; y: number; w: number; h: number }>()
  for (const { display: d, physW, physH } of grabs) {
    let px = 0, py = 0
    for (const { display: other, physW: ow, physH: oh } of grabs) {
      if (other.id === d.id) continue
      if (other.bounds.x + other.bounds.width  <= d.bounds.x) px += ow
      if (other.bounds.y + other.bounds.height <= d.bounds.y) py += oh
    }
    phBounds.set(d.id, { x: px, y: py, w: physW, h: physH })
  }

  const totalW = Math.max(...[...phBounds.values()].map(b => b.x + b.w))
  const totalH = Math.max(...[...phBounds.values()].map(b => b.y + b.h))

  const items: CompositeItem[] = []
  for (const { display: d, thumb } of grabs) {
    const pb = phBounds.get(d.id)!
    const ts = thumb.getSize()
    items.push({
      bitmap: thumb.toBitmap(),
      srcW: ts.width,
      srcH: ts.height,
      dx: pb.x,
      dy: pb.y,
    })
  }

  const dataUrl = compositeBGRA(items, totalW, totalH)
  await sendCaptureToEditor(dataUrl, 'fullscreen')
  return dataUrl
}

async function captureWindow(): Promise<void> {
  setOverlayMode('window-pick')
  await hideMainWindow()
  createOverlayWindows()
  // Capture happens after overlay fires window-pick:confirm
}

async function captureRegion(): Promise<void> {
  await hideMainWindow()
  createOverlayWindows()
}

async function captureRect(rect: { x: number; y: number; width: number; height: number }, displayId?: number | null): Promise<string> {
  const allDisplays = screen.getAllDisplays()
  const overlayId = displayId ?? getOverlayDisplayId()
  const targetDisplay = allDisplays.find(d => d.id === overlayId) ?? screen.getPrimaryDisplay()
  const scaleFactor = targetDisplay.scaleFactor || 1

  // Fast path: desktopCapturer thumbnail. getUserMedia was ~1-3s on Win; thumbnail
  // is near-instant. We derive actual scale from the returned image size so that
  // mixed-DPI multi-monitor setups still crop correctly.
  const physW = Math.max(1, Math.round(targetDisplay.size.width * scaleFactor))
  const physH = Math.max(1, Math.round(targetDisplay.size.height * scaleFactor))
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: physW, height: physH } })
  const fullImg = findSourceForDisplay(sources, allDisplays, targetDisplay.id).thumbnail
  const fullSize = fullImg.getSize()
  // Derive actual scale from captured image vs logical size — handles cases where
  // the capturer returns a resolution different from what we requested.
  const sx = fullSize.width  / targetDisplay.size.width
  const sy = fullSize.height / targetDisplay.size.height

  const cropX = Math.max(0, Math.round(rect.x * sx))
  const cropY = Math.max(0, Math.round(rect.y * sy))
  const cropW = Math.max(1, Math.min(fullSize.width  - cropX, Math.round(rect.width  * sx)))
  const cropH = Math.max(1, Math.min(fullSize.height - cropY, Math.round(rect.height * sy)))

  const cropped = fullImg.crop({ x: cropX, y: cropY, width: cropW, height: cropH })
  return cropped.toDataURL()
}

async function captureDisplay(display: Electron.Display, allDisplays: Electron.Display[]): Promise<string> {
  const sf = display.scaleFactor || 1
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width:  Math.max(1, Math.round(display.size.width  * sf)),
      height: Math.max(1, Math.round(display.size.height * sf)),
    }
  })
  return findSourceForDisplay(sources, allDisplays, display.id).thumbnail.toDataURL()
}

async function captureActiveMonitor(): Promise<string | void> {
  const allDisplays = screen.getAllDisplays()

  // Single display → capture immediately.
  if (allDisplays.length <= 1) {
    const activeDisplay = allDisplays[0] ?? screen.getPrimaryDisplay()
    await hideMainWindow()
    const dataUrl = await captureDisplay(activeDisplay, allDisplays)
    await sendCaptureToEditor(dataUrl, 'active-monitor')
    return dataUrl
  }

  // Multiple displays → show overlays, let the user click one.
  setOverlayMode('monitor-pick')
  await hideMainWindow()
  createOverlayWindows()
}

export async function sendCaptureToEditor(dataUrl: string, source: string) {
  const mainWin = getMainWindow()
  if (!mainWin || mainWin.isDestroyed()) return

  try {
    const img = nativeImage.createFromDataURL(dataUrl)
    clipboard.writeImage(img)
  } catch { /* silent */ }

  try {
    const historyStore = getHistoryStore()
    if (historyStore) {
      const ts = localTimestamp()
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
