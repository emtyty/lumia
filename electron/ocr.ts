import { app, nativeImage } from 'electron'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import type { OcrWord } from './types'

// ── macOS: Apple Vision via compiled Swift binary ────────────────

function getVisionBinaryPath(): string {
  // In dev: electron/helpers/ocr-vision
  // In production: resources/ocr-vision
  const devPath = resolve(__dirname, '..', 'electron', 'helpers', 'ocr-vision')
  if (existsSync(devPath)) return devPath

  const prodPath = join(process.resourcesPath ?? app.getAppPath(), 'ocr-vision')
  if (existsSync(prodPath)) return prodPath

  // Try relative to __dirname (built output)
  const builtPath = resolve(__dirname, '..', '..', 'electron', 'helpers', 'ocr-vision')
  if (existsSync(builtPath)) return builtPath

  throw new Error('ocr-vision binary not found')
}

async function ocrMacOS(imageBuffer: Buffer): Promise<OcrWord[]> {
  const tmpPath = join(tmpdir(), `lumia-ocr-${randomUUID()}.png`)
  writeFileSync(tmpPath, imageBuffer)

  try {
    const binaryPath = getVisionBinaryPath()
    const img = nativeImage.createFromBuffer(imageBuffer)
    const { width, height } = img.getSize()

    const output = await new Promise<string>((resolve, reject) => {
      execFile(binaryPath, [tmpPath], { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message))
        else resolve(stdout)
      })
    })

    const results: Array<{ text: string; x: number; y: number; width: number; height: number; confidence: number }> = JSON.parse(output)

    return results.map(item => ({
      text: item.text,
      bbox: {
        // Vision framework uses bottom-left origin with normalized 0-1 coords
        x: Math.round(item.x * width),
        y: Math.round((1 - item.y - item.height) * height),
        width: Math.round(item.width * width),
        height: Math.round(item.height * height)
      },
      confidence: item.confidence
    }))
  } finally {
    try { unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}

// ── Windows: WinRT OCR ──────────────────────────────────────────

async function ocrWindows(imageBuffer: Buffer): Promise<OcrWord[]> {
  const { recognize } = await import('node-windows-ocr')

  const tmpPath = join(tmpdir(), `lumia-ocr-${randomUUID()}.png`)
  writeFileSync(tmpPath, imageBuffer)

  try {
    const result = await recognize(tmpPath)
    const img = nativeImage.createFromBuffer(imageBuffer)
    const { width, height } = img.getSize()

    const words: OcrWord[] = []
    if (result.lines) {
      for (const line of result.lines) {
        for (const word of line.words) {
          words.push({
            text: word.text,
            bbox: {
              x: Math.round(word.rect.x * width),
              y: Math.round(word.rect.y * height),
              width: Math.round(word.rect.width * width),
              height: Math.round(word.rect.height * height)
            },
            confidence: word.confidence ?? 1
          })
        }
      }
    }
    return words
  } finally {
    try { unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}

// ── Tesseract.js fallback ───────────────────────────────────────

async function ocrTesseract(imageBuffer: Buffer): Promise<OcrWord[]> {
  const Tesseract = await import('tesseract.js')
  const worker = await Tesseract.createWorker('eng')

  try {
    // v7: must pass { blocks: true } as 3rd arg to get word-level bboxes
    const { data } = await worker.recognize(imageBuffer, {}, { blocks: true })
    const words: OcrWord[] = []

    // Traverse blocks → paragraphs → lines → words
    if (data.blocks) {
      for (const block of data.blocks) {
        if (!block.paragraphs) continue
        for (const para of block.paragraphs) {
          if (!para.lines) continue
          for (const line of para.lines) {
            if (!line.words) continue
            for (const w of line.words) {
              words.push({
                text: w.text,
                bbox: {
                  x: w.bbox.x0,
                  y: w.bbox.y0,
                  width: w.bbox.x1 - w.bbox.x0,
                  height: w.bbox.y1 - w.bbox.y0
                },
                confidence: w.confidence / 100
              })
            }
          }
        }
      }
    }

    return words
  } finally {
    await worker.terminate()
  }
}

// ── Public API ───────────────────────────────────────────────────

let nativeAvailable: boolean | null = null

async function checkNativeOcr(): Promise<boolean> {
  if (nativeAvailable !== null) return nativeAvailable

  try {
    if (process.platform === 'darwin') {
      getVisionBinaryPath() // throws if binary not found
      nativeAvailable = true
    } else if (process.platform === 'win32') {
      await import('node-windows-ocr')
      nativeAvailable = true
    } else {
      nativeAvailable = false
    }
  } catch {
    nativeAvailable = false
  }
  return nativeAvailable
}

/**
 * Run OCR on an image buffer (PNG). Returns words with pixel bounding boxes.
 * macOS: Apple Vision (native binary), Windows: WinRT, fallback: Tesseract.js
 */
export async function runOcr(imageBuffer: Buffer): Promise<OcrWord[]> {
  const hasNative = await checkNativeOcr()

  if (hasNative) {
    try {
      if (process.platform === 'darwin') return await ocrMacOS(imageBuffer)
      if (process.platform === 'win32') return await ocrWindows(imageBuffer)
    } catch (err) {
      console.warn('[OCR] Native OCR failed, falling back to Tesseract.js:', err)
      nativeAvailable = false
    }
  }

  return ocrTesseract(imageBuffer)
}

/**
 * Convert a data URL to a PNG Buffer for OCR processing.
 */
export function dataUrlToBuffer(dataUrl: string): Buffer {
  const img = nativeImage.createFromDataURL(dataUrl)
  return img.toPNG()
}
