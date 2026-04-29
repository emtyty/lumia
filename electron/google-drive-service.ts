// Bridges the pure HTTP uploaders in `uploaders/googledrive` with the app's
// settings store: refreshes the access token if it's about to expire, falls
// back to the user's default Drive folder, and surfaces every failure as an
// `UploadResult` so callers (workflow engine, video IPC) can render errors
// inline without try/catch boilerplate.
import type { UploadResult } from './types'
import { getSettings, setSetting } from './settings'
import {
  refreshGoogleToken,
  uploadToGoogleDrive,
  uploadFileToGoogleDrive,
} from './uploaders/googledrive'

type Resolved<T> = { value: T } | { error: string }

async function ensureAccessToken(): Promise<Resolved<string>> {
  const settings = getSettings()
  let { googleDriveAccessToken } = settings
  const { googleDriveRefreshToken, googleDriveTokenExpiresAt } = settings
  const clientId = import.meta.env.MAIN_VITE_GDRIVE_CLIENT_ID
  const clientSecret = import.meta.env.MAIN_VITE_GDRIVE_CLIENT_SECRET

  if (googleDriveRefreshToken && Date.now() >= googleDriveTokenExpiresAt - 60_000) {
    try {
      const refreshed = await refreshGoogleToken(clientId, clientSecret, googleDriveRefreshToken)
      googleDriveAccessToken = refreshed.accessToken
      setSetting('googleDriveAccessToken', refreshed.accessToken)
      setSetting('googleDriveTokenExpiresAt', refreshed.expiresAt)
    } catch (err) {
      return { error: `Token refresh failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
  return { value: googleDriveAccessToken }
}

function resolveFolder(folderId?: string): Resolved<string> {
  const folder = folderId || getSettings().googleDriveFolderId
  if (!folder) return { error: 'No Drive folder selected — choose one in Settings → Google Drive.' }
  return { value: folder }
}

function fail(error: string): UploadResult {
  return { destination: 'google-drive', success: false, error }
}

/** Upload an image data URL via multipart upload (≤5 MB). */
export async function uploadImageDataUrlToDrive(imageData: string, folderId?: string): Promise<UploadResult> {
  const token = await ensureAccessToken()
  if ('error' in token) return fail(token.error)
  const folder = resolveFolder(folderId)
  if ('error' in folder) return fail(folder.error)
  return uploadToGoogleDrive(imageData, token.value, folder.value)
}

/** Upload an arbitrary file buffer (used for video recordings) via the
 *  resumable upload protocol so it isn't capped at 5 MB. */
export async function uploadFileBufferToDrive(
  buffer: Buffer,
  contentType: string,
  filename: string,
  folderId?: string
): Promise<UploadResult> {
  const token = await ensureAccessToken()
  if ('error' in token) return fail(token.error)
  const folder = resolveFolder(folderId)
  if ('error' in folder) return fail(folder.error)
  return uploadFileToGoogleDrive(buffer, contentType, filename, token.value, folder.value)
}
