import type { UploadResult } from '../types'

export async function uploadToCustom(
  imageData: string,
  url: string,
  headers: Record<string, string> = {},
  fieldName = 'file'
): Promise<UploadResult> {
  if (!/^https?:\/\//i.test(url)) {
    return { destination: url, success: false, error: 'Invalid upload URL — only http/https allowed' }
  }

  const base64 = imageData.replace(/^data:image\/\w+;base64,/, '')
  const buffer = Buffer.from(base64, 'base64')
  const blob = new Blob([buffer], { type: 'image/png' })

  const formData = new FormData()
  formData.append(fieldName, blob, 'capture.png')

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: formData
  })

  if (!response.ok) {
    const text = await response.text()
    return { destination: url, success: false, error: `HTTP ${response.status}: ${text}` }
  }

  // Try to parse URL from response
  let responseUrl: string | undefined
  try {
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const json = await response.json() as Record<string, unknown>
      responseUrl = (json.url ?? json.link ?? json.data) as string | undefined
    } else {
      const text = await response.text()
      if (/^https?:\/\//i.test(text.trim())) responseUrl = text.trim()
    }
  } catch { /* ignore */ }

  return { destination: url, success: true, url: responseUrl }
}
