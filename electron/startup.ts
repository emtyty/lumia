import { app } from 'electron'

const HIDDEN_FLAG = '--hidden'

export function applyLaunchAtStartup(enabled: boolean) {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return
  // In dev, skip — the entry would point at Electron's dev shell, not Lumia.
  if (!app.isPackaged) return
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    args: [HIDDEN_FLAG]
  })
}

export function wasLaunchedAtStartup(): boolean {
  if (process.platform === 'darwin') {
    return app.getLoginItemSettings().wasOpenedAtLogin
  }
  if (process.platform === 'win32') {
    return process.argv.includes(HIDDEN_FLAG)
  }
  return false
}
