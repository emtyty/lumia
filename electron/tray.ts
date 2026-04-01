import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'path'
import { getMainWindow, createOverlayWindow } from './index'
import { sendCaptureToEditor } from './capture'

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
  const iconPath = join(__dirname, '../../resources/icon.png')
  let icon: Electron.NativeImage

  try {
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) throw new Error('empty')
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
        createOverlayWindow()
      }
    },
    {
      label: 'Capture Fullscreen',
      accelerator: 'Ctrl+Shift+3',
      click: async () => {
        await hideMain()
        const { desktopCapturer, screen } = await import('electron')
        const d = screen.getPrimaryDisplay()
        const sf = d.scaleFactor
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: d.size.width * sf, height: d.size.height * sf }
        })
        sendCaptureToEditor(sources[0].thumbnail.toDataURL(), 'fullscreen')
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
