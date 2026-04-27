/**
 * Permission preflight — surfaces OS-level access prompts at app startup
 * instead of waiting for the user's first capture / first mic-toggle.
 *
 * macOS:
 *   - Screen Recording — required for desktopCapturer (every capture mode).
 *   - Microphone       — required for the in-recording mic toggle.
 *   - Accessibility    — required for the Swift scroll-helper to post
 *                        synthetic CGEvents during scrolling capture, and
 *                        for some hotkey edge cases.
 *
 * Windows:
 *   - Microphone       — global Privacy switch in Settings can be off.
 *   - Screen capture and globalShortcut don't need user-grantable permissions.
 *
 * Behavior per state:
 *   - granted        → no-op.
 *   - not-determined → trigger the native prompt programmatically when we can
 *                      (mic, accessibility), or trigger via desktopCapturer
 *                      (screen recording — there's no direct API for it).
 *   - denied         → one dialog per session with a deep link to the right
 *                      Settings pane. Tracked in-memory so we never nag.
 *
 * We deliberately do nothing if the user is mid-capture or the main window
 * isn't visible yet, so prompts don't fight for focus during startup.
 */

import { app, dialog, shell, systemPreferences, desktopCapturer, BrowserWindow } from 'electron'

type DialogKey = 'mac-screen' | 'mac-microphone' | 'mac-accessibility' | 'win-microphone'

const sessionShown = new Set<DialogKey>()

interface NudgeOpts {
  key: DialogKey
  parent: BrowserWindow | null
  message: string
  detail: string
  settingsUrl: string
  buttonLabel?: string
}

async function nudgeToSettings(opts: NudgeOpts): Promise<void> {
  if (sessionShown.has(opts.key)) return
  sessionShown.add(opts.key)

  const buttons = [opts.buttonLabel ?? 'Open System Settings', 'Later']
  const choice = opts.parent && !opts.parent.isDestroyed()
    ? await dialog.showMessageBox(opts.parent, {
        type: 'info',
        message: opts.message,
        detail: opts.detail,
        buttons,
        defaultId: 0,
        cancelId: 1,
      })
    : await dialog.showMessageBox({
        type: 'info',
        message: opts.message,
        detail: opts.detail,
        buttons,
        defaultId: 0,
        cancelId: 1,
      })

  if (choice.response === 0) {
    shell.openExternal(opts.settingsUrl).catch(() => { /* ignore */ })
  }
}

// ── macOS preflights ───────────────────────────────────────────────────────

async function preflightMacScreenRecording(parent: BrowserWindow | null): Promise<void> {
  const status = systemPreferences.getMediaAccessStatus('screen')
  if (status === 'granted') return

  if (status === 'not-determined') {
    // There's no askForMediaAccess('screen'). The system shows its prompt the
    // first time the app actually requests screen content — so we fire a
    // 1×1 desktopCapturer call to surface it. macOS additionally requires
    // an app relaunch after granting before the capability "sticks".
    try {
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
    } catch { /* prompt is now visible — nothing to do */ }
    return
  }

  // 'denied' or 'restricted'
  await nudgeToSettings({
    key: 'mac-screen',
    parent,
    message: 'Lumia needs Screen Recording permission',
    detail: 'Captures and screen recordings will fail until you enable Lumia under System Settings → Privacy & Security → Screen Recording. macOS requires a restart of the app after granting.',
    settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  })
}

async function preflightMacMicrophone(parent: BrowserWindow | null): Promise<void> {
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') return

  if (status === 'not-determined') {
    // Native macOS prompt — returns immediately, the user dialog is async.
    try { await systemPreferences.askForMediaAccess('microphone') } catch { /* ignore */ }
    return
  }

  await nudgeToSettings({
    key: 'mac-microphone',
    parent,
    message: 'Lumia needs Microphone permission for narration',
    detail: 'The mic toggle in the recording toolbar will be silent until you enable Lumia under System Settings → Privacy & Security → Microphone.',
    settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  })
}

async function preflightMacAccessibility(parent: BrowserWindow | null): Promise<void> {
  // No 'not-determined' state for AX — it's a binary trusted/not-trusted.
  // Passing `true` makes the system show its prompt if not yet trusted,
  // and returns the current trusted state.
  const trusted = systemPreferences.isTrustedAccessibilityClient(true)
  if (trusted) return

  // The system prompt above appears once per app install. On subsequent
  // launches with the user still ungranted, we surface our own dialog.
  await nudgeToSettings({
    key: 'mac-accessibility',
    parent,
    message: 'Lumia needs Accessibility permission for scrolling capture',
    detail: 'Without it, scrolling capture cannot post scroll events and global hotkeys may be unreliable. Enable Lumia under System Settings → Privacy & Security → Accessibility.',
    settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  })
}

// ── Windows preflights ─────────────────────────────────────────────────────

async function preflightWinMicrophone(parent: BrowserWindow | null): Promise<void> {
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted' || status === 'unknown') return
  if (status === 'not-determined') {
    // On Windows there's no programmatic prompt API. The system surfaces a
    // privacy dialog the first time getUserMedia({ audio:true }) is called,
    // which already happens in RecorderHost. Nothing to preflight.
    return
  }

  // 'denied' / 'restricted' — global Privacy switch is off for our app.
  await nudgeToSettings({
    key: 'win-microphone',
    parent,
    message: 'Microphone access is disabled for Lumia',
    detail: 'The recording mic toggle will stay silent until you allow Lumia under Settings → Privacy & security → Microphone.',
    settingsUrl: 'ms-settings:privacy-microphone',
  })
}

// ── Public entry ───────────────────────────────────────────────────────────

let preflightRan = false

/**
 * Run the OS-level permission preflight once per app launch.
 *
 * Call after the main window is created so the prompts have a parent to
 * attach to and the user has visual context for what's asking. Safe to call
 * multiple times — repeats short-circuit.
 */
export async function preflightPermissions(parent: BrowserWindow | null): Promise<void> {
  if (preflightRan) return
  preflightRan = true

  // pnpm dev runs under the parent Electron binary; permissions granted
  // there belong to Electron, not Lumia, so prompts are mostly noise. Skip
  // proactive prompts in dev, but still nudge on `denied` so devs notice.
  const isDev = !app.isPackaged

  try {
    if (process.platform === 'darwin') {
      if (!isDev) await preflightMacScreenRecording(parent)
      else await maybeNudgeMacIfDenied(parent, 'screen', 'mac-screen', macScreenNudge)

      if (!isDev) await preflightMacMicrophone(parent)
      else await maybeNudgeMacIfDenied(parent, 'microphone', 'mac-microphone', macMicrophoneNudge)

      // Accessibility is the same in dev and prod (it tracks the running
      // binary path), so we always run the full preflight.
      await preflightMacAccessibility(parent)
    } else if (process.platform === 'win32') {
      await preflightWinMicrophone(parent)
    }
  } catch (err) {
    console.warn('[permissions] preflight error:', err)
  }
}

// ── Dev-mode helper: only nudge on explicit denial, never auto-prompt ─────

const macScreenNudge: Omit<NudgeOpts, 'parent' | 'key'> = {
  message: 'Lumia needs Screen Recording permission',
  detail: 'Captures and screen recordings will fail until you enable Lumia under System Settings → Privacy & Security → Screen Recording. macOS requires a restart of the app after granting.',
  settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
}

const macMicrophoneNudge: Omit<NudgeOpts, 'parent' | 'key'> = {
  message: 'Lumia needs Microphone permission for narration',
  detail: 'The mic toggle in the recording toolbar will be silent until you enable Lumia under System Settings → Privacy & Security → Microphone.',
  settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
}

async function maybeNudgeMacIfDenied(
  parent: BrowserWindow | null,
  type: 'screen' | 'microphone',
  key: DialogKey,
  template: Omit<NudgeOpts, 'parent' | 'key'>,
): Promise<void> {
  const status = systemPreferences.getMediaAccessStatus(type)
  if (status === 'denied' || status === 'restricted') {
    await nudgeToSettings({ key, parent, ...template })
  }
}
