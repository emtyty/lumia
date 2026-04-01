import type { UploadResult } from '../types'

const IMGUR_API = 'https://api.imgur.com/3/image'
const DEFAULT_CLIENT_ID = 'f0ea04148a54268' // anonymous public client-id fallback

export async function uploadToImgur(imageData: string, clientId?: string): Promise<UploadResult> {
  const id = clientId && clientId.trim() ? clientId.trim() : DEFAULT_CLIENT_ID
  const base64 = imageData.replace(/^data:image\/\w+;base64,/, '')

  const formData = new FormData()
  formData.append('image', base64)
  formData.append('type', 'base64')

  const response = await fetch(IMGUR_API, {
    method: 'POST',
    headers: { Authorization: `Client-ID ${id}` },
    body: formData
  })

  if (!response.ok) {
    const text = await response.text()
    return { destination: 'imgur', success: false, error: `HTTP ${response.status}: ${text}` }
  }

  const json = await response.json() as { success: boolean; data: { link: string } }
  if (!json.success) {
    return { destination: 'imgur', success: false, error: 'Imgur returned success=false' }
  }

  return { destination: 'imgur', success: true, url: json.data.link }
}
