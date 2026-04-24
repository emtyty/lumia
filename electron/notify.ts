import { Notification, nativeImage, app } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

export interface NotifyOptions {
  body: string
  /** Falls back to 'Lumia' when omitted. */
  title?: string
  /** Inline dataUrl (e.g. the captured image). */
  thumbnailDataUrl?: string
  /** Absolute path to an image file on disk. */
  thumbnailPath?: string
}

const DEFAULT_TITLE = 'Lumia'
// Windows Toast hero image renders well at these bounds — anything
// wider gets downscaled by the shell anyway and bloats the temp file.
const MAX_IMAGE_WIDTH = 1024

/**
 * Single entry point for all toast notifications.
 *
 * Windows: builds a custom `toastXml` with a hero image so the
 * screenshot renders above the text (the default `icon` option only
 * produces a tiny app-logo badge). The image is written to the OS
 * temp dir first because WinRT toasts load images through the
 * file:/// URI scheme and won't accept data URLs.
 *
 * Other platforms: falls back to the standard `icon` field — macOS's
 * stock notification UI doesn't expose an inline-image slot so text
 * is all we can guarantee.
 */
export function showNotification(opts: NotifyOptions): void {
  if (!Notification.isSupported()) {
    console.warn('[notify] Notifications not supported on this platform')
    return
  }

  const title = opts.title ?? DEFAULT_TITLE
  const imagePath = prepareImagePath(opts.thumbnailDataUrl, opts.thumbnailPath)

  // On Windows, fire a toastXml variant with a hero image when we have
  // one. If WinRT rejects the XML (bad AUMID, malformed path, etc.) the
  // `failed` event lets us fall back to a plain text toast so the user
  // at least sees something instead of silent nothing.
  const trySend = (notif: Notification, label: string): void => {
    notif.on('show', () => console.log(`[notify] shown (${label})`))
    notif.on('failed', (_e, err) => console.error(`[notify] failed (${label})`, err))
    notif.on('close', () => console.log(`[notify] closed (${label})`))
    notif.show()
  }

  // toastXml hero images only render reliably in packaged builds: Windows
  // Push Notifications needs an AUMID that was registered through a Start
  // Menu shortcut, which the NSIS installer creates but the dev harness
  // does not. In dev the toast dispatches ("shown" fires) but WPN drops
  // it silently, so we stick to a plain Notification with an icon there.
  const useToastXml = process.platform === 'win32' && !!imagePath && app.isPackaged

  try {
    if (useToastXml && imagePath) {
      const xml = buildToastXml(title, opts.body, imagePath)
      const n = new Notification({ toastXml: xml })
      n.on('failed', () => {
        console.warn('[notify] toastXml failed — falling back to plain toast')
        trySend(new Notification({ title, body: opts.body, icon: imagePath }), 'fallback')
      })
      trySend(n, 'toastXml')
      return
    }
    trySend(new Notification({ title, body: opts.body, icon: imagePath }), 'plain')
  } catch (err) {
    console.error('[notify] show threw', err)
  }
}

// Resolve a usable on-disk image path. If we're given an inline data URL
// we decode → optionally downscale → write to the temp dir; the OS
// recycles that directory on its own so we don't track cleanup.
function prepareImagePath(dataUrl?: string, filePath?: string): string | undefined {
  try {
    if (filePath) return filePath
    if (!dataUrl) return undefined

    let img = nativeImage.createFromDataURL(dataUrl)
    if (img.isEmpty()) return undefined
    const { width } = img.getSize()
    if (width > MAX_IMAGE_WIDTH) img = img.resize({ width: MAX_IMAGE_WIDTH, quality: 'good' })

    const buf = img.toPNG()
    const tempPath = join(app.getPath('temp'), `lumia-notif-${randomUUID()}.png`)
    writeFileSync(tempPath, buf)
    return tempPath
  } catch (err) {
    console.error('[notify] image prep failed', err)
    return undefined
  }
}

// Minimal ToastGeneric template with a hero image. `placement="hero"`
// puts the image above the text — swap to no placement for an inline
// image below the body, or to `appLogoOverride` to replace the app
// icon badge instead.
function buildToastXml(title: string, body: string, imagePath: string): string {
  // Windows WinRT toasts want each path segment percent-encoded. The
  // easiest way to get that right across drive letters and UUIDs is to
  // pass the slashed path through `encodeURI`, which preserves the
  // `file:///` scheme but escapes spaces / unicode / the like.
  const src = encodeURI(`file:///${imagePath.replace(/\\/g, '/')}`)
  return [
    '<toast>',
      '<visual>',
        '<binding template="ToastGeneric">',
          `<text>${escapeXml(title)}</text>`,
          `<text>${escapeXml(body)}</text>`,
          `<image placement="hero" src="${escapeXml(src)}"/>`,
        '</binding>',
      '</visual>',
    '</toast>',
  ].join('')
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
