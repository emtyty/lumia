/**
 * Live annotation overlay for the recording session.
 *
 * Two windows:
 *   - overlay: transparent fullscreen on the recording display, hosts a
 *     Konva stage where strokes are drawn. Excluded from screen capture
 *     content protection only when explicitly requested — for the live
 *     annotation use case we WANT it captured (that's the point).
 *   - toolbar: a small floating palette with the tool/color/stroke
 *     pickers + Clear/Undo. Draggable, content-protected so it never
 *     ends up baked into the recording.
 *
 * The toolbar is the only thing the user clicks; tool changes flow
 * toolbar → main → overlay. The overlay only renders, never decides.
 *
 * Lifecycle is tied to the recording session — closing the session
 * (stop / cancel) tears both windows down via closeAnnotation().
 */

import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'

const isDev = !app.isPackaged

let overlayWin: BrowserWindow | null = null
let toolbarWin: BrowserWindow | null = null

/** Single source of truth for the live drawing state. Toolbar reads this
 *  on mount so the user's most recent color/stroke survive a toggle off →
 *  on. Tool defaults to 'none' (no draw): the user must explicitly pick a
 *  tool before clicks on the overlay turn into strokes — that keeps the
 *  first click after enabling annotation from being an accidental drag. */
interface AnnotationState {
  tool: 'none' | 'select' | 'pen' | 'arrow' | 'rect' | 'ellipse' | 'highlighter'
  color: string
  strokeWidth: number
}

const state: AnnotationState = {
  tool: 'none',
  color: '#f87171',
  strokeWidth: 4,
}

function loadRoute(win: BrowserWindow, route: string) {
  if (isDev) {
    win.loadURL(`http://localhost:5173/#${route}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
  }
}

const TOOLBAR_W = 800
const TOOLBAR_H = 56
const TOOLBAR_GAP = 12

/** Position the palette directly under whatever the recording toolbar's
 *  current bounds are. Centred on the toolbar (the palette is wider) and
 *  clamped to the display so it never falls off-screen. */
function computeToolbarBounds(display: Electron.Display, anchor: { x: number; y: number; width: number; height: number }) {
  const dx = display.bounds.x
  const dy = display.bounds.y
  const dw = display.bounds.width
  const dh = display.bounds.height

  const cx = anchor.x + anchor.width / 2
  const x = Math.round(Math.max(dx + 8, Math.min(dx + dw - TOOLBAR_W - 8, cx - TOOLBAR_W / 2)))
  const below = anchor.y + anchor.height + TOOLBAR_GAP
  const above = anchor.y - TOOLBAR_H - TOOLBAR_GAP
  // Prefer below; fall back to above if the palette would slide off the
  // bottom of the display, then clamp to the top edge as a last resort.
  let y = below + TOOLBAR_H + 8 <= dy + dh
    ? below
    : above >= dy + 8
      ? above
      : Math.max(dy + 8, dy + dh - TOOLBAR_H - 8)
  return { x, y, width: TOOLBAR_W, height: TOOLBAR_H }
}

function createOverlayWindow(display: Electron.Display) {
  const { x, y, width, height } = display.bounds
  const win = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    // Hide until the renderer has painted at least once. Without this,
    // the empty BrowserWindow appears with a white background for a frame
    // before the transparent body is drawn — causes a visible flash on
    // every "Annotate" toggle. ready-to-show below brings it back.
    show: false,
    // Non-focusable so the OS doesn't raise the overlay above the toolbar
    // windows when it briefly takes focus (e.g., during stroke draw, when
    // creating it). Without this Windows can place the topmost overlay
    // ahead of the topmost toolbars and swallow clicks meant for buttons.
    focusable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    // Re-apply bounds on Windows: the constructor uses the primary
    // display's DPI context, so on a secondary monitor with a different
    // scale factor the original bounds end up off — rewriting them once
    // the window is realised pins it to the right pixels.
    if (process.platform === 'win32') win.setBounds({ x, y, width, height })
    win.showInactive()
  })
  win.setMenu(null)
  // Stay above the recorded app (including fullscreen games / videos) so
  // strokes paint on top. The recording toolbar and the annotation
  // palette are pushed above this via SetWindowPos(HWND_TOPMOST) once
  // the overlay is shown — that's how their buttons stay clickable
  // despite the overlay being a fullscreen click-capturing window.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Overlay is intentionally NOT content-protected — strokes have to land
  // in the recording, that's the whole feature.
  loadRoute(win, '/annotation-overlay')
  win.on('closed', () => { overlayWin = null })
  return win
}

function createToolbarWindow(display: Electron.Display, anchor: { x: number; y: number; width: number; height: number }) {
  const bounds = computeToolbarBounds(display, anchor)
  const win = new BrowserWindow({
    ...bounds,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    // See createOverlayWindow — defer show until the first paint to avoid
    // the white-flash that bare BrowserWindows have on Windows.
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    if (process.platform === 'win32') win.setBounds(bounds)
    win.showInactive()
  })
  win.setMenu(null)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Toolbar buttons must NOT show up in the recording.
  win.setContentProtection(true)
  loadRoute(win, '/annotation-toolbar')
  win.on('closed', () => { toolbarWin = null })
  return win
}

function sendToOverlay(channel: string, ...args: unknown[]) {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send(channel, ...args)
  }
}

function sendToToolbar(channel: string, ...args: unknown[]) {
  if (toolbarWin && !toolbarWin.isDestroyed()) {
    toolbarWin.webContents.send(channel, ...args)
  }
}

/** True iff the user has the palette open AND the overlay is capturing
 *  clicks for drawing. Distinct from "the overlay window exists at all" —
 *  see hasLiveAnnotations. */
export function isAnnotationOpen(): boolean {
  return toolbarWin !== null && !toolbarWin.isDestroyed()
}

/** True iff there's an overlay window alive — possibly hidden away as a
 *  click-through layer that's still painting strokes onto the recording.
 *  Used by closeRecordingSession to tear down for real. */
function hasLiveAnnotations(): boolean {
  return overlayWin !== null && !overlayWin.isDestroyed()
}

/** Listener pair installed by linkToolbarDrag. Held module-side so we can
 *  detach them on close — without this, leftover listeners would resurrect
 *  the palette/toolbar coupling the next time the user starts recording. */
let dragLinkCleanup: (() => void) | null = null

export function openAnnotation(
  displayId: number,
  rect: { x: number; y: number; width: number; height: number } | undefined,
  topmostAfter: BrowserWindow[] = [],
  recordingToolbar?: BrowserWindow | null,
) {
  if (isAnnotationOpen()) return
  const display = screen.getAllDisplays().find(d => d.id === displayId) ?? screen.getPrimaryDisplay()

  // Always start without a tool selected so the user picks deliberately —
  // color and stroke width carry over from the previous session.
  state.tool = 'none'

  if (!hasLiveAnnotations()) {
    overlayWin = createOverlayWindow(display)
  }

  // Anchor the palette directly under the recording toolbar so the two
  // controls read as a single floating cluster. Falls back to the
  // recording rect (region/window mode) or a centred screen-mode position
  // if the recording toolbar isn't around for whatever reason.
  const anchor = recordingToolbar && !recordingToolbar.isDestroyed()
    ? recordingToolbar.getBounds()
    : rect
      ? { x: display.bounds.x + rect.x, y: display.bounds.y + rect.y, width: rect.width, height: rect.height }
      : { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height }
  toolbarWin = createToolbarWindow(display, anchor)

  // tool='none' = interact mode: clicks pass through the overlay to the
  // recorded app underneath. set-tool will flip this back to capturing
  // when the user picks an actual drawing tool.
  overlayWin!.setIgnoreMouseEvents(true, { forward: true })

  // Keep the recording toolbar and palette in lockstep — drag either one,
  // both move with the same delta. Captures their relative offset now and
  // preserves it across both windows' move events.
  if (recordingToolbar && !recordingToolbar.isDestroyed()) {
    dragLinkCleanup = linkToolbarDrag(recordingToolbar, toolbarWin)
  }

  // Force the palette + caller-supplied windows (recording toolbar, border)
  // to the top of the OS topmost-stack via direct Win32 SetWindowPos. Plain
  // setAlwaysOnTop / moveTop don't reliably re-raise an already-topmost
  // window; SetWindowPos(HWND_TOPMOST) does.
  //
  // Defer until the next tick so the overlay's HWND is fully realised in
  // the topmost group before we re-raise the toolbars on top of it.
  // Without the defer, the overlay can land on top after the SetWindowPos
  // calls run because its 'show' phase hasn't completed yet.
  const wins = [toolbarWin, ...topmostAfter]
  setTimeout(() => forceWindowsTopmost(wins), 50)
}

/** Couple two windows so dragging either one moves both. Tracks the
 *  initial offset between them and propagates every position change while
 *  guarding against the feedback loop that would otherwise have each
 *  window's move event re-trigger the other's. */
function linkToolbarDrag(a: BrowserWindow, b: BrowserWindow): () => void {
  const initial = b.getBounds()
  const aInit = a.getBounds()
  // b.position relative to a.position. Stays constant for the rest of the
  // session — when a moves by (dx, dy), b moves by (dx, dy) too, so the
  // offset is invariant and we can just recompute b.x = a.x + offsetX.
  const offsetX = initial.x - aInit.x
  const offsetY = initial.y - aInit.y

  let suppressing = false

  const onMoveA = () => {
    if (suppressing) return
    if (a.isDestroyed() || b.isDestroyed()) return
    const ab = a.getBounds()
    const bb = b.getBounds()
    const targetX = ab.x + offsetX
    const targetY = ab.y + offsetY
    if (bb.x === targetX && bb.y === targetY) return
    suppressing = true
    b.setPosition(targetX, targetY, false)
    // Release after the next tick so the synthetic move fires while we're
    // still suppressing, but a real subsequent user drag isn't blocked.
    setImmediate(() => { suppressing = false })
  }
  const onMoveB = () => {
    if (suppressing) return
    if (a.isDestroyed() || b.isDestroyed()) return
    const ab = a.getBounds()
    const bb = b.getBounds()
    const targetX = bb.x - offsetX
    const targetY = bb.y - offsetY
    if (ab.x === targetX && ab.y === targetY) return
    suppressing = true
    a.setPosition(targetX, targetY, false)
    setImmediate(() => { suppressing = false })
  }

  a.on('move', onMoveA)
  b.on('move', onMoveB)
  return () => {
    if (!a.isDestroyed()) a.off('move', onMoveA)
    if (!b.isDestroyed()) b.off('move', onMoveB)
  }
}

/** Direct Win32 SetWindowPos(HWND_TOPMOST) on each window's HWND. Other
 *  platforms rely on the `screen-saver` setAlwaysOnTop level alone, which
 *  is well-respected by macOS and Linux window managers. */
function forceWindowsTopmost(wins: (BrowserWindow | null)[]) {
  if (process.platform !== 'win32') return
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const SetWindowPos = user32.func(
      'bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)',
    )
    const HWND_TOPMOST = -1
    const SWP_NOMOVE = 0x0002
    const SWP_NOSIZE = 0x0001
    const SWP_NOACTIVATE = 0x0010
    const flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
    for (const w of wins) {
      if (!w || w.isDestroyed()) continue
      // HWND is a pointer — 8 bytes on x64 / arm64 Windows, 4 bytes on x86.
      // BrowserWindow.getNativeWindowHandle returns a Buffer of that size.
      const buf = w.getNativeWindowHandle()
      const hwnd = buf.length >= 8 ? buf.readBigInt64LE(0) : BigInt(buf.readInt32LE(0))
      SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, flags)
    }
  } catch (err) {
    console.warn('[annotation] SetWindowPos call failed', err)
  }
}

/** Toggle the palette off without erasing the strokes the user has
 *  already drawn. The overlay window stays alive but flips to
 *  click-through so the user can interact with the recorded app
 *  underneath while their annotations remain visible (and being
 *  recorded). Strokes only go away on destroyAnnotation(). */
export function closeAnnotation() {
  if (dragLinkCleanup) { dragLinkCleanup(); dragLinkCleanup = null }
  if (toolbarWin && !toolbarWin.isDestroyed()) {
    try { toolbarWin.close() } catch { /* ignore */ }
  }
  toolbarWin = null
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.setIgnoreMouseEvents(true, { forward: true })
  }
}

/** Tear down everything — overlay included. Called from
 *  closeRecordingSession when the recording stops or is cancelled. */
export function destroyAnnotation() {
  if (dragLinkCleanup) { dragLinkCleanup(); dragLinkCleanup = null }
  for (const w of [overlayWin, toolbarWin]) {
    if (w && !w.isDestroyed()) {
      try { w.close() } catch { /* ignore */ }
    }
  }
  overlayWin = null
  toolbarWin = null
}

export function setupAnnotation() {
  ipcMain.handle('annotation:get-state', () => state)

  ipcMain.handle('annotation:set-tool', (_e, tool: AnnotationState['tool']) => {
    state.tool = tool
    // tool === 'none' means the user wants to interact with the recorded
    // app, not draw — flip the overlay to click-through so clicks fall
    // through to whatever's behind it. Picking any actual drawing tool
    // brings click capture back so the next stroke lands on the canvas.
    if (overlayWin && !overlayWin.isDestroyed()) {
      if (tool === 'none') overlayWin.setIgnoreMouseEvents(true, { forward: true })
      else overlayWin.setIgnoreMouseEvents(false)
    }
    sendToOverlay('annotation:state', state)
  })
  ipcMain.handle('annotation:set-color', (_e, color: string) => {
    state.color = color
    sendToOverlay('annotation:state', state)
  })
  ipcMain.handle('annotation:set-stroke', (_e, strokeWidth: number) => {
    state.strokeWidth = strokeWidth
    sendToOverlay('annotation:state', state)
  })
  ipcMain.handle('annotation:clear', () => sendToOverlay('annotation:clear'))
  ipcMain.handle('annotation:undo', () => sendToOverlay('annotation:undo'))

  // The toolbar's close button — same effect as the recording-toolbar's
  // Annotate toggle going off. Tear down the annotation windows and
  // notify every BrowserWindow via the recording-toolbar:state channel
  // so the Annotate button on the recording toolbar reflects the new
  // state without requiring it to subscribe to a separate channel.
  ipcMain.handle('annotation:close', () => {
    closeAnnotation()
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('toolbar:state', { annotationOn: false })
    }
  })
}
