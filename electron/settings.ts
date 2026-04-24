import Store from 'electron-store'
import { access } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

export interface AppSettings {
  imgurClientId: string
  defaultSavePath: string
  customUploadUrl: string
  customUploadHeaders: Record<string, string>
  customUploadFieldName: string
  theme: 'dark' | 'light' | 'system'
  activeWorkflowId: string
  lastSeenReleaseVersion: string
  googleDriveRefreshToken: string
  googleDriveAccessToken: string
  googleDriveTokenExpiresAt: number
  googleDriveFolderId: string
  launchAtStartup: boolean
  historyRetentionDays: number
}

const store = new Store<AppSettings>({
  name: 'settings',
  defaults: {
    imgurClientId: '',
    defaultSavePath: join(homedir(), 'Downloads'),
    customUploadUrl: '',
    customUploadHeaders: {},
    customUploadFieldName: 'file',
    theme: 'system',
    activeWorkflowId: 'builtin-r2',
    lastSeenReleaseVersion: '',
    googleDriveRefreshToken: '',
    googleDriveAccessToken: '',
    googleDriveTokenExpiresAt: 0,
    googleDriveFolderId: '',
    launchAtStartup: true,
    historyRetentionDays: 0
  }
})

export function getSettings(): AppSettings {
  return {
    imgurClientId: store.get('imgurClientId'),
    defaultSavePath: store.get('defaultSavePath'),
    customUploadUrl: store.get('customUploadUrl'),
    customUploadHeaders: store.get('customUploadHeaders'),
    customUploadFieldName: store.get('customUploadFieldName'),
    theme: store.get('theme'),
    activeWorkflowId: store.get('activeWorkflowId'),
    lastSeenReleaseVersion: store.get('lastSeenReleaseVersion'),
    googleDriveRefreshToken: store.get('googleDriveRefreshToken'),
    googleDriveAccessToken: store.get('googleDriveAccessToken'),
    googleDriveTokenExpiresAt: store.get('googleDriveTokenExpiresAt'),
    googleDriveFolderId: store.get('googleDriveFolderId'),
    launchAtStartup: store.get('launchAtStartup'),
    historyRetentionDays: store.get('historyRetentionDays')
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
