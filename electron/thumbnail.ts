import { nativeImage } from 'electron'

// Shrink a data-URL image to a lightweight thumbnail for history.json.
// Full-resolution base64 bloats the store quickly; we keep only a small JPEG
// for UI display and rely on `filePath` for any non-display usage.
// Returns the original dataUrl on failure — thumbnails are display-only so
// the fallback is always safe.
export function makeThumbnail(dataUrl: string, maxWidth = 300, quality = 60): string {
  try {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return dataUrl
    const img = nativeImage.createFromDataURL(dataUrl)
    if (img.isEmpty()) return dataUrl
    const { width } = img.getSize()
    const resized = width > maxWidth ? img.resize({ width: maxWidth, quality: 'good' }) : img
    const buf = resized.toJPEG(quality)
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  } catch {
    return dataUrl
  }
}
