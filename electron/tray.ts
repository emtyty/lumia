import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'path'
import { getMainWindow, createOverlayWindows } from './index'
import { sendCaptureToEditor } from './capture'
import fs from 'fs'

let tray: Tray | null = null

const HIDE_DELAY_MS = 200

function hideMain(): Promise<void> {
  return new Promise(resolve => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) { resolve(); return }
    win.hide()
    setTimeout(resolve, HIDE_DELAY_MS)
  })
}

export function setupTray() {
  const isMac = process.platform === 'darwin'
  const trayIconPath = app.isPackaged
    ? join(process.resourcesPath, `tray/${isMac ? 'mac' : 'win'}/tray-icon.png`)
    : join(__dirname, `../../resources/tray/${isMac ? 'mac' : 'win'}/tray-icon.png`)
  console.log(`Tray icon path: ${trayIconPath}`)
  let icon: Electron.NativeImage


  try {
    icon = nativeImage.createFromPath(trayIconPath)
    if (icon.isEmpty()) {
      console.error('Could not load tray icon.')
      icon = nativeImage.createEmpty()
      return
    }
    if (isMac) {
      // macOS menu bar icons should be 22x22 points (44x44 px @2x Retina)
      // Resize to 22x22 so Electron treats it as 22pt, not 44pt
      icon = icon.resize({ width: 22, height: 22 })
      icon.setTemplateImage(true)
    } else {
      icon = icon.resize({ width: 32, height: 32 })
    }
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('Lumia')
  tray.setContextMenu(buildMenu())

  tray.on('double-click', () => {
    const win = getMainWindow()
    if (win) { win.show(); win.focus() }
  })
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: 'Lumia', enabled: false },
    { type: 'separator' },
    {
      label: 'Capture Region',
      accelerator: 'Ctrl+Shift+4',
      click: async () => {
        await hideMain()
        createOverlayWindows()
      }
    },
    {
      label: 'Capture Fullscreen',
      accelerator: 'Ctrl+Shift+3',
      click: async () => {
        const { desktopCapturer, screen } = await import('electron')
        // Sample cursor position BEFORE hiding — after the 200ms hide delay the cursor may have moved
        const cursorPoint = screen.getCursorScreenPoint()
        const allDisplays = screen.getAllDisplays()
        const d = screen.getDisplayNearestPoint(cursorPoint)
        const sf = d.scaleFactor

        await hideMain()

        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: d.size.width * sf, height: d.size.height * sf }
        })
        let source = sources.find(s => s.display_id === String(d.id))
        if (!source) {
          const idx = allDisplays.findIndex(disp => disp.id === d.id)
          source = (idx >= 0 && idx < sources.length) ? sources[idx] : sources[0]
        }
        sendCaptureToEditor(source.thumbnail.toDataURL(), 'fullscreen')
      }
    },
    {
      label: 'Capture Active Window',
      accelerator: 'Ctrl+Shift+2',
      click: async () => {
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
      }
    },
    { type: 'separator' },
    {
      label: 'Open Lumia',
      click: () => {
        const win = getMainWindow()
        if (win) { win.show(); win.focus() }
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
}

export function destroyTray() {
  tray?.destroy()
  tray = null
}
