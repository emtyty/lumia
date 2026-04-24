import type { HistoryItem } from '../types'

// Shared action handlers for history items. The same entry points drive the
// Dashboard card hover buttons and the list-row inline buttons, and should
// power any Editor-side "act on the current item" buttons too.
//
// All handlers take a `refreshHistory` callback so they can re-fetch the
// history after a mutation (orphan flips, new uploads) — keeps the UI honest
// without each caller reimplementing that glue.

export async function copyHistoryItem(
  item: HistoryItem,
  refreshHistory: () => Promise<void>,
): Promise<void> {
  if (item.fileMissing) return
  // Video: copy the file reference to clipboard (file on Win/Mac, path on
  // Linux). Image: copy the pixels via the builtin-clipboard workflow.
  if (item.type === 'recording') {
    if (item.filePath) await window.electronAPI?.videoCopyFile?.(item.filePath)
    return
  }
  let dataUrl: string | null | undefined = item.dataUrl
  // Prefer the annotated sidecar so Copy mirrors what Share sends out — the
  // user's final version with annotations, not the untouched original.
  const sourcePath = item.annotatedFilePath ?? item.filePath
  if (!dataUrl && sourcePath) {
    dataUrl = (await window.electronAPI?.readHistoryFile(sourcePath)) ?? null
    if (dataUrl === null) { await refreshHistory(); return }
  }
  if (dataUrl) window.electronAPI?.runWorkflow('builtin-clipboard', dataUrl)
}

export async function shareHistoryItem(
  item: HistoryItem,
  refreshHistory: () => Promise<void>,
): Promise<void> {
  if (item.fileMissing || !item.filePath) return
  await window.electronAPI?.shareHistoryR2(item.id)
  // Repopulate so the "Synced" badge flips on and the repeat-share fast path
  // in main has an up-to-date uploads array to short-circuit against.
  await refreshHistory()
}

export function getGoogleLink(item: HistoryItem): string | undefined {
  return item.uploads?.find(u => u.destination === 'google-drive' && u.success && u.url)?.url
}

export function openGoogleLink(item: HistoryItem): boolean {
  const url = getGoogleLink(item)
  if (!url) return false
  window.electronAPI?.openExternal(url)
  return true
}
