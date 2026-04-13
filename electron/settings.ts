import Store from 'electron-store'
import { homedir } from 'os'
import { join } from 'path'

export interface AppSettings {
  imgurClientId: string
  defaultSavePath: string
  customUploadUrl: string
  customUploadHeaders: Record<string, string>
  customUploadFieldName: string
  theme: 'dark' | 'light'
  activeWorkflowId: string
  lastSeenReleaseVersion: string
  googleDriveRefreshToken: string
  googleDriveAccessToken: string
  googleDriveTokenExpiresAt: number
  googleDriveFolderId: string
}

const store = new Store<AppSettings>({
  name: 'settings',
  defaults: {
    imgurClientId: '',
    defaultSavePath: join(homedir(), 'Downloads'),
    customUploadUrl: '',
    customUploadHeaders: {},
    customUploadFieldName: 'file',
    theme: 'dark',
    activeWorkflowId: '',
    lastSeenReleaseVersion: '',
    googleDriveRefreshToken: '',
    googleDriveAccessToken: '',
    googleDriveTokenExpiresAt: 0,
    googleDriveFolderId: ''
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
    googleDriveFolderId: store.get('googleDriveFolderId')
  }
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  store.set(key, value)
}
