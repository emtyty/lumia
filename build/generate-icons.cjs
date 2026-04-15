
/**
 * Converts resources/icons/png/icon.png → resources/icons/win/icon.ico + resources/icons/mac/icon.icns
 *
 * Run manually:   npm run icons
 * Auto-invoked:   prepended to every build:* and publish:* script
 *
 * Packages used:
 *   png2icons        – Pure-JS PNG → ICO (Windows) and ICNS (macOS) converter
 */

const png2icons = require('png2icons')
const { readFileSync, writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')
const UPNG = require('png2icons/lib/UPNG')
const Resize = require('png2icons/lib/resize3')

const ROOT = join(__dirname, '..')
const PNG_SRC = join(ROOT, 'resources/icons/png/icon.png')

const ICO_OUT = join(ROOT, 'resources/icons/win/icon.ico')
const ICNS_OUT = join(ROOT, 'resources/icons/mac/icon.icns')

function resizePNG(inputBuffer, width, height) {
  const png = UPNG.decode(inputBuffer)
  const rgba = new Uint8Array(UPNG.toRGBA8(png)[0])
  const scaled = new Uint8Array(width * height * 4)
  Resize.hermiteInterpolation(
    { data: rgba, width: png.width, height: png.height },
    { data: scaled, width, height }
  )
  return Buffer.from(UPNG.encode([scaled], width, height, 0, [], true))
}

// ── Read PNG source ──────────────────────────────────────────────────────────
console.log('Generating icons from', PNG_SRC)

const pngBuffer = readFileSync(PNG_SRC)
console.log('  ✓ PNG source (1024×1024)')

// ── PNG → ICO (Windows) ───────────────────────────────────────────────────────
// Embeds sizes: 16, 24, 32, 48, 64, 128, 256
const ico = png2icons.createICO(pngBuffer, png2icons.HERMITE, 0, false, true)
if (!ico) throw new Error('ICO generation failed')
writeFileSync(ICO_OUT, ico)
console.log('  ✓ win/icon.ico')

// ── PNG → ICNS (macOS) ────────────────────────────────────────────────────────
// Embeds sizes: 16, 32, 64, 128, 256, 512, 1024
const icns = png2icons.createICNS(pngBuffer, png2icons.HERMITE, 0)
if (!icns) throw new Error('ICNS generation failed')
writeFileSync(ICNS_OUT, icns)
console.log('  ✓ mac/icon.icns')

// ── Tray icon (22 × 22 PNG) ───────────────────────────────────────────────────
// 22 px = macOS menu-bar height; scales fine for the Windows system tray too.
const trayBuffer = resizePNG(pngBuffer, 22, 22)
const trayMacDir = join(ROOT, 'resources/tray/mac')
const trayWinDir = join(ROOT, 'resources/tray/win')
writeFileSync(join(trayMacDir, 'tray-icon.png'), trayBuffer)
writeFileSync(join(trayWinDir, 'tray-icon.png'), trayBuffer)

console.log('  ✓ resources/tray/mac/tray-icon.png')
console.log('  ✓ resources/tray/win/tray-icon.png')

console.log('Icons ready.')
