import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'path'
import { getMainWindow, markQuitting } from './index'
import { dispatchCapture } from './capture'

let tray: Tray | null = null

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
    { label: 'Region',          accelerator: 'Ctrl+Shift+4', click: () => dispatchCapture('region') },
    { label: 'Window',          accelerator: 'Ctrl+Shift+2', click: () => dispatchCapture('window') },
    { label: 'Fullscreen',      accelerator: 'Ctrl+Shift+3', click: () => dispatchCapture('fullscreen') },
    { label: 'Active Screen',   accelerator: 'Ctrl+Shift+1', click: () => dispatchCapture('active-monitor') },
    { type: 'separator' },
    {
      label: 'Open Lumia',
      accelerator: 'Ctrl+Shift+X',
      click: () => {
        const win = getMainWindow()
        if (win) { win.show(); win.focus() }
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { markQuitting(); app.quit() } }
  ])
}

export function destroyTray() {
  tray?.destroy()
  tray = null
}
