import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

type DialogState = 'capturing' | 'stitching' | 'error'

interface Props {
  onClose: () => void
}

/**
 * Find the optimal seam row within an overlap zone by computing per-row
 * sum of absolute pixel differences between two image regions.
 * Returns the row (relative to overlapStart in imgA / 0-based in imgB's overlap)
 * with the minimum difference — the best cut point.
 *
 * Kept as a simple fallback reference. The primary seam finder is findOptimalSeamDP.
 */
function findOptimalSeamSimple(
  ctxA: CanvasRenderingContext2D,
  ctxB: CanvasRenderingContext2D,
  width: number,
  overlapStartA: number,
  overlapStartB: number,
  overlapHeight: number
): number {
  if (overlapHeight <= 0) return 0

  const dataA = ctxA.getImageData(0, overlapStartA, width, overlapHeight)
  const dataB = ctxB.getImageData(0, overlapStartB, width, overlapHeight)
  const pixelsA = dataA.data
  const pixelsB = dataB.data

  let bestRow = Math.floor(overlapHeight / 2)
  let bestDiff = Infinity

  // Sample every other column for performance on wide images
  const colStep = Math.max(1, Math.floor(width / 200))

  for (let row = 0; row < overlapHeight; row++) {
    let rowDiff = 0
    const rowOffset = row * width * 4
    for (let col = 0; col < width; col += colStep) {
      const idx = rowOffset + col * 4
      rowDiff += Math.abs(pixelsA[idx] - pixelsB[idx])         // R
      rowDiff += Math.abs(pixelsA[idx + 1] - pixelsB[idx + 1]) // G
      rowDiff += Math.abs(pixelsA[idx + 2] - pixelsB[idx + 2]) // B
    }
    if (rowDiff < bestDiff) {
      bestDiff = rowDiff
      bestRow = row
    }
  }

  return bestRow
}

/**
 * Find optimal seam PATH through the overlap zone using dynamic programming.
 * Instead of a single best row (straight horizontal cut), this finds a path
 * that can zigzag vertically to avoid cutting through areas of high difference.
 *
 * Returns the seam row for the CENTER of the overlap (used as the blend center point).
 * Also returns per-column seam positions for pixel-level blending.
 */
function findOptimalSeamDP(
  ctxA: CanvasRenderingContext2D,
  ctxB: CanvasRenderingContext2D,
  width: number,
  overlapStartA: number,
  overlapStartB: number,
  overlapHeight: number
): { seamRow: number; seamPath: number[] } {
  if (overlapHeight <= 0) return { seamRow: 0, seamPath: [] }

  const dataA = ctxA.getImageData(0, overlapStartA, width, overlapHeight)
  const dataB = ctxB.getImageData(0, overlapStartB, width, overlapHeight)
  const pixA = dataA.data
  const pixB = dataB.data

  // Build cost matrix: difference between frame A and frame B at each pixel
  // Increase column sampling step for very tall overlap zones to save memory
  const colStep = Math.max(1, Math.floor(width / (overlapHeight > 1000 ? 100 : 200)))
  const sampledW = Math.ceil(width / colStep)

  // Cost at each (row, sampledCol)
  const cost: Float32Array[] = []
  for (let row = 0; row < overlapHeight; row++) {
    const rowCost = new Float32Array(sampledW)
    const rowOff = row * width * 4
    for (let sc = 0; sc < sampledW; sc++) {
      const col = sc * colStep
      const idx = rowOff + col * 4
      const dr = Math.abs(pixA[idx] - pixB[idx])
      const dg = Math.abs(pixA[idx + 1] - pixB[idx + 1])
      const db = Math.abs(pixA[idx + 2] - pixB[idx + 2])
      rowCost[sc] = dr + dg + db
    }
    cost.push(rowCost)
  }

  // DP: find minimum-cost horizontal path from left to right.
  // dp[col][row] = min cost path from col 0 to col `col` ending at row `row`
  // Transitions: from (row, col-1), (row-1, col-1), (row+1, col-1)

  // Initialize first column
  const dp: Float32Array[] = []
  const backtrack: Int16Array[] = []

  dp.push(new Float32Array(overlapHeight))
  backtrack.push(new Int16Array(overlapHeight))
  for (let row = 0; row < overlapHeight; row++) {
    dp[0][row] = cost[row][0]
    backtrack[0][row] = row
  }

  // Fill DP table
  for (let sc = 1; sc < sampledW; sc++) {
    const dpCol = new Float32Array(overlapHeight)
    const btCol = new Int16Array(overlapHeight)

    for (let row = 0; row < overlapHeight; row++) {
      let bestPrev = dp[sc - 1][row]
      let bestPrevRow = row

      // Check row-1
      if (row > 0 && dp[sc - 1][row - 1] < bestPrev) {
        bestPrev = dp[sc - 1][row - 1]
        bestPrevRow = row - 1
      }
      // Check row+1
      if (row < overlapHeight - 1 && dp[sc - 1][row + 1] < bestPrev) {
        bestPrev = dp[sc - 1][row + 1]
        bestPrevRow = row + 1
      }

      dpCol[row] = bestPrev + cost[row][sc]
      btCol[row] = bestPrevRow
    }

    dp.push(dpCol)
    backtrack.push(btCol)
  }

  // Find the end row with minimum cost
  const lastCol = dp[sampledW - 1]
  let endRow = 0
  let minCost = lastCol[0]
  for (let row = 1; row < overlapHeight; row++) {
    if (lastCol[row] < minCost) {
      minCost = lastCol[row]
      endRow = row
    }
  }

  // Backtrack to find the full path
  const seamPath = new Array<number>(sampledW)
  seamPath[sampledW - 1] = endRow
  for (let sc = sampledW - 2; sc >= 0; sc--) {
    seamPath[sc] = backtrack[sc + 1][seamPath[sc + 1]]
  }

  // The "seamRow" for blending = median row of the path (most representative position)
  const sortedRows = [...seamPath].sort((a, b) => a - b)
  const seamRow = sortedRows[Math.floor(sortedRows.length / 2)]

  const minRow = sortedRows[0]
  const maxRow = sortedRows[sortedRows.length - 1]
  console.log(
    `[ScrollCapture] DP seam path stats — min row: ${minRow}, max row: ${maxRow}, median (seamRow): ${seamRow}, overlap height: ${overlapHeight}, sampled columns: ${sampledW}`
  )

  return { seamRow, seamPath }
}

/**
 * Load a data URL into an HTMLImageElement.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = rej
    img.src = src
  })
}

/**
 * Draw an image onto an offscreen canvas and return the 2D context.
 */
function imageToContext(img: HTMLImageElement): CanvasRenderingContext2D {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  return ctx
}

/**
 * Stitch scroll-captured frames into a single seamless image.
 *
 * Pipeline:
 * 1. Load all images
 * 2. Strip fixed header/footer regions from middle frames (frames 1..N-2)
 * 3. Keep header from frame 0, footer from last frame
 * 4. Use per-pair scroll steps to determine content overlap
 * 5. Find optimal seam row within each overlap zone (minimum pixel diff)
 * 6. Apply narrow alpha blend centered on the optimal seam
 */
async function stitchFrames(
  dataUrls: string[],
  scrollSteps: number[],
  topFixed: number = 0,
  bottomFixed: number = 0
): Promise<string> {
  const images = await Promise.all(dataUrls.map(loadImage))
  const width = images[0].naturalWidth
  const frameH = images[0].naturalHeight

  // Get 2D contexts for pixel-level access
  const contexts = images.map(imageToContext)

  // Validate fixed region sizes — they must not exceed half the frame
  const safeTopFixed = Math.min(Math.max(0, Math.round(topFixed)), Math.floor(frameH * 0.4))
  const safeBottomFixed = Math.min(Math.max(0, Math.round(bottomFixed)), Math.floor(frameH * 0.4))

  // Content region within each frame (between fixed header and footer)
  const contentTop = safeTopFixed
  const contentBottom = frameH - safeBottomFixed
  const contentH = contentBottom - contentTop

  if (images.length === 1) {
    // Single frame — return as-is
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = frameH
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(images[0], 0, 0)
    return canvas.toDataURL('image/png')
  }

  // ── Build content strips ──────────────────────────────────────────────
  // Frame 0: keep full frame (header + content, footer will be trimmed if not last)
  // Frames 1..N-2 (middle): strip fixed header and footer → content-only strips
  // Frame N-1 (last): keep content + footer

  // Compute cumulative Y positions of content strips in the output.
  // scrollSteps[i] = pixel distance the viewport content moved between frame i and i+1.
  // The overlap between consecutive content strips:
  //   overlapH = contentH - scrollSteps[i]
  // (when scrollStep < contentH, there's overlap; when >= contentH, there's a gap — rare)

  // We accumulate the Y position of each content strip in the output canvas.
  // The first content strip starts right after the header.
  const stripYOffsets: number[] = [safeTopFixed] // Y of content strip 0 in output
  for (let i = 0; i < scrollSteps.length; i++) {
    const step = Math.max(0, scrollSteps[i])
    stripYOffsets.push(stripYOffsets[i] + step)
  }

  // Total output height = header + last strip bottom + footer
  const lastStripY = stripYOffsets[stripYOffsets.length - 1]
  const totalHeight = lastStripY + contentH + safeBottomFixed

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = totalHeight
  const ctx = canvas.getContext('2d')!

  // ── Draw header from frame 0 ─────────────────────────────────────────
  if (safeTopFixed > 0) {
    ctx.drawImage(images[0], 0, 0, width, safeTopFixed, 0, 0, width, safeTopFixed)
  }

  // ── Draw content strip from frame 0 fully ────────────────────────────
  ctx.drawImage(
    images[0],
    0, contentTop, width, contentH,  // source: content region
    0, stripYOffsets[0], width, contentH  // dest
  )

  // ── Draw content strips from frames 1..N-1 with seam-aware blending ──
  for (let i = 1; i < images.length; i++) {
    const stripY = stripYOffsets[i] // where this strip starts in output
    const prevStripBottom = stripYOffsets[i - 1] + contentH // where previous strip ends in output
    let overlapH = prevStripBottom - stripY // overlap height in pixels

    // Validate overlap: clamp to [0, contentH] to prevent compound errors
    if (overlapH > contentH) {
      console.warn(
        `[ScrollCapture] Frame ${i}: overlapH (${overlapH}) exceeds contentH (${contentH}), clamping to contentH`
      )
      overlapH = contentH
    }
    if (overlapH < 0) {
      overlapH = 0
    }

    if (overlapH <= 0) {
      // No overlap — draw content strip directly
      ctx.drawImage(
        images[i],
        0, contentTop, width, contentH,
        0, stripY, width, contentH
      )
    } else {
      // There is overlap between this strip and the previous one.
      // Find the optimal seam row within the overlap zone.

      // In the previous frame's content region, the overlap starts at:
      //   contentTop + (contentH - overlapH)
      // In the current frame's content region, the overlap starts at:
      //   contentTop (the top of the content strip)
      const overlapStartInPrev = contentTop + (contentH - overlapH)
      const overlapStartInCurr = contentTop

      const { seamRow } = findOptimalSeamDP(
        contexts[i - 1], contexts[i],
        width,
        overlapStartInPrev, overlapStartInCurr,
        overlapH
      )

      // Blend zone: narrow region centered on the optimal seam.
      // Use adaptive size: 5% of overlap height, clamped to 4..40 pixels.
      const blendHalf = Math.min(20, Math.max(2, Math.floor(overlapH * 0.05)))
      const blendStart = Math.max(0, seamRow - blendHalf)
      const blendEnd = Math.min(overlapH, seamRow + blendHalf)
      const blendH = blendEnd - blendStart

      // Draw the non-overlapping bottom part of this strip (below overlap zone)
      if (overlapH < contentH) {
        ctx.drawImage(
          images[i],
          0, contentTop + overlapH, width, contentH - overlapH,  // source: below overlap
          0, stripY + overlapH, width, contentH - overlapH        // dest
        )
      }

      // In the overlap zone:
      // - Rows above the blend zone: keep previous frame (already drawn)
      // - Rows below the blend zone: draw from current frame
      // - Rows within blend zone: alpha crossfade

      // Draw current frame's portion of overlap BELOW the blend zone
      const belowBlendInOverlap = blendEnd
      const belowBlendHeight = overlapH - belowBlendInOverlap
      if (belowBlendHeight > 0) {
        ctx.drawImage(
          images[i],
          0, contentTop + belowBlendInOverlap, width, belowBlendHeight,
          0, stripY + belowBlendInOverlap, width, belowBlendHeight
        )
      }

      // Draw the narrow blend zone with alpha crossfade
      if (blendH > 0) {
        const blendCanvas = document.createElement('canvas')
        blendCanvas.width = width
        blendCanvas.height = blendH
        const bctx = blendCanvas.getContext('2d')!

        // Draw the current frame's blend portion
        bctx.drawImage(
          images[i],
          0, contentTop + blendStart, width, blendH,
          0, 0, width, blendH
        )

        // Apply gradient mask: transparent at top (keep previous) → opaque at bottom (use current)
        bctx.globalCompositeOperation = 'destination-in'
        const grad = bctx.createLinearGradient(0, 0, 0, blendH)
        grad.addColorStop(0, 'rgba(0,0,0,0)')
        grad.addColorStop(1, 'rgba(0,0,0,1)')
        bctx.fillStyle = grad
        bctx.fillRect(0, 0, width, blendH)

        // Composite onto the output at the blend zone's position
        ctx.drawImage(blendCanvas, 0, stripY + blendStart)
      }
    }
  }

  // ── Draw footer from last frame ──────────────────────────────────────
  if (safeBottomFixed > 0) {
    ctx.drawImage(
      images[images.length - 1],
      0, frameH - safeBottomFixed, width, safeBottomFixed,
      0, totalHeight - safeBottomFixed, width, safeBottomFixed
    )
  }

  return canvas.toDataURL('image/png')
}

export default function ScrollCaptureDialog({ onClose }: Props) {
  const navigate = useNavigate()
  const [dialogState, setDialogState] = useState<DialogState>('capturing')
  const [progress, setProgress] = useState({ frame: 0, maxFrames: 20 })
  const [error, setError] = useState('')
  // Subscribe to all scroll-capture events in a single effect.
  // No ref guard — StrictMode cleanup+remount works correctly:
  // mount → add listeners → unmount → remove → remount → add listeners (active ✓)
  useEffect(() => {
    window.electronAPI?.onScrollCaptureProgress(data => {
      setProgress(data)
    })

    window.electronAPI?.onScrollCaptureFrames(async ({ dataUrls, scrollSteps, topFixed, bottomFixed }) => {
      try {
        if (dataUrls.length === 0) {
          setError('No frames were captured.')
          setDialogState('error')
          return
        }

        setDialogState('stitching')
        const dataUrl = await stitchFrames(dataUrls, scrollSteps, topFixed ?? 0, bottomFixed ?? 0)

        // Add to history
        try {
          await window.electronAPI?.addHistoryItem({
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            name: `scroll-capture-${new Date().toISOString().replace(/[:.]/g, '-')}`,
            dataUrl,
            type: 'screenshot',
            uploads: []
          })
        } catch {
          // History add is non-critical — continue
        }

        navigate('/editor', { state: { dataUrl, source: 'scrolling' } })
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setDialogState('error')
      }
    })

    window.electronAPI?.onScrollCaptureError(({ error: msg }) => {
      setError(msg)
      setDialogState('error')
    })

    return () => {
      window.electronAPI?.removeAllListeners('scroll-capture:progress')
      window.electronAPI?.removeAllListeners('scroll-capture:frames')
      window.electronAPI?.removeAllListeners('scroll-capture:error')
    }
  }, []) // eslint-disable-line

  const handleClose = () => {
    window.electronAPI?.cancelScrollCapture()
    window.electronAPI?.removeAllListeners('scroll-capture:progress')
    window.electronAPI?.removeAllListeners('scroll-capture:frames')
    window.electronAPI?.removeAllListeners('scroll-capture:error')
    onClose()
  }

  const progressPct =
    progress.maxFrames > 0
      ? Math.round((progress.frame / progress.maxFrames) * 100)
      : 0

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="glass-refractive rounded-3xl p-8 w-[480px] shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-lg">swipe_down</span>
            </div>
            <h3 className="text-lg font-bold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Scrolling Capture
            </h3>
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-white transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Capturing state */}
        {dialogState === 'capturing' && (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-2xl animate-bounce">swipe_down</span>
            </div>
            {progress.frame > 0 ? (
              <>
                <p className="text-sm text-slate-300 font-semibold" style={{ fontFamily: 'Manrope, sans-serif' }}>
                  Capturing scroll…
                </p>
                <p className="text-xs text-slate-500" style={{ fontFamily: 'Manrope, sans-serif' }}>
                  Frame {progress.frame} of {progress.maxFrames}
                </p>
                <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full primary-gradient rounded-full transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-slate-400 text-sm" style={{ fontFamily: 'Manrope, sans-serif' }}>
                  Capturing scroll…
                </p>
              </>
            )}
            <button
              onClick={handleClose}
              className="mt-2 px-6 py-2 rounded-2xl border border-slate-500/30 text-slate-300 text-sm font-semibold hover:bg-white/5 transition-colors"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Stitching state */}
        {dialogState === 'stitching' && (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-2xl animate-bounce">swipe_down</span>
            </div>
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-400 text-sm" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Stitching frames…
            </p>
          </div>
        )}

        {/* Error */}
        {dialogState === 'error' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl">
              <span className="material-symbols-outlined text-red-400 flex-shrink-0">error</span>
              <div>
                <p className="text-sm font-semibold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
                  Capture failed
                </p>
                <p className="text-xs text-slate-400 mt-1">{error}</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="w-full primary-gradient text-slate-900 font-bold py-4 rounded-2xl"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
