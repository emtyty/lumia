import { ipcMain, app, desktopCapturer, screen, BrowserWindow } from 'electron'
import { execFile, execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { setTimeout as sleep } from 'timers/promises'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FFT = require('fft.js')

// ── Scroll simulation ──────────────────────────────────────────────────────

// Detect macOS natural scrolling once at startup (cached)
let _naturalScrolling: boolean | null = null
function isNaturalScrolling(): boolean {
  if (_naturalScrolling !== null) return _naturalScrolling
  try {
    const val = execFileSync('defaults', ['read', 'NSGlobalDomain', 'com.apple.swipescrolldirection'])
      .toString().trim()
    _naturalScrolling = val !== '0' // default is true (natural scrolling ON)
  } catch {
    _naturalScrolling = true
  }
  return _naturalScrolling
}

// Resolve path to compiled Swift scroll helper (macOS only)
function getScrollHelperPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'scroll-helper')
  }
  // Dev mode: binary is next to the .swift source
  return join(__dirname, '../../electron/helpers/scroll-helper')
}

/**
 * Send a scroll-wheel event at (cx, cy) — no focus required.
 * macOS: uses a compiled Swift helper (CGEventCreateScrollWheelEvent2)
 * Windows: uses PowerShell with SetCursorPos + mouse_event
 *
 * @param pixelDelta — optional custom scroll amount in pixels (macOS) or wheel
 *   notches (Windows, units of 120). When omitted, uses platform defaults.
 *   Positive = scroll content DOWN.
 */
function scrollAtPosition(cx: number, cy: number, pixelDelta?: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      const helper = getScrollHelperPath()
      if (!existsSync(helper)) {
        console.error('[scroll-capture] scroll-helper binary not found at', helper)
        resolve()
        return
      }

      // Pixel delta: negative = scroll content down (natural), positive = down (non-natural)
      const baseDelta = pixelDelta ?? 300
      const pxDelta = isNaturalScrolling() ? -baseDelta : baseDelta

      execFile(helper, [String(Math.round(cx)), String(Math.round(cy)), String(pxDelta)], (err, _stdout, stderr) => {
        if (err) console.warn('[scroll-capture] scroll-helper error:', err.message)
        if (stderr) console.warn('[scroll-capture] scroll-helper stderr:', stderr)
        resolve()
      })
    } else {
      // Windows: SetCursorPos then mouse_event WHEEL — no focus needed
      // -120 = one notch down. Scale proportionally if custom delta provided.
      const wheelDelta = pixelDelta != null ? -Math.round(pixelDelta / 300 * 120) : -120
      const ps = `
Add-Type @"
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);
}
"@
[Win32]::SetCursorPos(${Math.round(cx)}, ${Math.round(cy)})
Start-Sleep -Milliseconds 50
[Win32]::mouse_event(0x800, 0, 0, ${wheelDelta}, 0)
`
      execFile('powershell', ['-command', ps], () => resolve())
    }
  })
}

// ── Fixed header/footer detection ────────────────────────────────────────

/**
 * FNV-1a hash for a single row of RGBA bitmap data.
 * Fast, non-cryptographic hash suitable for row comparison.
 */
function fnv1aRowHash(bitmap: Buffer, rowIndex: number, width: number): number {
  const bytesPerRow = width * 4
  const start = rowIndex * bytesPerRow
  const end = start + bytesPerRow
  let hash = 0x811c9dc5 // FNV offset basis (32-bit)
  for (let i = start; i < end; i++) {
    hash ^= bitmap[i]
    hash = (hash * 0x01000193) >>> 0 // FNV prime, keep as uint32
  }
  return hash
}

/**
 * Compute per-channel mean-absolute-error between two rows.
 * Returns a similarity score in [0, 1] where 1 = identical.
 */
function rowSimilarity(
  bitmapA: Buffer, rowA: number,
  bitmapB: Buffer, rowB: number,
  width: number
): number {
  const bytesPerRow = width * 4
  const startA = rowA * bytesPerRow
  const startB = rowB * bytesPerRow
  let totalDiff = 0
  // Sample every 4th pixel for performance
  const colStep = Math.max(1, Math.floor(width / 64))
  let samples = 0
  for (let col = 0; col < width; col += colStep) {
    const offA = startA + col * 4
    const offB = startB + col * 4
    totalDiff += Math.abs(bitmapA[offA] - bitmapB[offB])
    totalDiff += Math.abs(bitmapA[offA + 1] - bitmapB[offB + 1])
    totalDiff += Math.abs(bitmapA[offA + 2] - bitmapB[offB + 2])
    samples++
  }
  if (samples === 0) return 0
  // max possible diff per sample = 255 * 3 = 765
  const avgDiff = totalDiff / samples
  return 1 - avgDiff / 765
}

/**
 * Detect fixed (sticky) header/footer regions by comparing row hashes across frames.
 * Rows that are pixel-identical across first, second, and last frames are considered fixed.
 *
 * Two-pass approach:
 * 1. Exact match: FNV-1a row hashes identical across all reference frames
 * 2. Tolerance fallback: similarity > 0.95 for semi-transparent/glassmorphism headers
 *
 * Returns pixel heights of detected fixed regions (in bitmap coordinates, already scaled).
 */
function detectFixedRegions(
  frames: Electron.NativeImage[],
  minRegionHeight: number = 10
): { topFixed: number; bottomFixed: number } {
  if (frames.length < 2) return { topFixed: 0, bottomFixed: 0 }

  // Use first, second, and last frames as reference
  const refIndices = [0, 1]
  if (frames.length > 2) refIndices.push(frames.length - 1)

  const bitmaps = refIndices.map(i => frames[i].toBitmap())
  const sizes = refIndices.map(i => frames[i].getSize())

  // All frames must have the same dimensions
  const width = sizes[0].width
  const height = sizes[0].height
  for (let i = 1; i < sizes.length; i++) {
    if (sizes[i].width !== width || sizes[i].height !== height) {
      return { topFixed: 0, bottomFixed: 0 }
    }
  }

  // --- Pass 1: exact hash matching ---
  // Precompute row hashes for each reference bitmap
  const hashes: number[][] = bitmaps.map(bmp => {
    const h: number[] = new Array(height)
    for (let row = 0; row < height; row++) {
      h[row] = fnv1aRowHash(bmp, row, width)
    }
    return h
  })

  // Scan from top: consecutive rows with identical hashes across all reference frames
  let topFixed = 0
  for (let row = 0; row < height; row++) {
    const baseHash = hashes[0][row]
    let allMatch = true
    for (let b = 1; b < hashes.length; b++) {
      if (hashes[b][row] !== baseHash) { allMatch = false; break }
    }
    if (allMatch) topFixed = row + 1
    else break
  }

  // Scan from bottom
  let bottomFixed = 0
  for (let row = height - 1; row >= topFixed; row--) {
    const baseHash = hashes[0][row]
    let allMatch = true
    for (let b = 1; b < hashes.length; b++) {
      if (hashes[b][row] !== baseHash) { allMatch = false; break }
    }
    if (allMatch) bottomFixed = height - row
    else break
  }

  // --- Pass 2: tolerance fallback for semi-transparent/glassmorphism headers ---
  // Only extend regions if the exact pass found less than minRegionHeight
  if (topFixed < minRegionHeight) {
    let tolerantTop = 0
    for (let row = 0; row < height; row++) {
      let allSimilar = true
      for (let b = 1; b < bitmaps.length; b++) {
        if (rowSimilarity(bitmaps[0], row, bitmaps[b], row, width) < 0.95) {
          allSimilar = false
          break
        }
      }
      if (allSimilar) tolerantTop = row + 1
      else break
    }
    topFixed = Math.max(topFixed, tolerantTop)
  }

  if (bottomFixed < minRegionHeight) {
    let tolerantBottom = 0
    for (let row = height - 1; row >= topFixed; row--) {
      let allSimilar = true
      for (let b = 1; b < bitmaps.length; b++) {
        if (rowSimilarity(bitmaps[0], row, bitmaps[b], row, width) < 0.95) {
          allSimilar = false
          break
        }
      }
      if (allSimilar) tolerantBottom = height - row
      else break
    }
    bottomFixed = Math.max(bottomFixed, tolerantBottom)
  }

  // Enforce minimum region height to avoid false positives from border lines
  if (topFixed < minRegionHeight) topFixed = 0
  if (bottomFixed < minRegionHeight) bottomFixed = 0

  return { topFixed, bottomFixed }
}

// ── Overlap detection ──────────────────────────────────────────────────────

/**
 * Score how well the bottom `overlapRows` rows of bitmapA
 * match the top `overlapRows` rows of bitmapB.
 * Returns a mismatch ratio (0 = perfect match, 1 = completely different).
 *
 * topSkip / bottomSkip: rows to exclude from comparison (fixed header/footer regions)
 * that would otherwise create false match signals.
 */
function overlapMismatch(
  bitmapA: Buffer, bitmapB: Buffer,
  width: number, height: number,
  step: number,
  topSkip: number = 0,
  bottomSkip: number = 0
): number {
  const bytesPerRow = width * 4
  const overlapRows = height - step
  if (overlapRows <= 0) return 1

  // Determine the effective row range to compare (skip fixed regions)
  const rowStart = topSkip
  const rowEnd = overlapRows - bottomSkip
  if (rowEnd <= rowStart) return 1

  let diffCount = 0
  let sampleCount = 0
  // Sample every 2nd row, every width/16 pixel — denser than before for accuracy
  const colStep = Math.max(1, Math.floor(width / 16))
  for (let row = rowStart; row < rowEnd; row += 2) {
    const rowAStart = (row + step) * bytesPerRow
    const rowBStart = row * bytesPerRow
    for (let col = 0; col < width; col += colStep) {
      const offA = rowAStart + col * 4
      const offB = rowBStart + col * 4
      sampleCount++
      if (
        Math.abs(bitmapA[offA] - bitmapB[offB]) > 8 ||
        Math.abs(bitmapA[offA + 1] - bitmapB[offB + 1]) > 8 ||
        Math.abs(bitmapA[offA + 2] - bitmapB[offB + 2]) > 8
      ) {
        diffCount++
      }
    }
  }
  return sampleCount === 0 ? 1 : diffCount / sampleCount
}

/**
 * Detect how many pixels scrolled between two frames using a two-pass SAD approach:
 * 1. Coarse pass: scan every 4th pixel to find candidate offsets
 * 2. Fine pass: refine the best candidate with single-pixel accuracy
 *
 * topSkip / bottomSkip: rows to exclude from overlap comparison (fixed header/footer).
 * Returns the best matching row offset, or `defaultStep` if no good match found.
 */
function detectScrollStepSAD(
  frameA: Electron.NativeImage,
  frameB: Electron.NativeImage,
  defaultStep: number,
  topSkip: number = 0,
  bottomSkip: number = 0
): number {
  try {
    const bitmapA = frameA.toBitmap()
    const bitmapB = frameB.toBitmap()
    const sizeA = frameA.getSize()
    const sizeB = frameB.getSize()

    if (sizeA.width !== sizeB.width || sizeA.height !== sizeB.height) return defaultStep

    const { width, height } = sizeA
    const minStep = 5
    const maxStep = Math.min(Math.floor(defaultStep * 2.5), height - 10)

    // Pass 1: coarse scan (every 4th step)
    let bestStep = defaultStep
    let bestScore = 1
    for (let step = minStep; step <= maxStep; step += 4) {
      const score = overlapMismatch(bitmapA, bitmapB, width, height, step, topSkip, bottomSkip)
      if (score < bestScore) {
        bestScore = score
        bestStep = step
      }
    }

    // Pass 2: fine-tune around the best coarse result (±6 pixels)
    const fineMin = Math.max(minStep, bestStep - 6)
    const fineMax = Math.min(maxStep, bestStep + 6)
    for (let step = fineMin; step <= fineMax; step++) {
      const score = overlapMismatch(bitmapA, bitmapB, width, height, step, topSkip, bottomSkip)
      if (score < bestScore) {
        bestScore = score
        bestStep = step
      }
    }

    // Only accept if mismatch is reasonably low (< 2%)
    if (bestScore < 0.02) return bestStep
  } catch {
    // bitmap comparison failed — use default
  }

  return defaultStep
}

// ── FFT-based phase correlation ─────────────────────────────────────────────

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

/**
 * Detect scroll step using FFT-based 1D phase correlation along sampled columns.
 * For vertical-only scroll, we compute cross-correlation of column vectors between
 * frames A and B, then find the peak which gives the vertical shift.
 *
 * Falls back to `defaultStep` if the result seems unreliable.
 */
function detectScrollStepFFT(
  frameA: Electron.NativeImage,
  frameB: Electron.NativeImage,
  defaultStep: number,
  topSkip: number = 0,
  bottomSkip: number = 0
): number {
  const bitmapA = frameA.toBitmap()
  const bitmapB = frameB.toBitmap()
  const { width, height } = frameA.getSize()

  // Content region (skip fixed header/footer)
  const startRow = topSkip
  const endRow = height - bottomSkip
  const contentH = endRow - startRow
  if (contentH < 32) return defaultStep

  // Next power of 2 for FFT
  const fftSize = nextPow2(contentH)
  const fft = new FFT(fftSize)

  // Sample columns (every width/32 columns, at least 1)
  const colStep = Math.max(1, Math.floor(width / 32))
  const bytesPerRow = width * 4

  // Accumulate cross-correlation across sampled columns
  const corrAccum = new Float64Array(fftSize)
  let numCols = 0

  for (let col = 0; col < width; col += colStep) {
    // Extract grayscale column vectors (zero-padded to fftSize)
    const colA = new Float64Array(fftSize)
    const colB = new Float64Array(fftSize)

    for (let row = startRow; row < endRow; row++) {
      const off = row * bytesPerRow + col * 4
      const grayA = (bitmapA[off] + bitmapA[off + 1] + bitmapA[off + 2]) / 3
      const grayB = (bitmapB[off] + bitmapB[off + 1] + bitmapB[off + 2]) / 3
      colA[row - startRow] = grayA
      colB[row - startRow] = grayB
    }

    // FFT both columns
    const fftA = fft.createComplexArray()
    const fftB = fft.createComplexArray()
    fft.realTransform(fftA, colA)
    fft.realTransform(fftB, colB)
    fft.completeSpectrum(fftA)
    fft.completeSpectrum(fftB)

    // Cross-power spectrum: conj(A) * B
    const cross = fft.createComplexArray()
    for (let i = 0; i < fftSize; i++) {
      const reA = fftA[2 * i], imA = fftA[2 * i + 1]
      const reB = fftB[2 * i], imB = fftB[2 * i + 1]
      cross[2 * i] = reA * reB + imA * imB       // real part of conj(A)*B
      cross[2 * i + 1] = reA * imB - imA * reB   // imag part of conj(A)*B
    }

    // IFFT to get correlation
    const corr = fft.createComplexArray()
    fft.inverseTransform(corr, cross)

    for (let i = 0; i < fftSize; i++) {
      corrAccum[i] += corr[2 * i] // accumulate real parts
    }
    numCols++
  }

  if (numCols === 0) return defaultStep

  // Find peak in valid scroll range
  const minStep = 5
  const maxStep = Math.min(Math.floor(defaultStep * 2.5), contentH - 1)

  let bestIdx = defaultStep
  let bestVal = -Infinity
  let secondBestVal = -Infinity
  for (let i = minStep; i <= maxStep; i++) {
    if (corrAccum[i] > bestVal) {
      secondBestVal = bestVal
      bestVal = corrAccum[i]
      bestIdx = i
    } else if (corrAccum[i] > secondBestVal) {
      secondBestVal = corrAccum[i]
    }
  }

  // Reliability check: peak should be significantly above second-best
  // If the ratio is too low, the FFT result is unreliable
  if (secondBestVal > 0 && bestVal / secondBestVal < 1.3) {
    return -1 // signal unreliable — caller should fall back to SAD
  }

  // Parabolic interpolation for sub-pixel accuracy
  if (bestIdx > 0 && bestIdx < fftSize - 1) {
    const y0 = corrAccum[bestIdx - 1]
    const y1 = corrAccum[bestIdx]
    const y2 = corrAccum[bestIdx + 1]
    const denom = y0 - 2 * y1 + y2
    if (Math.abs(denom) > 1e-10) {
      const delta = (y0 - y2) / (2 * denom)
      if (Math.abs(delta) < 1) {
        return Math.round(bestIdx + delta)
      }
    }
  }

  return bestIdx
}

/**
 * Detect how many pixels scrolled between two frames.
 * Tries FFT-based phase correlation first for speed and accuracy,
 * then falls back to SAD-based brute force if FFT result is unreliable.
 *
 * topSkip / bottomSkip: rows to exclude from overlap comparison (fixed header/footer).
 * Returns the best matching row offset, or `defaultStep` if no good match found.
 */
function detectScrollStep(
  frameA: Electron.NativeImage,
  frameB: Electron.NativeImage,
  defaultStep: number,
  topSkip: number = 0,
  bottomSkip: number = 0
): number {
  try {
    const sizeA = frameA.getSize()
    const sizeB = frameB.getSize()
    if (sizeA.width !== sizeB.width || sizeA.height !== sizeB.height) return defaultStep

    const { width, height } = sizeA

    // Try FFT-based detection first
    const fftResult = detectScrollStepFFT(frameA, frameB, defaultStep, topSkip, bottomSkip)
    if (fftResult > 0) {
      // Cross-validate FFT result: verify that the detected step actually
      // produces a low mismatch. FFT can return false peaks when the page
      // barely scrolled (e.g., reached the bottom).
      const bitmapA = frameA.toBitmap()
      const bitmapB = frameB.toBitmap()
      const fftMismatch = overlapMismatch(bitmapA, bitmapB, width, height, fftResult, topSkip, bottomSkip)
      if (fftMismatch < 0.02) return fftResult
      // FFT result doesn't validate — fall through to SAD
    }

    // Fall back to SAD-based detection
    return detectScrollStepSAD(frameA, frameB, defaultStep, topSkip, bottomSkip)
  } catch {
    // If FFT fails entirely, fall back to SAD
    try {
      return detectScrollStepSAD(frameA, frameB, defaultStep, topSkip, bottomSkip)
    } catch {
      return defaultStep
    }
  }
}

// ── Nearly-identical frame check ───────────────────────────────────────────

function framesNearlyIdentical(
  frameA: Electron.NativeImage,
  frameB: Electron.NativeImage
): boolean {
  try {
    const bitmapA = frameA.toBitmap()
    const bitmapB = frameB.toBitmap()
    if (bitmapA.length !== bitmapB.length) return false

    let diffPixels = 0
    const totalPixels = bitmapA.length / 4
    const sampleStep = 4 // check every 4th pixel for performance

    for (let i = 0; i < bitmapA.length; i += 4 * sampleStep) {
      if (
        Math.abs(bitmapA[i] - bitmapB[i]) > 10 ||
        Math.abs(bitmapA[i + 1] - bitmapB[i + 1]) > 10 ||
        Math.abs(bitmapA[i + 2] - bitmapB[i + 2]) > 10
      ) {
        diffPixels++
      }
    }

    const sampledPixels = Math.ceil(totalPixels / sampleStep)
    // Threshold: 0.2% — tighter than before to avoid false positives when the
    // page scrolled a small amount near the bottom (the old 0.5% was too loose
    // and would incorrectly mark the last useful frame as a duplicate).
    return diffPixels / sampledPixels < 0.002
  } catch {
    return false
  }
}

// ── Main capture loop (crops each frame to rect) ───────────────────────────

async function captureScrollingInRect(
  rect: { x: number; y: number; width: number; height: number },
  opts: { delay: number; maxFrames: number },
  progressCb: (data: { frame: number; maxFrames: number }) => void,
  isCancelledFn: () => boolean,
  displayId?: number | null
): Promise<{ dataUrls: string[]; scrollSteps: number[]; topFixed: number; bottomFixed: number }> {
  const allDisplays = screen.getAllDisplays()
  const targetDisplay = (displayId != null
    ? allDisplays.find(d => d.id === displayId)
    : null) ?? screen.getPrimaryDisplay()
  const scaleFactor = targetDisplay.scaleFactor
  const { width: dispW, height: dispH } = targetDisplay.size
  const displayBounds = targetDisplay.bounds

  // Centre of capture rect in ABSOLUTE screen coordinates (for scroll-wheel targeting).
  // rect coordinates are relative to the overlay window which fills the target display,
  // so we add the display's origin offset for multi-display setups.
  const centerX = displayBounds.x + rect.x + rect.width / 2
  const centerY = displayBounds.y + rect.y + rect.height / 2

  const frames: Electron.NativeImage[] = []
  const scrollSteps: number[] = [] // per-pair scroll offsets (in physical pixels)

  // Physical pixel dimensions of the cropped frame
  const framePhysH = Math.round(rect.height * scaleFactor)

  // Target overlap: ~100 physical pixels (clamped to 10-30% of frame height)
  const TARGET_OVERLAP_PX = Math.min(
    Math.max(100, Math.floor(framePhysH * 0.10)),
    Math.floor(framePhysH * 0.30)
  )
  // Ideal scroll step = frame height minus target overlap
  const targetStep = framePhysH - TARGET_OVERLAP_PX
  // Default prediction for detectScrollStep (first pair)
  const defaultStep = targetStep

  // ── Adaptive scroll delta ──────────────────────────────────────────────
  // Start with an initial wheel delta, then calibrate based on the ratio
  // between the actual detected scroll step and what we sent.
  let currentDelta = 300 // initial macOS pixel delta / Windows base unit
  let calibrated = false // becomes true after first pair measurement

  // Early fixed region estimates (populated after 3 frames)
  let earlyTopFixed = 0
  let earlyBottomFixed = 0

  for (let i = 0; i < opts.maxFrames; i++) {
    if (isCancelledFn()) break

    // Capture full screen
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(dispW * scaleFactor),
        height: Math.round(dispH * scaleFactor)
      }
    })

    // Find the source for the target display
    const source = sources.find(s => s.display_id === String(targetDisplay.id))
      ?? (allDisplays.length === 1 ? sources[0] : null)
      ?? sources[0]

    if (!source) break

    // Crop to selected rect (apply scaleFactor)
    const cropped = source.thumbnail.crop({
      x: Math.round(rect.x * scaleFactor),
      y: Math.round(rect.y * scaleFactor),
      width: Math.round(rect.width * scaleFactor),
      height: framePhysH
    })

    frames.push(cropped)
    progressCb({ frame: i + 1, maxFrames: opts.maxFrames })

    // Early fixed region detection after 3 frames are captured
    if (frames.length === 3 && earlyTopFixed === 0 && earlyBottomFixed === 0) {
      const early = detectFixedRegions(frames)
      earlyTopFixed = early.topFixed
      earlyBottomFixed = early.bottomFixed
    }

    // Detect scroll step for each consecutive pair
    if (frames.length >= 2) {
      const prevStep = scrollSteps.length > 0 ? scrollSteps[scrollSteps.length - 1] : defaultStep
      const step = detectScrollStep(frames[frames.length - 2], frames[frames.length - 1], prevStep, earlyTopFixed, earlyBottomFixed)
      scrollSteps.push(step)

      const actualOverlap = framePhysH - step

      // ── Calibrate scroll delta after the first pair ──
      // Ratio: how many physical scroll pixels per unit of delta we sent
      if (!calibrated && step > 10) {
        const pxPerDelta = step / currentDelta
        // Calculate the delta needed to achieve targetStep
        currentDelta = Math.round(targetStep / pxPerDelta)
        // Clamp to reasonable range to avoid wild overshoots
        currentDelta = Math.max(50, Math.min(currentDelta, 2000))
        calibrated = true
      } else if (calibrated && step > 10) {
        // Fine-tune: if actual overlap drifted from target, nudge the delta
        const overlapError = actualOverlap - TARGET_OVERLAP_PX
        if (Math.abs(overlapError) > 20) {
          // Too much overlap → need more scroll (increase delta)
          // Too little overlap → need less scroll (decrease delta)
          const adjustment = Math.round(overlapError * (currentDelta / step) * 0.5)
          currentDelta = Math.max(50, Math.min(currentDelta + adjustment, 2000))
        }
      }
    }

    // Stop if at bottom (require at least 3 frames so we always attempt ≥2 scrolls,
    // then stop when two consecutive frames look the same — i.e. page didn't move)
    if (frames.length >= 3) {
      const identical = framesNearlyIdentical(frames[frames.length - 2], frames[frames.length - 1])
      if (identical) {
        // Frames are nearly identical (<0.2% pixel diff) — the page didn't
        // meaningfully scroll. Any non-trivial lastStep here is a false
        // positive from the step detector. Always drop the duplicate to
        // prevent content duplication in the stitched output.
        frames.pop()
        scrollSteps.pop()
        break
      }
    }

    if (i < opts.maxFrames - 1) {
      await scrollAtPosition(centerX, centerY, currentDelta)
      await sleep(opts.delay + 200)
    }
  }

  // Detect fixed header/footer regions across all captured frames
  const { topFixed, bottomFixed } = detectFixedRegions(frames)

  // If fixed regions were found, re-run scroll step detection on content-only zones
  // for better accuracy (fixed elements create false match signals in overlap detection)
  if ((topFixed > 0 || bottomFixed > 0) && frames.length >= 2) {
    for (let i = 0; i < scrollSteps.length; i++) {
      const prevStep = i > 0 ? scrollSteps[i - 1] : defaultStep
      const refinedStep = detectScrollStep(frames[i], frames[i + 1], prevStep, topFixed, bottomFixed)
      if (refinedStep !== scrollSteps[i]) {
        scrollSteps[i] = refinedStep
      }
    }
  }

  const dataUrls = frames.map(f => f.toDataURL())
  return { dataUrls, scrollSteps, topFixed, bottomFixed }
}

// ── Overlay mode tracking ──────────────────────────────────────────────────

let overlayMode: 'region' | 'scroll-region' = 'region'

export function getOverlayMode() {
  return overlayMode
}

export function resetOverlayMode() {
  overlayMode = 'region'
}

export function setOverlayMode(mode: 'region' | 'scroll-region') {
  overlayMode = mode
}

// ── IPC setup ─────────────────────────────────────────────────────────────

export function setupScrollCapture(
  mainWindow: BrowserWindow,
  createOverlayWindow: () => void,
  getOverlayWindow: () => BrowserWindow | null,
  getOverlayDisplayId: () => number | null
) {
  let cancelled = false
  let captureOpts = { delay: 600, maxFrames: 50 }

  // Step 1: User clicks "Scrolling" — hide main window, open overlay
  ipcMain.handle('scroll-capture:start', async (_e, opts?: { delay?: number; maxFrames?: number }) => {
    cancelled = false
    captureOpts = { delay: opts?.delay ?? 600, maxFrames: opts?.maxFrames ?? 50 }

    mainWindow.hide()
    await sleep(200) // wait for window to hide before opening overlay

    // Tell overlay to use 'scroll-region' mode before creating it
    overlayMode = 'scroll-region'
    createOverlayWindow()
    return { ok: true }
  })

  // Step 2: Overlay confirms region selection
  ipcMain.handle('scroll-region:confirm', async (_e, rect: { x: number; y: number; width: number; height: number }) => {
    const captureDisplayId = getOverlayDisplayId()
    resetOverlayMode()
    getOverlayWindow()?.close()

    try {
      await sleep(150) // brief delay after overlay closes

      const { dataUrls, scrollSteps, topFixed, bottomFixed } = await captureScrollingInRect(
        rect,
        captureOpts,
        (data) => {
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('scroll-capture:progress', data)
          }
        },
        () => cancelled,
        captureDisplayId
      )

      if (!mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.focus()
        await sleep(100)
        mainWindow.webContents.send('scroll-capture:open')
        // Wait for React to mount ScrollCaptureDialog and register its IPC listener
        // before sending frames — otherwise the event arrives before the listener exists
        await sleep(500)
        mainWindow.webContents.send('scroll-capture:frames', { dataUrls, scrollSteps, topFixed, bottomFixed })
      }
    } catch (err: unknown) {
      if (!mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.focus()
        mainWindow.webContents.send('scroll-capture:open')
        await sleep(500)
        mainWindow.webContents.send('scroll-capture:error', { error: err instanceof Error ? err.message : 'Unknown error' })
      }
    }
  })

  // Cancel from overlay (ESC key)
  ipcMain.handle('scroll-region:cancel', () => {
    resetOverlayMode()
    getOverlayWindow()?.close()
    cancelled = true
    if (!mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  ipcMain.handle('scroll-capture:cancel', () => {
    cancelled = true
  })
}
