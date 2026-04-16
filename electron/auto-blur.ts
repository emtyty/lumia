import { nativeImage } from 'electron'
import { runOcr, dataUrlToBuffer } from './ocr'
import { detectSensitiveData } from './sensitive-detect'
import type { AutoBlurResult, AutoBlurSettings, SensitiveCategory, SensitiveRegion } from './types'

const DEFAULT_SETTINGS: AutoBlurSettings = {
  enabled: true,
  autoBlurOnCapture: 'off',
  categories: {
    'email': true,
    'phone': true,
    'credit-card': true,
    'ssn': true,
    'api-key': true,
    'jwt': true,
    'private-key': true,
    'password': true,
    'bearer-token': true,
    'ip-address': true,
    'url-credentials': true
  },
  blurIntensity: 10
}

/**
 * Scan an image (data URL) for sensitive information.
 * Returns detected regions with bounding boxes — does NOT apply blur.
 */
export async function scanForSensitiveData(
  dataUrl: string,
  settings?: Partial<AutoBlurSettings>
): Promise<AutoBlurResult> {
  const config = { ...DEFAULT_SETTINGS, ...settings }
  const enabledCategories = new Set(
    (Object.entries(config.categories) as [SensitiveCategory, boolean][])
      .filter(([, enabled]) => enabled)
      .map(([cat]) => cat)
  )

  const buffer = dataUrlToBuffer(dataUrl)

  // Step 1: OCR
  const ocrStart = performance.now()
  const words = await runOcr(buffer)
  const ocrTimeMs = Math.round(performance.now() - ocrStart)

  // Step 2: Regex detection
  const detectStart = performance.now()
  const regions = detectSensitiveData(words, enabledCategories)
  const detectTimeMs = Math.round(performance.now() - detectStart)

  return { regions, ocrTimeMs, detectTimeMs }
}

/**
 * Apply pixelation blur to specific regions of an image.
 * Returns a new data URL with the regions blurred.
 * Uses Electron's nativeImage for pixel manipulation.
 */
export async function applyBlurToImage(
  dataUrl: string,
  regions: SensitiveRegion[],
  blockSize: number = 10
): Promise<string> {
  if (regions.length === 0) return dataUrl

  const img = nativeImage.createFromDataURL(dataUrl)
  const { width, height } = img.getSize()
  const bitmap = img.toBitmap()

  // Apply pixelation to each region
  for (const region of regions) {
    const { x, y, width: rw, height: rh } = region.bbox

    // Clamp region to image bounds
    const x0 = Math.max(0, Math.round(x))
    const y0 = Math.max(0, Math.round(y))
    const x1 = Math.min(width, Math.round(x + rw))
    const y1 = Math.min(height, Math.round(y + rh))

    // Pixelate: for each blockSize×blockSize block, average the colors
    for (let by = y0; by < y1; by += blockSize) {
      for (let bx = x0; bx < x1; bx += blockSize) {
        const bx1 = Math.min(bx + blockSize, x1)
        const by1 = Math.min(by + blockSize, y1)
        let r = 0, g = 0, b = 0, a = 0, count = 0

        // Average pixel values in block
        for (let py = by; py < by1; py++) {
          for (let px = bx; px < bx1; px++) {
            const idx = (py * width + px) * 4
            r += bitmap[idx]
            g += bitmap[idx + 1]
            b += bitmap[idx + 2]
            a += bitmap[idx + 3]
            count++
          }
        }

        if (count === 0) continue
        r = Math.round(r / count)
        g = Math.round(g / count)
        b = Math.round(b / count)
        a = Math.round(a / count)

        // Fill block with averaged color
        for (let py = by; py < by1; py++) {
          for (let px = bx; px < bx1; px++) {
            const idx = (py * width + px) * 4
            bitmap[idx] = r
            bitmap[idx + 1] = g
            bitmap[idx + 2] = b
            bitmap[idx + 3] = a
          }
        }
      }
    }
  }

  const result = nativeImage.createFromBitmap(bitmap, { width, height })
  return result.toDataURL()
}
