import { app, BrowserWindow, ipcMain, shell, dialog, nativeImage, clipboard, screen, Menu } from 'electron'
import { join } from 'path'
import { setupCapture } from './capture'
import { setupHotkeys, teardownHotkeys } from './hotkeys'
import { setupTray, destroyTray } from './tray'
import { WorkflowEngine } from './workflow'
import { TemplateStore } from './templates'
import { HistoryStore } from './history'
import { getSettings, setSetting, type AppSettings } from './settings'
import { autoUpdater } from 'electron-updater'

// Force legacy DXGI/GDI capturer instead of WGC on Windows.
// appendSwitch with duplicate keys can be ignored; appendArgument always appends.
// Covers: desktopCapturer (screenshots) + getUserMedia streams (video recording).
if (process.platform === 'win32') {
  app.commandLine.appendArgument(
    '--disable-features=WindowsNativeGraphicsCapture,' +
    'WebRtcAllowWgcScreenCapturer,' +
    'WebRtcAllowWgcWindowCapturer,' +
    'WebRtcAllowWgcDesktopCapturer'
  )
}

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let historyStoreInstance: InstanceType<typeof HistoryStore> | null = null
let overlayWindow: BrowserWindow | null = null
let overlayDisplayId: number | null = null

export function getMainWindow() { return mainWindow }
export function getHistoryStore() { return historyStoreInstance }
export function getOverlayWindow() { return overlayWindow }
export function getOverlayDisplayId() { return overlayDisplayId }

const ICON_PATH = process.platform === 'win32'
  ? join(__dirname, '../../resources/icons/win/icon.ico')
  : process.platform === 'darwin'
    ? join(__dirname, '../../resources/icons/mac/icon.icns')
    : join(__dirname, '../../resources/icon.png')

function createMainWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const isWin = process.platform === 'win32'
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#050810',
    icon: ICON_PATH,
    // VSCode-style: frameless on both platforms
    // macOS: traffic lights inset; Windows: native overlay controls
    frame: false,
    ...(isMac ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 20 }
    } : isWin ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#050810',
        symbolColor: '#94a3b8',
        height: 40
      }
    } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Remove native menu bar entirely (replaced by custom TitleBar in HTML)
  win.setMenu(null)

  if (isDev) {
    win.loadURL('http://localhost:5173/#/dashboard')
    // win.webContents.openDevTools({ mode: 'detach' })
  
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/dashboard' })
  }

  win.on('closed', () => { mainWindow = null })
  return win
}

export function createOverlayWindow(): BrowserWindow {
  if (overlayWindow) {
    overlayWindow.close()
    overlayWindow = null
  }

  // Use the display containing the cursor — not always the primary display
  const cursorPoint = screen.getCursorScreenPoint()
  const targetDisplay = screen.getDisplayNearestPoint(cursorPoint)
  const { width, height, x, y } = targetDisplay.bounds
  overlayDisplayId = targetDisplay.id

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.setIgnoreMouseEvents(false)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true)
  // Do NOT call win.maximize() — on macOS it triggers Zoom behavior which
  // causes Stage Manager / Dock sidebar to flash. Explicit bounds from
  // display.bounds (set in the constructor above) are sufficient.

  if (isDev) {
    win.loadURL('http://localhost:5173/#/overlay')
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/overlay' })
  }

  win.on('closed', () => { overlayWindow = null })
  overlayWindow = win
  return win
}

function navigateTo(route: string) {
  if (!mainWindow) return
  if (isDev) {
    mainWindow.loadURL(`http://localhost:5173/#${route}`)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
  }
}

// Set application menu — hidden on Windows (frameless), but provides keyboard accelerators
if (isDev) {
  const devMenu = Menu.buildFromTemplate([
    {
      label: 'Dev',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => BrowserWindow.getFocusedWindow()?.webContents.reload() },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => BrowserWindow.getFocusedWindow()?.webContents.reloadIgnoringCache() },
        { label: 'Toggle DevTools', accelerator: process.platform === 'darwin' ? 'Alt+CmdOrCtrl+I' : 'Ctrl+Shift+I', click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools() },
      ],
    },
  ])
  Menu.setApplicationMenu(devMenu)
} else {
  Menu.setApplicationMenu(null)
}

if (process.platform === 'win32') {
  app.setAppUserModelId('Lumia')
}

app.whenReady().then(async () => {
  mainWindow = createMainWindow()

  setupCapture()
  setupHotkeys()
  setupTray()

  // Auto-update
  if (!isDev) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.checkForUpdates()
  }

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update:downloaded', info.version)
  })
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('app:version', () => app.getVersion())

  // IPC: Navigation
  ipcMain.handle('navigate', (_e, route: string) => {
    navigateTo(route)
  })

  // IPC: Workflow
  const templateStore = new TemplateStore()
  const workflowEngine = new WorkflowEngine(templateStore)

  ipcMain.handle('workflow:getTemplates', () => templateStore.getAll())
  ipcMain.handle('workflow:saveTemplate', (_e, template) => templateStore.save(template))
  ipcMain.handle('workflow:deleteTemplate', (_e, id: string) => templateStore.delete(id))
  ipcMain.handle('workflow:run', async (_e, templateId: string, imageData: string) => {
    return workflowEngine.run(templateId, imageData)
  })

  // IPC: History
  const historyStore = new HistoryStore()
  historyStoreInstance = historyStore
  ipcMain.handle('history:get', () => historyStore.getAll())
  ipcMain.handle('history:delete', (_e, id: string) => historyStore.delete(id))
  ipcMain.handle('history:openFile', (_e, filePath: string) => {
    const { resolve, normalize } = require('path')
    const { homedir } = require('os')
    const normalized = resolve(normalize(filePath))
    if (!normalized.startsWith(homedir())) throw new Error('Access denied — path outside home directory')
    return shell.openPath(normalized)
  })
  ipcMain.handle('history:addCapture', (_e, item) => historyStore.add(item))

  // IPC: Settings
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, key: keyof AppSettings, value: unknown) => setSetting(key, value as AppSettings[typeof key]))

  // IPC: Save file from dataURL (used by ShareDialog save button)
  ipcMain.handle('capture:saveFile', async (_e, dataUrl: string, filePath: string) => {
    const { writeFile, mkdir } = await import('fs/promises')
    const { dirname, resolve, normalize } = await import('path')
    const { homedir } = await import('os')
    const normalized = resolve(normalize(filePath))
    if (!normalized.startsWith(homedir())) throw new Error('Access denied — path outside home directory')
    await mkdir(dirname(normalized), { recursive: true })
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    await writeFile(normalized, Buffer.from(base64, 'base64'))
    return normalized
  })

  // IPC: Shell
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Invalid URL scheme — only http/https allowed')
    return shell.openExternal(url)
  })
  ipcMain.handle('shell:openPath', (_e, filePath: string) => {
    const { resolve, normalize } = require('path')
    const { homedir } = require('os')
    const normalized = resolve(normalize(filePath))
    if (!normalized.startsWith(homedir())) throw new Error('Access denied — path outside home directory')
    return shell.openPath(normalized)
  })

  // IPC: App quit (for renderer menu)
  ipcMain.handle('app:quit', () => app.quit())

  // IPC: Dev tools (for renderer menu)
  ipcMain.handle('devtools:toggle', () => mainWindow?.webContents.toggleDevTools())
  ipcMain.handle('window:reload', () => mainWindow?.webContents.reload())
  ipcMain.handle('window:force-reload', () => mainWindow?.webContents.reloadIgnoringCache())

  // IPC: Dialog
  ipcMain.handle('dialog:save', async (_e, opts) => {
    const result = await dialog.showSaveDialog(mainWindow!, opts)
    return result
  })

  ipcMain.handle('dialog:open', async (_e, opts) => {
    const result = await dialog.showOpenDialog(mainWindow!, opts)
    return result
  })

  // IPC: Clipboard write image
  ipcMain.handle('clipboard:writeImage', (_e, dataUrl: string) => {
    const img = nativeImage.createFromDataURL(dataUrl)
    clipboard.writeImage(img)
  })

  // IPC: Recording — renderer requests the desktop source ID, then records itself
  ipcMain.handle('record:getSources', async () => {
    const sources = await require('electron').desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 }
    })
    return sources.map((s: Electron.DesktopCapturerSource) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL()
    }))
  })

  // IPC: Save recorded video buffer to disk
  ipcMain.handle('record:save', async (_e, buffer: ArrayBuffer, filename: string) => {
    const { writeFile, mkdir } = await import('fs/promises')
    const { homedir } = await import('os')
    const { join } = await import('path')
    const dir = join(homedir(), 'Videos', 'ShareAnywhere')
    await mkdir(dir, { recursive: true })
    const filePath = join(dir, filename)
    await writeFile(filePath, Buffer.from(buffer))
    return filePath
  })

  // IPC: Update titleBarOverlay colors when theme changes (Windows only)
  ipcMain.handle('titlebar:setTheme', (_e, theme: 'dark' | 'light') => {
    if (process.platform !== 'win32' || !mainWindow) return
    mainWindow.setTitleBarOverlay({
      color: theme === 'light' ? '#f6f6fb' : '#050810',
      symbolColor: theme === 'light' ? '#2d2f33' : '#94a3b8',
      height: 40
    })
  })

  // IPC: Read local file as buffer (for video blob URL playback in renderer)
  ipcMain.handle('file:read', async (_e, filePath: string) => {
    const { readFile } = await import('fs/promises')
    const { resolve, normalize } = await import('path')
    const { homedir } = await import('os')
    const normalized = resolve(normalize(filePath))
    if (!normalized.startsWith(homedir())) throw new Error('Access denied — path outside home directory')
    return readFile(normalized)
  })

  // IPC: Recording state — hide main window before recording starts
  ipcMain.handle('record:hide', async () => {
    mainWindow?.hide()
    await new Promise(r => setTimeout(r, 200))
  })

  ipcMain.handle('record:show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  teardownHotkeys()
  destroyTray()
})

app.on('second-instance', () => {
  mainWindow?.show()
  mainWindow?.focus()
})
