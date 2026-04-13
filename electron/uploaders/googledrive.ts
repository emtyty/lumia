import type { UploadResult } from '../types'

const GOOGLE_DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'

/** Returns true if the string looks like a real Drive file ID (not a folder name) */
function looksLikeDriveId(s: string): boolean {
  return /^[a-zA-Z0-9_-]{20,}$/.test(s)
}

/** Find folder by name, returns its ID or null */
async function findFolderByName(name: string, accessToken: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (!res.ok) return null
  const json = await res.json() as { files: { id: string }[] }
  return json.files[0]?.id ?? null
}

/** Create a folder and return its ID */
async function createFolder(name: string, accessToken: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' })
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to create folder: ${text}`)
  }
  const json = await res.json() as { id: string }
  return json.id
}

export async function uploadToGoogleDrive(
  imageData: string,
  accessToken: string,
  folderId?: string
): Promise<UploadResult> {
  if (!accessToken) {
    return { destination: 'google-drive', success: false, error: 'No access token — please connect Google Drive in Settings' }
  }

  // If folderId looks like a folder name (not a Drive ID), resolve it
  let resolvedFolderId = folderId
  if (folderId && !looksLikeDriveId(folderId)) {
    try {
      const found = await findFolderByName(folderId, accessToken)
      resolvedFolderId = found ?? await createFolder(folderId, accessToken)
    } catch (err) {
      return { destination: 'google-drive', success: false, error: `Folder error: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  const base64 = imageData.replace(/^data:image\/\w+;base64,/, '')
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `capture-${ts}.png`

  // Build multipart/related body per Google Drive API v3
  const metadata: Record<string, unknown> = {
    name: filename,
    mimeType: 'image/png'
  }
  if (resolvedFolderId) {
    metadata.parents = [resolvedFolderId]
  }

  const boundary = '----LumiaDriveBoundary'
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: image/png\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64}\r\n` +
    `--${boundary}--`

  const response = await fetch(GOOGLE_DRIVE_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  })

  if (!response.ok) {
    const text = await response.text()
    return { destination: 'google-drive', success: false, error: `HTTP ${response.status}: ${text}` }
  }

  const json = await response.json() as { id: string; name: string }
  const viewUrl = `https://drive.google.com/file/d/${json.id}/view`

  return { destination: 'google-drive', success: true, url: viewUrl }
}

/**
 * Exchange an authorization code for tokens using Google OAuth2.
 */
export async function exchangeGoogleAuthCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token exchange failed: ${text}`)
  }

  const json = await response.json() as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? '',
    expiresAt: Date.now() + json.expires_in * 1000
  }
}

/**
 * Refresh an expired access token.
 */
export async function refreshGoogleToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: number }> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token refresh failed: ${text}`)
  }

  const json = await response.json() as { access_token: string; expires_in: number }

  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000
  }
}
