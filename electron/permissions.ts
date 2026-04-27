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

// ── Relaunch coordination ────────────────────────────────────────────────────
// Several macOS permissions (Screen Recording, Accessibility) only take effect
// after the app process restarts — TCC caches the previous denial inside the
// running process. We collect grants across the whole preflight chain and
// prompt for ONE relaunch at the end, instead of one per permission.

const PERMISSION_LABEL: Record<DialogKey, string> = {
  'mac-screen': 'Screen Recording',
  'mac-microphone': 'Microphone',
  'mac-accessibility': 'Accessibility',
  'win-microphone': 'Microphone',
}

/** Permissions whose new state only takes effect after a process relaunch. */
const RELAUNCH_REQUIRED: ReadonlySet<DialogKey> = new Set<DialogKey>([
  'mac-screen',
  'mac-accessibility',
])

function isPermissionGranted(key: DialogKey): boolean {
  switch (key) {
    case 'mac-screen': return systemPreferences.getMediaAccessStatus('screen') === 'granted'
    case 'mac-microphone': return systemPreferences.getMediaAccessStatus('microphone') === 'granted'
    case 'mac-accessibility': return systemPreferences.isTrustedAccessibilityClient(false)
    case 'win-microphone': return systemPreferences.getMediaAccessStatus('microphone') === 'granted'
  }
}

/**
 * After preflight, watch for the user to return to Lumia. On focus,
 * check whether any permission that was non-granted at startup has since
 * flipped to granted. If at least one of those requires a relaunch, show
 * a single consolidated relaunch prompt.
 *
 * The watcher is one-shot — once the prompt is shown (Relaunch or Later),
 * we stop listening to avoid nagging.
 */
function setupRelaunchWatcher(parent: BrowserWindow | null, watched: DialogKey[]): void {
  if (watched.length === 0) return
  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    app.removeListener('browser-window-focus', onFocus)
    app.removeListener('activate', onFocus)
    clearTimeout(timeoutId)
  }
  const onFocus = () => {
    if (done) return
    const newlyGranted = watched.filter(isPermissionGranted)
    const needsRelaunch = newlyGranted.filter((k) => RELAUNCH_REQUIRED.has(k))
    if (needsRelaunch.length === 0) return
    cleanup()
    void promptRelaunch(parent, needsRelaunch)
  }
  const timeoutId = setTimeout(cleanup, 30 * 60 * 1000)
  app.on('browser-window-focus', onFocus)
  app.on('activate', onFocus)
  // The user may already have granted everything before we got here (e.g.
  // they finished granting while preflight was still mid-chain). Check once
  // on the next tick so we don't miss it.
  setImmediate(onFocus)
}

async function promptRelaunch(parent: BrowserWindow | null, keys: DialogKey[]): Promise<void> {
  const lines = keys.map((k) => `• ${PERMISSION_LABEL[k]}`).join('\n')
  const opts = {
    type: 'info' as const,
    message: 'Relaunch Lumia to apply new permissions',
    detail: `These permissions were enabled and only take effect after a restart:\n\n${lines}`,
    buttons: ['Relaunch now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  }
  const choice = parent && !parent.isDestroyed()
    ? await dialog.showMessageBox(parent, opts)
    : await dialog.showMessageBox(opts)
  if (choice.response === 0) {
    app.relaunch()
    app.exit(0)
  }
}

// ── macOS preflights ───────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Poll until the predicate returns true, or until the deadline. Used to
 * serialize OS prompts that don't await the user's response — without this,
 * preflight runs all three permission flows back-to-back and the dialogs
 * stack on top of each other, so the user dismisses one and misses the rest.
 */
async function waitUntil(predicate: () => boolean, timeoutMs: number, pollMs = 400): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await sleep(pollMs)
  }
}

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
    // desktopCapturer returns immediately, so wait for the OS prompt to be
    // dismissed (status leaves 'not-determined') before falling through to
    // the next preflight — otherwise the next prompt stacks on top.
    await waitUntil(
      () => systemPreferences.getMediaAccessStatus('screen') !== 'not-determined',
      90_000,
    )
    if (systemPreferences.getMediaAccessStatus('screen') === 'granted') return
    // Fall through to the nudge so the user has a clear path to Settings
    // even if they dismissed the system prompt with "Deny".
  }

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
    // askForMediaAccess returns a Promise that does resolve when the user
    // responds, so this naturally serializes against the next preflight.
    try { await systemPreferences.askForMediaAccess('microphone') } catch { /* ignore */ }
    if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return
    // Fall through to the nudge for the 'denied' branch.
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
  // Read-only check first. We deliberately skip the OS-level prompt
  // (`isTrustedAccessibilityClient(true)`) because it doesn't await the
  // user's response — it would race against the other preflights and the
  // user would lose track of which dialog goes with which permission.
  // Our own modal nudge is sequential and clearer.
  if (systemPreferences.isTrustedAccessibilityClient(false)) return

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

  // Snapshot which permissions are not granted at startup. Anything in this
  // set that flips to `granted` while preflight runs (or shortly after) is
  // a candidate for the "needs relaunch" prompt at the end.
  const allKeys: DialogKey[] = process.platform === 'darwin'
    ? ['mac-screen', 'mac-microphone', 'mac-accessibility']
    : process.platform === 'win32' ? ['win-microphone'] : []
  const watched = allKeys.filter((k) => !isPermissionGranted(k))

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

  // After all preflights, watch for any of the originally-non-granted
  // permissions to flip to granted. If at least one of those requires a
  // relaunch (Screen Recording, Accessibility), prompt for ONE consolidated
  // restart instead of restarting after each individual grant.
  setupRelaunchWatcher(parent, watched)
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
