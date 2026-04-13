import { app, BrowserWindow, ipcMain, shell, dialog, nativeImage, clipboard, screen, Menu } from 'electron'
import { join } from 'path'
import { setupCapture } from './capture'
import { setupHotkeys, teardownHotkeys, getHotkeys } from './hotkeys'
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
  // 'pop-up-menu' is above all application windows but below macOS system UI
  // (Stage Manager, Dock, menubar). Using 'screen-saver' (the old value) sits
  // above ALL system UI, which forces macOS to hide Stage Manager while the
  // overlay is visible and then snap it back in when the overlay closes —
  // that "snap back" is the sidebar-appearing bug users see on macOS.
  win.setAlwaysOnTop(true, 'pop-up-menu')
  win.setVisibleOnAllWorkspaces(true)

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
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
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
  // On macOS, Cut/Copy/Paste/Undo work via the application menu's Edit entry.
  // Setting null removes that, breaking all text-input shortcuts system-wide.
  // Keep a minimal hidden menu so keyboard shortcuts still work.
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [{ role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      }
    ]))
  } else {
    Menu.setApplicationMenu(null)
  }
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
  ipcMain.handle('hotkeys:get', () => getHotkeys())
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, key: keyof AppSettings, value: unknown) => setSetting(key, value as AppSettings[typeof key]))

  // IPC: Google Drive OAuth — uses localhost redirect (OOB flow deprecated by Google)
  ipcMain.handle('gdrive:startAuth', async () => {
    const { createServer } = await import('http')
    const { exchangeGoogleAuthCode } = await import('./uploaders/googledrive')
    const { GDRIVE_CLIENT_ID: clientId, GDRIVE_CLIENT_SECRET: clientSecret } = await import('./gdrive-credentials')

    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')

        if (url.pathname !== '/') {
          res.writeHead(404)
          res.end()
          return
        }

        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        if (error || !code) {
          res.end(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lumia — Authorization Failed</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0d0d0f;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #fff;
  }
  .card {
    text-align: center;
    padding: 48px 56px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 24px;
    backdrop-filter: blur(24px);
    max-width: 420px;
    width: 90vw;
  }
  .icon {
    width: 64px; height: 64px;
    border-radius: 50%;
    background: rgba(239,68,68,0.15);
    border: 1px solid rgba(239,68,68,0.3);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 24px;
    font-size: 28px;
  }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 10px; letter-spacing: -0.3px; }
  p { font-size: 14px; color: rgba(255,255,255,0.45); line-height: 1.6; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">✕</div>
    <h1>Authorization failed</h1>
    <p>Something went wrong. You may close this tab and try again from Lumia.</p>
  </div>
</body>
</html>`)
          server.close()
          resolve({ success: false, error: error ?? 'No code returned' })
          return
        }

        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lumia — Connected</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0d0d0f;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #fff;
  }
  .card {
    text-align: center;
    padding: 48px 56px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 24px;
    backdrop-filter: blur(24px);
    max-width: 420px;
    width: 90vw;
    animation: fadeUp 0.4s cubic-bezier(0.16,1,0.3,1) both;
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .icon {
    width: 64px; height: 64px;
    border-radius: 50%;
    background: rgba(74,222,128,0.12);
    border: 1px solid rgba(74,222,128,0.3);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 24px;
    font-size: 28px;
    animation: pop 0.5s 0.2s cubic-bezier(0.16,1,0.3,1) both;
  }
  @keyframes pop {
    from { opacity: 0; transform: scale(0.6); }
    to   { opacity: 1; transform: scale(1); }
  }
  h1 {
    font-size: 22px; font-weight: 700;
    margin-bottom: 10px;
    letter-spacing: -0.3px;
  }
  p { font-size: 14px; color: rgba(255,255,255,0.45); line-height: 1.6; }
  .badge {
    display: inline-flex; align-items: center; gap: 6px;
    margin-top: 20px;
    padding: 6px 14px;
    background: rgba(74,222,128,0.08);
    border: 1px solid rgba(74,222,128,0.2);
    border-radius: 999px;
    font-size: 12px;
    color: rgba(74,222,128,0.9);
    font-weight: 600;
    letter-spacing: 0.2px;
  }
  .dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #4ade80;
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>Connected!</h1>
    <p>Google Drive has been linked to your Lumia account.<br>You may close this tab.</p>
    <div class="badge"><span class="dot"></span> Lumia is ready</div>
  </div>
</body>
</html>`)
        server.close()

        try {
          const result = await exchangeGoogleAuthCode(code, clientId, clientSecret, 'http://localhost:42813')
          setSetting('googleDriveAccessToken', result.accessToken)
          setSetting('googleDriveRefreshToken', result.refreshToken)
          setSetting('googleDriveTokenExpiresAt', result.expiresAt)
          mainWindow?.webContents.send('gdrive:connected')
          resolve({ success: true })
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          resolve({ success: false, error: msg })
        }
      })

      server.listen(42813, '127.0.0.1', () => {
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: 'http://localhost:42813',
          response_type: 'code',
          scope: 'https://www.googleapis.com/auth/drive.file',
          access_type: 'offline',
          prompt: 'consent'
        })
        shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
      })

      server.on('error', (err) => {
        resolve({ success: false, error: `Local server error: ${err.message}` })
      })
    })
  })

  ipcMain.handle('gdrive:disconnect', () => {
    setSetting('googleDriveAccessToken', '')
    setSetting('googleDriveRefreshToken', '')
    setSetting('googleDriveTokenExpiresAt', 0)
    return { success: true }
  })

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
