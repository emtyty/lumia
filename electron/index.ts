import { app, BrowserWindow, ipcMain, shell, dialog, nativeImage, clipboard, screen, Menu, nativeTheme } from 'electron'
import { join, dirname } from 'path'
import fs from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { setupCapture } from './capture'
import { setupVideo } from './video'
import { registerOverlayHwnd, unregisterOverlayHwnd } from './native-input'
import { setupHotkeys, teardownHotkeys, getHotkeys, saveHotkeys, resetHotkeys, defaultHotkeys, type HotkeyConfig } from './hotkeys'
import { setupTray, destroyTray } from './tray'
import { setupScrollCapture, getOverlayMode } from './scroll-capture'
import { WorkflowEngine } from './workflow'
import { TemplateStore } from './templates'
import { HistoryStore } from './history'
import { makeThumbnail } from './thumbnail'
import { showNotification } from './notify'
import type { HistoryItem } from './types'
import { getSettings, setSetting, resolveSaveStartDir, rememberSaveDir, type AppSettings } from './settings'
import { applyLaunchAtStartup, wasLaunchedAtStartup } from './startup'
import { preflightPermissions } from './permissions'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

log.transports.file.level = 'info'
log.transports.console.level = 'info'
autoUpdater.logger = log
Object.assign(console, log.functions)

// Enable WGC (Windows Graphics Capture) for pixel-perfect, high-quality screenshots on Windows.
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('enable-features', 'WindowsNativeGraphicsCapture')
}

const isDev = !app.isPackaged

// Only allow a single running instance — prevents cache/lock conflicts
// (cache_util_win.cc "Access is denied" errors) when the user relaunches
// while the tray instance is still alive.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let mainWindow: BrowserWindow | null = null
let historyStoreInstance: InstanceType<typeof HistoryStore> | null = null
const overlayWindows: Map<number, BrowserWindow> = new Map()
let activeOverlayDisplayId: number | null = null
let overlayPollTimer: ReturnType<typeof setInterval> | null = null
let overlayDrawingInProgress = false
let currentRoute = '/dashboard'
let isQuitting = false
// Set by the autoUpdater 'update-downloaded' handler. Allows the install to
// happen the moment the user drops the app to the tray instead of waiting
// for an explicit Quit / next launch.
let updateDownloaded = false
let autoInstallTimer: ReturnType<typeof setTimeout> | null = null
// Grace window between "user hid the app" and "we restart the app to install".
// Long enough that a brief Cmd+H (Mac) or accidental close-to-tray (Windows)
// doesn't nuke whatever the user is about to come back to. Short enough that
// a genuinely-idle tray instance picks up the update before the next session.
const AUTO_INSTALL_GRACE_MS = 30 * 1000

export function markQuitting() { isQuitting = true }

/** Schedule a quit-and-install for an already-downloaded update, but only if
 *  the window stays hidden for the full grace window. Called from
 *  `update-downloaded` and from the main window's 'hide' event. */
function scheduleAutoInstall() {
  if (autoInstallTimer) clearTimeout(autoInstallTimer)
  autoInstallTimer = null
  if (!updateDownloaded) return
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) return
  autoInstallTimer = setTimeout(() => {
    autoInstallTimer = null
    // Re-check: user may have surfaced the window during the grace window.
    if (!updateDownloaded) return
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) return
    console.log('[autoUpdater] grace period elapsed with window hidden — installing update')
    updateDownloaded = false
    isQuitting = true
    // (isSilent=true, isForceRunAfter=true) — Windows-only knobs. Without
    // isSilent the NSIS assisted-installer UI pops up on every update;
    // isForceRunAfter relaunches the app once the install finishes.
    autoUpdater.quitAndInstall(true, true)
  }, AUTO_INSTALL_GRACE_MS)
}

/** Called when the window becomes visible again — cancel any pending install
 *  so the user isn't kicked out the moment after they reopen. */
function cancelAutoInstall() {
  if (autoInstallTimer) clearTimeout(autoInstallTimer)
  autoInstallTimer = null
}

/** Track the dock icon to the main window's visibility on macOS: hidden when
 *  the window is closed to tray, visible when the window is open. Without
 *  this, the dock shortcut sticks around pointing at "nothing", and reopening
 *  via the tray leaves a stale dock icon behind. No-op on Windows/Linux. */
function syncDockVisibility() {
  if (process.platform !== 'darwin') return
  const visible = !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible())
  if (visible) app.dock?.show().catch(() => { /* ignore */ })
  else app.dock?.hide()
}

export function getMainWindow() { return mainWindow }
export function getHistoryStore() { return historyStoreInstance }
export function getOverlayWindow() {
  if (activeOverlayDisplayId == null) return null
  return overlayWindows.get(activeOverlayDisplayId) ?? null
}
export function getOverlayDisplayId() { return activeOverlayDisplayId }

export function broadcastToOverlays(channel: string, ...args: unknown[]) {
  for (const [, win] of overlayWindows) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

export function closeAllOverlays() {
  if (overlayPollTimer) {
    clearInterval(overlayPollTimer)
    overlayPollTimer = null
  }
  overlayDrawingInProgress = false
  for (const [, win] of overlayWindows) {
    if (!win.isDestroyed()) win.close()
  }
  overlayWindows.clear()
  activeOverlayDisplayId = null
}

const ICON_PATH = process.platform === 'win32'
  ? join(__dirname, '../../resources/icons/win/icon.ico')
  : process.platform === 'darwin'
    ? join(__dirname, '../../resources/icons/mac/icon.icns')
    : join(__dirname, '../../resources/icon.png')

function createMainWindow(startHidden = false): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const isWin = process.platform === 'win32'
  const win = new BrowserWindow({
    width: 1250,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#07070b',
    icon: ICON_PATH,
    show: !startHidden,
    // VSCode-style: frameless on both platforms
    // macOS: traffic lights inset; Windows: native overlay controls
    frame: false,
    ...(isMac ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 20 }
    } : isWin ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#07070b',
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

  // Intercept close: keep the app alive in the tray instead of exiting. Only
  // actually close when we're explicitly quitting (tray Quit / hotkey / IPC).
  // On /editor, X is a "discard capture" button — navigate back to the
  // dashboard and keep the window open instead of hiding to tray.
  win.on('close', (e) => {
    if (isQuitting) return
    e.preventDefault()
    if (currentRoute === '/editor') {
      currentRoute = '/dashboard'
      win.webContents.send('navigate', '/dashboard')
      return
    }
    win.hide()
  })

  // After the window goes to the tray, schedule install of any pending update.
  // Cancelled if the user surfaces the window again within the grace window.
  win.on('hide', () => { scheduleAutoInstall(); syncDockVisibility() })
  win.on('show', () => { cancelAutoInstall(); syncDockVisibility() })

  win.on('closed', () => { mainWindow = null })
  return win
}

export function createOverlayWindows(): Map<number, BrowserWindow> {
  closeAllOverlays()

  const allDisplays = screen.getAllDisplays()
  const cursorPoint = screen.getCursorScreenPoint()
  const cursorDisplay = screen.getDisplayNearestPoint(cursorPoint)
  activeOverlayDisplayId = cursorDisplay.id

  for (const display of allDisplays) {
    const { x, y, width, height } = display.bounds
    const displayBounds = { x, y, width, height }
    const isActive = display.id === activeOverlayDisplayId

    const win = new BrowserWindow({
      ...displayBounds,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      }
    })

    // On Windows, per-monitor DPI awareness can distort bounds when the overlay
    // is created on a secondary display with a different scale factor.
    if (process.platform === 'win32') {
      win.setBounds(displayBounds)
    }

    // Inactive overlays pass mouse events through so cursor can reach active display
    if (!isActive) {
      win.setIgnoreMouseEvents(true, { forward: true })
    } else {
      win.setIgnoreMouseEvents(false)
    }

    win.setAlwaysOnTop(true, 'pop-up-menu')
    win.setVisibleOnAllWorkspaces(true)

    if (isDev) {
      win.loadURL('http://localhost:5173/#/overlay')
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/overlay' })
    }

    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        win.setBounds(displayBounds)
        // Tell this overlay whether it's the active one
        win.webContents.send('overlay:set-active', display.id === activeOverlayDisplayId)
      }
    })

    win.once('ready-to-show', () => {
      if (process.platform === 'win32') {
        const hwnd = win.getNativeWindowHandle().readInt32LE(0)
        registerOverlayHwnd(hwnd)
      }
    })

    win.on('closed', () => {
      if (process.platform === 'win32') {
        try {
          const hwnd = win.getNativeWindowHandle().readInt32LE(0)
          unregisterOverlayHwnd(hwnd)
        } catch { /* window already destroyed */ }
      }
      overlayWindows.delete(display.id)
    })

    overlayWindows.set(display.id, win)
  }

  // Poll cursor position to switch active overlay when mouse moves between displays
  overlayPollTimer = setInterval(() => {
    if (overlayDrawingInProgress) return // don't switch while user is drawing

    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    if (display.id !== activeOverlayDisplayId) {
      const oldId = activeOverlayDisplayId
      activeOverlayDisplayId = display.id

      // Deactivate old overlay
      if (oldId != null) {
        const oldWin = overlayWindows.get(oldId)
        if (oldWin && !oldWin.isDestroyed()) {
          oldWin.webContents.send('overlay:set-active', false)
          oldWin.setIgnoreMouseEvents(true, { forward: true })
        }
      }

      // Activate new overlay
      const newWin = overlayWindows.get(display.id)
      if (newWin && !newWin.isDestroyed()) {
        newWin.webContents.send('overlay:set-active', true)
        newWin.setIgnoreMouseEvents(false)
      }
    }
  }, 100)

  return overlayWindows
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
  // Must match `appId` in electron-builder.yml — NSIS registers the Start
  // Menu shortcut under that AUMID, and WinRT silently drops toasts when
  // the runtime AUMID doesn't match the shortcut.
  app.setAppUserModelId('com.lumia.app')
}

app.whenReady().then(async () => {
  // Allow getUserMedia desktop capture in all windows (needed for overlay region capture)
  const { session } = await import('electron')
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') return callback(true)
    callback(false)
  })

  const startHidden = wasLaunchedAtStartup()
  mainWindow = createMainWindow(startHidden)

  // macOS: dock icon tracks main-window visibility (see syncDockVisibility).
  // For a normal launch the window is visible → dock visible. For login-item
  // startup (startHidden) the window is hidden → dock hidden too, so the
  // user only sees Lumia in the menubar tray as expected.
  syncDockVisibility()

  // Keep the OS login-item entry in sync with the stored preference on every
  // launch (covers app moves, reinstalls, and settings changed while offline).
  applyLaunchAtStartup(getSettings().launchAtStartup)

  setupCapture()
  setupVideo()
  setupHotkeys()
  setupTray()
  setupScrollCapture(mainWindow, createOverlayWindows, closeAllOverlays, getOverlayDisplayId)

  // Surface OS permission prompts (Screen Recording / Microphone / Accessibility
  // on macOS, Microphone on Windows) at startup rather than mid-capture. Skip
  // when launched hidden at boot — we'll preflight when the user surfaces the
  // window via the tray. Small delay so the dashboard paints first.
  if (!startHidden) {
    setTimeout(() => { void preflightPermissions(mainWindow) }, 1500)
  } else if (mainWindow) {
    mainWindow.once('show', () => {
      setTimeout(() => { void preflightPermissions(mainWindow) }, 800)
    })
  }

  // IPC: Overlay drawing state — lock active display while user is drawing
  ipcMain.on('overlay:drawing', (_e, drawing: boolean) => {
    overlayDrawingInProgress = drawing
  })

  // IPC: Renderer route tracking — used to intercept close on /editor
  ipcMain.on('app:route-changed', (_e, route: string) => {
    currentRoute = route
  })

  // Auto-update
  const sendUpdateStatus = (status: string, payload: Record<string, unknown> = {}) => {
    mainWindow?.webContents.send('update:status', { status, ...payload })
  }

  autoUpdater.on('error', (err) => {
    console.error('[autoUpdater] error:', err)
    sendUpdateStatus('error', { error: String(err?.message ?? err) })
  })
  autoUpdater.on('checking-for-update', () => {
    console.log('[autoUpdater] checking...')
    sendUpdateStatus('checking')
  })
  autoUpdater.on('update-available', (info) => {
    console.log('[autoUpdater] update available:', info.version)
    sendUpdateStatus('available', { version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    console.log('[autoUpdater] up to date')
    sendUpdateStatus('not-available')
  })
  autoUpdater.on('download-progress', (p) => {
    console.log(`[autoUpdater] downloading ${Math.round(p.percent)}% (${p.transferred}/${p.total})`)
    sendUpdateStatus('downloading', { percent: p.percent })
  })
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[autoUpdater] update downloaded:', info.version)
    mainWindow?.webContents.send('update:downloaded', info.version)
    sendUpdateStatus('downloaded', { version: info.version })
    updateDownloaded = true
    // If the user already has the app minimized to tray, the grace window
    // starts now — install if they don't surface the window within it.
    scheduleAutoInstall()
  })

  // Probe whether this process can write to the install dir. If not (typical
  // case: per-machine install on Windows being run by a non-admin user), the
  // silent NSIS update path can't apply the new bits — and falling back to
  // the UI installer would pop UAC every check. So we just disable the whole
  // auto-update pipeline: no check, no download, no banner. Users in this
  // state must update manually by running the new installer with admin.
  let canWriteInstallDir = false
  try {
    await fs.access(dirname(app.getPath('exe')), fsConstants.W_OK)
    canWriteInstallDir = true
  } catch { /* not writable — auto-update disabled */ }

  const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
  if (!isDev && canWriteInstallDir) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    console.log(`[autoUpdater] current version ${app.getVersion()}, checking for updates...`)
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[autoUpdater] checkForUpdates failed:', err)
    })
    setInterval(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('[autoUpdater] periodic check failed:', err)
      })
    }, UPDATE_CHECK_INTERVAL_MS)
  } else if (!isDev) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    console.log('[autoUpdater] install dir not writable — auto-update disabled. Update manually via the new installer.')
  }

  ipcMain.handle('update:install', () => {
    if (!canWriteInstallDir) return
    // Must set isQuitting before quitAndInstall — electron-updater triggers
    // app.quit() internally, and our before-quit handler hides to tray
    // unless isQuitting is true, which would silently swallow the restart.
    updateDownloaded = false
    cancelAutoInstall()
    isQuitting = true
    // Silent install on Windows so the NSIS UI doesn't surface on every
    // update; isForceRunAfter brings the app back up after install. No-op
    // for the macOS update path (zip-based, no installer UI to silence).
    autoUpdater.quitAndInstall(true, true)
  })
  ipcMain.handle('update:check', async () => {
    if (isDev) {
      sendUpdateStatus('checking')
      setTimeout(() => sendUpdateStatus('not-available'), 400)
      return { ok: true, dev: true }
    }
    if (!canWriteInstallDir) {
      sendUpdateStatus('error', { error: 'Auto-update is unavailable because Lumia is installed to a location this user cannot write to. Reinstall with administrator rights to enable updates.' })
      return { ok: false, error: 'install-dir-not-writable' }
    }
    try {
      await autoUpdater.checkForUpdates()
      return { ok: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      sendUpdateStatus('error', { error: message })
      return { ok: false, error: message }
    }
  })
  // Renderer reads this to hide the "Check for Updates" menu entry when the
  // current process can't apply updates anyway. Always true in dev so the
  // menu item still works for testing the IPC.
  ipcMain.handle('update:available', () => isDev || canWriteInstallDir)

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
  ipcMain.handle('workflow:run', async (_e, templateId: string, imageData: string, destinationIndex?: number, historyId?: string) => {
    return workflowEngine.run(templateId, imageData, destinationIndex, historyId)
  })
  ipcMain.handle('workflow:inlineAction', async (_e, actionType: 'clipboard' | 'save', imageData: string) => {
    return workflowEngine.runInlineAction(actionType, imageData)
  })

  // IPC: History
  const historyStore = new HistoryStore()
  historyStoreInstance = historyStore

  // One-time upgrade cleanup. Bump HISTORY_CLEANUP_VERSION when the data
  // model diverges from prior releases badly enough that wiping existing
  // history + sidecar files is friendlier than trying to migrate. Runs
  // once per bump (guarded inside HistoryStore), then never again.
  const HISTORY_CLEANUP_VERSION = 1
  try {
    const wiped = await historyStore.runStartupCleanup(HISTORY_CLEANUP_VERSION)
    if (wiped > 0) console.log(`[history] upgrade reset v${HISTORY_CLEANUP_VERSION} — removed ${wiped} legacy item(s)`)
  } catch (err) {
    console.error('[history] upgrade cleanup failed', err)
  }

  // Background retention cleanup: prune on boot and then hourly. `days <= 0`
  // means keep forever, so the store skips the scan — cheap to keep running.
  // Prune unlinks the associated files on disk too (shared with the manual
  // delete path in HistoryStore), so old captures don't sit around orphaned.
  const runHistoryPrune = async () => {
    const days = getSettings().historyRetentionDays
    const removed = await historyStore.pruneOlderThan(days)
    if (removed > 0) console.log(`[history] pruned ${removed} item(s) older than ${days} day(s)`)
  }
  runHistoryPrune()
  const HISTORY_PRUNE_INTERVAL_MS = 60 * 60 * 1000
  const historyPruneTimer = setInterval(runHistoryPrune, HISTORY_PRUNE_INTERVAL_MS)
  app.on('will-quit', () => clearInterval(historyPruneTimer))

  ipcMain.handle('history:get', async () => {
    const items = historyStore.getAll()
    const { access } = await import('fs/promises')
    // fs.access is microsecond-fast on SSDs; 200 parallel probes are trivial.
    return Promise.all(items.map(async (item) => {
      if (!item.filePath) return item
      try {
        await access(item.filePath)
        return item
      } catch {
        return { ...item, fileMissing: true }
      }
    }))
  })
  ipcMain.handle('history:delete', async (_e, id: string) => {
    // Store.delete unlinks filePath + annotatedFilePath (bounded to homedir,
    // ENOENT ignored) and then mutates history.json.
    return historyStore.delete(id)
  })
  ipcMain.handle('history:cleanupMissing', async () => {
    const items = historyStore.getAll()
    const { access } = await import('fs/promises')
    const orphanIds: string[] = []
    await Promise.all(items.map(async (item) => {
      if (!item.filePath) return
      try { await access(item.filePath) } catch { orphanIds.push(item.id) }
    }))
    await Promise.all(orphanIds.map(id => historyStore.delete(id)))
    return orphanIds.length
  })
  // Persist the current annotation shapes (and optionally a flattened PNG
  // sidecar) for a history item. Reopening the item replays each shape as
  // its own Canvas commit so native Undo walks back through them in order.
  ipcMain.handle('history:saveAnnotations', async (_e, id: string, annotations: unknown[], flattenedDataUrl?: string) => {
    const items = historyStore.getAll()
    const item = items.find(i => i.id === id)
    if (!item) throw new Error('History item not found')
    if (!item.filePath) throw new Error('History item has no source file')

    const { writeFile, unlink } = await import('fs/promises')
    const { resolve, normalize, dirname, basename, extname, join } = await import('path')
    const { homedir } = await import('os')
    const originalPath = resolve(normalize(item.filePath))
    if (!originalPath.startsWith(homedir())) throw new Error('Access denied — path outside home directory')

    const hasAnnotations = Array.isArray(annotations) && annotations.length > 0

    // Preserve the existing sidecar + thumbnail by default — only the branches
    // below overwrite them. Without this, a debounced save (which ships only
    // the vector JSON, no flattened dataUrl) would reset `annotatedFilePath`
    // to undefined, orphan the sidecar on disk, and force Dashboard Share/
    // Copy back to the un-annotated original.
    let annotatedFilePath: string | undefined = item.annotatedFilePath
    let thumbnailUrl = item.thumbnailUrl

    if (hasAnnotations && typeof flattenedDataUrl === 'string' && flattenedDataUrl.startsWith('data:image/')) {
      // Write (or overwrite) the sidecar PNG next to the original. Naming
      // keeps the basename so a user browsing ~/Pictures/Lumia still sees the
      // original and annotated side-by-side.
      const dir = dirname(originalPath)
      const ext = extname(originalPath) || '.png'
      const stem = basename(originalPath, ext)
      const sidecar = join(dir, `${stem}-annotated.png`)
      const base64 = flattenedDataUrl.replace(/^data:image\/\w+;base64,/, '')
      await writeFile(sidecar, Buffer.from(base64, 'base64'))
      annotatedFilePath = sidecar
      thumbnailUrl = makeThumbnail(flattenedDataUrl)
    }

    if (!hasAnnotations && item.annotatedFilePath) {
      try {
        const prev = resolve(normalize(item.annotatedFilePath))
        if (prev.startsWith(homedir())) await unlink(prev)
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          console.error('[history:saveAnnotations] failed to clean up sidecar', err)
        }
      }
      annotatedFilePath = undefined
      // Regenerate thumbnail from the original now that annotations are gone.
      try {
        const { readFile } = await import('fs/promises')
        const buf = await readFile(originalPath)
        const ext = extname(originalPath).toLowerCase()
        const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
        thumbnailUrl = makeThumbnail(`data:${mime};base64,${buf.toString('base64')}`)
      } catch { /* leave previous thumbnail rather than blank the card */ }
    }

    return historyStore.update(id, {
      annotations: hasAnnotations ? (annotations as HistoryItem['annotations']) : undefined,
      annotatedFilePath,
      thumbnailUrl,
    })
  })

  // Upload a history item's source file to R2 and copy the resulting URL.
  // Dedup: if the item already has a successful r2 upload, reuse it so repeat
  // clicks don't re-issue requests (uploadToR2 itself is content-addressable
  // too, but this path short-circuits before even reading the file).
  ipcMain.handle('history:shareR2', async (_e, id: string) => {
    const items = historyStore.getAll()
    const item = items.find(i => i.id === id)
    if (!item) throw new Error('History item not found')
    if (!item.filePath) throw new Error('History item has no source file')

    const existing = item.uploads?.find(u => u.destination === 'r2' && u.success && u.url)
    if (existing?.url) {
      clipboard.writeText(existing.url)
      return existing
    }

    const { readFile } = await import('fs/promises')
    const { extname } = await import('path')
    const { uploadToR2 } = await import('./uploaders/r2')

    // Prefer the annotated sidecar when present so shared links carry the
    // user's final edited version rather than the untouched original.
    const sourcePath = item.annotatedFilePath ?? item.filePath
    const buffer = await readFile(sourcePath)
    const ext = extname(sourcePath).replace(/^\./, '').toLowerCase() || (item.type === 'recording' ? 'webm' : 'png')
    const isVideo = item.type === 'recording'
    const contentType = isVideo
      ? (ext === 'mp4' ? 'video/mp4' : 'video/webm')
      : (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png')
    const keyPrefix = isVideo ? 'recordings' : 'captures'

    const res = await uploadToR2(
      { buffer, contentType, ext, keyPrefix },
      import.meta.env.MAIN_VITE_R2_ACCOUNT_ID,
      import.meta.env.MAIN_VITE_R2_ACCESS_KEY_ID,
      import.meta.env.MAIN_VITE_R2_SECRET_ACCESS_KEY,
      import.meta.env.MAIN_VITE_R2_BUCKET,
      import.meta.env.MAIN_VITE_R2_PUBLIC_URL,
    )

    if (res.success && res.url) {
      clipboard.writeText(res.url)
      // Append (or replace) the r2 entry so subsequent shares hit the fast
      // path above, and so the Dashboard card can flip to "Synced".
      const uploads = [
        ...(item.uploads ?? []).filter(u => u.destination !== 'r2'),
        res,
      ]
      historyStore.update(id, { uploads })
      showNotification({
        body: 'Link copied to clipboard',
        thumbnailDataUrl: item.thumbnailUrl,
      })
    }
    return res
  })

  ipcMain.handle('history:openFile', (_e, filePath: string) => {
    const { resolve, normalize } = require('path')
    const { homedir } = require('os')
    const normalized = resolve(normalize(filePath))
    if (!normalized.startsWith(homedir())) throw new Error('Access denied — path outside home directory')
    return shell.openPath(normalized)
  })
  ipcMain.handle('history:addCapture', async (_e, item) => {
    // If a renderer is adding a screenshot with only a dataUrl (e.g. scroll
    // capture, video-annotator frame extract), persist the original to
    // ~/Pictures/Lumia/ here so every history item references a real file.
    try {
      if (item && item.type === 'screenshot' && !item.filePath && typeof item.dataUrl === 'string' && item.dataUrl.startsWith('data:image/')) {
        const { writeFile, mkdir } = await import('fs/promises')
        const { ORIGINALS_DIR } = await import('./capture')
        const { join: joinPath } = await import('path')
        const { localTimestamp } = await import('./utils')
        await mkdir(ORIGINALS_DIR, { recursive: true })
        const ext = item.dataUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png'
        const filename = `capture-${localTimestamp()}.${ext}`
        const filePath = joinPath(ORIGINALS_DIR, filename)
        const base64 = item.dataUrl.replace(/^data:image\/\w+;base64,/, '')
        await writeFile(filePath, Buffer.from(base64, 'base64'))
        item = { ...item, name: item.name ?? filename, filePath }
      }
      // Replace the full dataUrl with a compact thumbnail. `filePath` is the
      // source of truth for the full image — dataUrl is never stored.
      if (item && typeof item.dataUrl === 'string' && item.dataUrl.startsWith('data:image/')) {
        const { dataUrl, thumbnailUrl, ...rest } = item
        item = { ...rest, thumbnailUrl: thumbnailUrl ?? makeThumbnail(dataUrl) }
      }
    } catch (err) {
      console.error('[history:addCapture] failed to persist original', err)
    }
    return historyStore.add(item)
  })
  ipcMain.handle('history:readAsDataUrl', async (_e, filePath: string) => {
    const { readFile } = await import('fs/promises')
    const { resolve, normalize, extname } = await import('path')
    const { homedir } = await import('os')
    const normalized = resolve(normalize(filePath))
    if (!normalized.startsWith(homedir())) throw new Error('Access denied — path outside home directory')
    const ext = extname(normalized).toLowerCase()
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
    try {
      const buf = await readFile(normalized)
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch (err: unknown) {
      // File deleted between history:get's fs.access probe and this read —
      // return null so renderer can refresh into the orphan state instead of
      // surfacing an ENOENT handler error on stderr.
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
      throw err
    }
  })

  // IPC: Overlay mode (scroll-region vs region)
  // Do NOT reset here — React StrictMode double-mounts the overlay,
  // causing a second call that would see 'region' instead of 'scroll-region'.
  // Mode is reset in scroll-region:confirm / scroll-region:cancel / region:confirm / region:cancel.
  ipcMain.handle('overlay:get-mode', () => {
    const mode = getOverlayMode()
    return mode
  })

  // IPC: Settings
  ipcMain.handle('hotkeys:get', () => getHotkeys())
  ipcMain.handle('hotkeys:getDefaults', () => ({ ...defaultHotkeys }))
  ipcMain.handle('hotkeys:set', (_e, hotkeys: HotkeyConfig) => {
    saveHotkeys(hotkeys)
    return getHotkeys()
  })
  ipcMain.handle('hotkeys:reset', () => resetHotkeys())
  // Renderer toggles this while the Settings UI is recording a new binding,
  // so existing global shortcuts don't fire (and double-bind) on the keys
  // the user is pressing to set the new combo.
  ipcMain.handle('hotkeys:setRecording', (_e, recording: boolean) => {
    if (recording) teardownHotkeys()
    else setupHotkeys()
  })
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, key: keyof AppSettings, value: unknown) => {
    setSetting(key, value as AppSettings[typeof key])
    if (key === 'launchAtStartup') applyLaunchAtStartup(value as boolean)
    if (key === 'historyRetentionDays') runHistoryPrune()
  })

  // IPC: OCR & Auto-Blur
  // Pixel-level blur application is gone — auto-blur regions are injected as
  // re-editable Konva annotations on the renderer side, not flattened here.
  ipcMain.handle('ocr:scan', async (_e, dataUrl: string) => {
    const { scanForSensitiveData } = await import('./auto-blur')
    return scanForSensitiveData(dataUrl)
  })

  // IPC: Google Drive OAuth — uses localhost redirect (OOB flow deprecated by Google)
  ipcMain.handle('gdrive:startAuth', async () => {
    const { createServer } = await import('http')
    const { exchangeGoogleAuthCode } = await import('./uploaders/googledrive')
    const clientId = import.meta.env.MAIN_VITE_GDRIVE_CLIENT_ID
    const clientSecret = import.meta.env.MAIN_VITE_GDRIVE_CLIENT_SECRET

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
  ipcMain.handle('app:quit', () => { isQuitting = true; app.quit() })

  // IPC: Dev tools (for renderer menu)
  ipcMain.handle('devtools:toggle', () => mainWindow?.webContents.toggleDevTools())
  ipcMain.handle('window:reload', () => mainWindow?.webContents.reload())
  ipcMain.handle('window:force-reload', () => mainWindow?.webContents.reloadIgnoringCache())

  // IPC: Dialog
  ipcMain.handle('dialog:save', async (_e, opts: Electron.SaveDialogOptions = {}) => {
    const { isAbsolute, join, dirname } = await import('path')
    const startDir = await resolveSaveStartDir()

    // If caller gave just a filename, prepend the resolved dir.
    const incoming = opts.defaultPath
    const defaultPath = !incoming
      ? startDir
      : isAbsolute(incoming) ? incoming : join(startDir, incoming)

    const result = await dialog.showSaveDialog(mainWindow!, { ...opts, defaultPath })
    if (!result.canceled && result.filePath) {
      rememberSaveDir(dirname(result.filePath))
    }
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
    const dir = join(homedir(), 'Videos', 'Lumia')
    await mkdir(dir, { recursive: true })
    const filePath = join(dir, filename)
    await writeFile(filePath, Buffer.from(buffer))
    return filePath
  })

  // IPC: Update titleBarOverlay colors when theme changes (Windows only)
  ipcMain.handle('titlebar:setTheme', (_e, theme: 'dark' | 'light' | 'system') => {
    if (process.platform !== 'win32' || !mainWindow) return
    const resolved = theme === 'system'
      ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
      : theme
    mainWindow.setTitleBarOverlay({
      color: resolved === 'light' ? '#f6f6fb' : '#050810',
      symbolColor: resolved === 'light' ? '#2d2f33' : '#94a3b8',
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

app.on('before-quit', (e) => {
  // If we initiated the quit ourselves (tray Quit / ExitLumia hotkey
  // / app:quit IPC), `isQuitting` is already true and we let it through.
  if (isQuitting) return
  // Otherwise this is Cmd+Q / dock right-click → Quit on macOS, or the
  // taskbar Close on Windows. Treat it as "hide to tray" — the user can
  // fully exit via the tray menu's Quit item. Mirrors how WhatsApp and
  // similar tray-resident apps behave.
  e.preventDefault()
  mainWindow?.hide()
})

app.on('window-all-closed', () => {
  // Keep app running in the tray instead of quitting when windows close.
  // The user can still quit via tray menu, Cmd/Ctrl+Q, or app:quit IPC.
  if (!isQuitting) return
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
