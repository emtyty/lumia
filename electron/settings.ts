import Store from 'electron-store'
import { access } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

export type CaptureKind = 'image' | 'video'
export type LastImageMode = 'region' | 'window' | 'all-screen' | 'screen' | 'scrolling'
export type LastVideoMode = 'region' | 'window' | 'screen'

export interface AppSettings {
  defaultSavePath: string
  theme: 'dark' | 'light' | 'system'
  activeWorkflowId: string
  lastSeenReleaseVersion: string
  googleDriveRefreshToken: string
  googleDriveAccessToken: string
  googleDriveTokenExpiresAt: number
  googleDriveFolderId: string
  launchAtStartup: boolean
  historyRetentionDays: number
  lastCaptureKind: CaptureKind
  lastImageMode: LastImageMode
  lastVideoMode: LastVideoMode
  /** When true, the physical PrintScreen key is bound to "New Capture" via a
   *  globalShortcut, and on Windows the "PrintScreen opens Snipping Tool"
   *  registry hijack is turned off so the keystroke reaches us. The binding
   *  is fixed (PrintScreen only) — toggle on/off only, no rebinding. */
  printScreenAsCapture: boolean
  /** True once the first-run prompt asking the user whether to bind PrintScreen
   *  has been shown (and answered, either way). Used to suppress the prompt
   *  on subsequent launches. Also flipped to true whenever the user toggles
   *  printScreenAsCapture from Settings, so manual configuration counts as
   *  having been asked. */
  printScreenPromptShown: boolean
}

// On macOS, binding PrintScreen has no downside: built-in Apple keyboards
// don't have a PrtSc key (so the globalShortcut never fires unintentionally),
// the Windows registry hijack doesn't exist (setSnippingHijack is a no-op),
// and external PC-style keyboards plugged into a Mac will Just Work. So
// default to enabled there and skip the first-run prompt entirely. On
// Windows it's opt-in via the dialog because flipping the registry value
// affects Snipping Tool, which the user might rely on.
const PRINT_SCREEN_DEFAULT = process.platform === 'darwin'

const store = new Store<AppSettings>({
  name: 'settings',
  defaults: {
    defaultSavePath: join(homedir(), 'Downloads'),
    theme: 'system',
    activeWorkflowId: 'builtin-r2',
    lastSeenReleaseVersion: '',
    googleDriveRefreshToken: '',
    googleDriveAccessToken: '',
    googleDriveTokenExpiresAt: 0,
    googleDriveFolderId: '',
    launchAtStartup: true,
    historyRetentionDays: 0,
    lastCaptureKind: 'image',
    lastImageMode: 'region',
    lastVideoMode: 'region',
    printScreenAsCapture: PRINT_SCREEN_DEFAULT,
    printScreenPromptShown: PRINT_SCREEN_DEFAULT
  }
})

// One-time migration of legacy mode IDs from older builds:
//   'fullscreen'     → 'all-screen'   (renamed to match the UI label)
//   'active-monitor' → 'screen'
// Run once at module load so getSettings always returns the current shape.
{
  const raw = store.get('lastImageMode') as string
  if (raw === 'fullscreen') store.set('lastImageMode', 'all-screen')
  else if (raw === 'active-monitor') store.set('lastImageMode', 'screen')
}

export function getSettings(): AppSettings {
  return {
    defaultSavePath: store.get('defaultSavePath'),
    theme: store.get('theme'),
    activeWorkflowId: store.get('activeWorkflowId'),
    lastSeenReleaseVersion: store.get('lastSeenReleaseVersion'),
    googleDriveRefreshToken: store.get('googleDriveRefreshToken'),
    googleDriveAccessToken: store.get('googleDriveAccessToken'),
    googleDriveTokenExpiresAt: store.get('googleDriveTokenExpiresAt'),
    googleDriveFolderId: store.get('googleDriveFolderId'),
    launchAtStartup: store.get('launchAtStartup'),
    historyRetentionDays: store.get('historyRetentionDays'),
    lastCaptureKind: store.get('lastCaptureKind'),
    lastImageMode: store.get('lastImageMode'),
    lastVideoMode: store.get('lastVideoMode'),
    printScreenAsCapture: store.get('printScreenAsCapture'),
    printScreenPromptShown: store.get('printScreenPromptShown')
  }
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  store.set(key, value)
}

// Resolves the directory the save dialog should open in: the last folder the
// user saved into if it's still accessible, otherwise Downloads. If the stored
// dir is gone, the setting is reset so the next call doesn't re-check it.
export async function resolveSaveStartDir(): Promise<string> {
  const downloads = join(homedir(), 'Downloads')
  const stored = store.get('defaultSavePath')
  if (!stored) return downloads
  try {
    await access(stored)
    return stored
  } catch {
    store.set('defaultSavePath', downloads)
    return downloads
  }
}

export function rememberSaveDir(dir: string): void {
  store.set('defaultSavePath', dir)
}
