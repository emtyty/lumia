/**
 * Native Win32 input simulation via koffi FFI.
 * Replaces PowerShell-based scroll/key simulation with direct user32.dll calls.
 * ~0ms overhead per call vs ~200-500ms PowerShell cold start.
 *
 * Only loaded on Windows — macOS uses the existing Swift scroll helper.
 */

// ── Win32 constants ──────────────────────────────────────────────────────

export const MOUSEEVENTF_WHEEL = 0x0800
export const KEYEVENTF_KEYUP = 0x0002

export const VK_CONTROL = 0x11
export const VK_HOME = 0x24
export const VK_DOWN = 0x28
export const VK_NEXT = 0x22 // Page Down
export const VK_UP = 0x26

export const WM_VSCROLL = 0x0115
export const SB_LINEDOWN = 1
export const SB_TOP = 6

// ── koffi bindings (lazy-loaded) ─────────────────────────────────────────

let _loaded = false
let _SetCursorPos: (x: number, y: number) => boolean
let _mouse_event: (flags: number, dx: number, dy: number, data: number, extra: number) => void
let _keybd_event: (vk: number, scan: number, flags: number, extra: number) => void
let _SendMessageW: (hwnd: any, msg: number, wParam: any, lParam: any) => any
let _WindowFromPoint: (pt: { x: number; y: number }) => any
let _ScreenToClient: (hwnd: any, pt: { x: number; y: number }) => boolean
let _ChildWindowFromPointEx: (hwnd: any, pt: { x: number; y: number }, flags: number) => any
let _SetForegroundWindow: (hwnd: any) => boolean

function ensureLoaded(): boolean {
  if (_loaded) return true
  if (process.platform !== 'win32') return false

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi')

    // Define POINT struct for WindowFromPoint / ScreenToClient
    const POINT = koffi.struct('POINT', { x: 'int', y: 'int' })

    const user32 = koffi.load('user32.dll')

    _SetCursorPos = user32.func('bool __stdcall SetCursorPos(int x, int y)')
    _mouse_event = user32.func('void __stdcall mouse_event(int dwFlags, int dx, int dy, int dwData, uintptr_t dwExtraInfo)')
    _keybd_event = user32.func('void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)')
    _SendMessageW = user32.func('intptr_t __stdcall SendMessageW(intptr_t hWnd, uint32_t Msg, intptr_t wParam, intptr_t lParam)')
    _WindowFromPoint = user32.func('intptr_t __stdcall WindowFromPoint(POINT pt)')
    _ScreenToClient = user32.func('bool __stdcall ScreenToClient(intptr_t hWnd, _Inout_ POINT *pt)')
    _ChildWindowFromPointEx = user32.func('intptr_t __stdcall ChildWindowFromPointEx(intptr_t hWnd, POINT pt, uint32_t flags)')
    _SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(intptr_t hWnd)')

    _loaded = true
    console.log('[native-input] koffi bindings loaded successfully')
    return true
  } catch (err) {
    console.warn('[native-input] koffi failed to load, will fall back to PowerShell:', err)
    return false
  }
}

/** Check if native input is available (koffi loaded on Windows) */
export function isNativeAvailable(): boolean {
  return ensureLoaded()
}

// ── Low-level functions ──────────────────────────────────────────────────

export function setCursorPos(x: number, y: number): boolean {
  if (!ensureLoaded()) return false
  return _SetCursorPos(Math.round(x), Math.round(y))
}

export function mouseEvent(flags: number, dx: number, dy: number, data: number): void {
  if (!ensureLoaded()) return
  _mouse_event(flags, dx, dy, data, 0)
}

export function keybdEvent(vk: number, scan: number, flags: number): void {
  if (!ensureLoaded()) return
  _keybd_event(vk, scan, flags, 0)
}

export function sendMessage(hwnd: any, msg: number, wParam: any, lParam: any): any {
  if (!ensureLoaded()) return 0
  return _SendMessageW(hwnd, msg, wParam, lParam)
}

export function windowFromPoint(x: number, y: number): any {
  if (!ensureLoaded()) return 0
  return _WindowFromPoint({ x: Math.round(x), y: Math.round(y) })
}

export function childWindowFromPointEx(hwnd: any, x: number, y: number, flags: number): any {
  if (!ensureLoaded()) return 0
  const pt = { x: Math.round(x), y: Math.round(y) }
  _ScreenToClient(hwnd, pt)
  return _ChildWindowFromPointEx(hwnd, pt, flags)
}

// ── High-level helpers ───────────────────────────────────────────────────

/** Send a single key press (key down + key up) */
export function sendKeyPress(vk: number): void {
  keybdEvent(vk, 0, 0) // key down
  keybdEvent(vk, 0, KEYEVENTF_KEYUP) // key up
}

/** Send mouse wheel scroll at current cursor position */
export function scrollMouseWheel(cx: number, cy: number, wheelDelta: number): void {
  setCursorPos(cx, cy)
  mouseEvent(MOUSEEVENTF_WHEEL, 0, 0, wheelDelta)
}

/** Send WM_VSCROLL SB_LINEDOWN to the window under (cx, cy) */
export function scrollVScroll(cx: number, cy: number, lines: number): void {
  const hwnd = windowFromPoint(cx, cy)
  if (!hwnd) return
  // Try to find child window for better targeting
  const child = childWindowFromPointEx(hwnd, cx, cy, 1) // CWP_SKIPINVISIBLE
  const target = (child && child !== hwnd) ? child : hwnd
  for (let i = 0; i < lines; i++) {
    sendMessage(target, WM_VSCROLL, SB_LINEDOWN, 0)
  }
}

/** Send Down Arrow key press repeated `count` times */
export function scrollDownArrow(count: number): void {
  for (let i = 0; i < count; i++) {
    sendKeyPress(VK_DOWN)
  }
}

/** Send Page Down key press */
export function scrollPageDown(): void {
  sendKeyPress(VK_NEXT)
}

/** Scroll to top: Ctrl+Home key + WM_VSCROLL SB_TOP to window under cursor */
export function scrollToTopNative(cx: number, cy: number): void {
  // Send Ctrl+Home
  keybdEvent(VK_CONTROL, 0, 0)
  keybdEvent(VK_HOME, 0, 0)
  keybdEvent(VK_HOME, 0, KEYEVENTF_KEYUP)
  keybdEvent(VK_CONTROL, 0, KEYEVENTF_KEYUP)
  // Also send WM_VSCROLL SB_TOP to the window under cursor
  const hwnd = windowFromPoint(cx, cy)
  if (hwnd) {
    sendMessage(hwnd, WM_VSCROLL, SB_TOP, 0)
  }
}
