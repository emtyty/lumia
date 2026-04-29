import Store from 'electron-store'
import { unlink } from 'fs/promises'
import { resolve, normalize } from 'path'
import { homedir } from 'os'
import type { HistoryItem } from './types'

export class HistoryStore {
  private store: Store<{ items: HistoryItem[]; cleanupVersion?: number }>

  constructor() {
    this.store = new Store<{ items: HistoryItem[]; cleanupVersion?: number }>({
      name: 'history',
      defaults: { items: [] }
    })
  }

  getAll(): HistoryItem[] {
    return this.store.get('items').sort((a, b) => b.timestamp - a.timestamp)
  }

  add(item: HistoryItem) {
    const items = this.store.get('items')
    items.unshift(item)
    // Keep last 1000 items. At ~4 KB per item (thumbnail-only) that caps
    // history.json at ~4 MB — still trivial to read/write on every call.
    if (items.length > 1000) items.splice(1000)
    this.store.set('items', items)
  }

  async delete(id: string): Promise<boolean> {
    const items = this.store.get('items')
    const victim = items.find(i => i.id === id)
    if (!victim) return false
    await this.unlinkItemFiles(victim)
    this.store.set('items', items.filter(i => i.id !== id))
    return true
  }

  update(id: string, patch: Partial<HistoryItem>): HistoryItem | null {
    const items = this.store.get('items')
    const idx = items.findIndex(i => i.id === id)
    if (idx < 0) return null
    const updated = { ...items[idx], ...patch }
    items[idx] = updated
    this.store.set('items', items)
    return updated
  }

  // Drops items older than `days` days. `days <= 0` means keep forever (no-op).
  // Returns the number of items removed. Unlinks each pruned item's source +
  // annotated-sidecar files so retention cleanup mirrors the manual delete
  // button — without this, history.json shrinks but disk bloat persists.
  async pruneOlderThan(days: number): Promise<number> {
    if (!Number.isFinite(days) || days <= 0) return 0
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    const items = this.store.get('items')
    const kept: HistoryItem[] = []
    const pruned: HistoryItem[] = []
    for (const it of items) (it.timestamp >= cutoff ? kept : pruned).push(it)
    if (pruned.length === 0) return 0
    await Promise.all(pruned.map(it => this.unlinkItemFiles(it)))
    this.store.set('items', kept)
    return pruned.length
  }

  // One-time data reset for upgrade paths where on-disk formats changed
  // enough that carrying the old history forward is worse than starting
  // fresh (e.g. thumbnail payload switched from full dataUrls to JPEGs,
  // annotation sidecar model added, settings shape reworked). Guarded by a
  // `cleanupVersion` marker in history.json so it only runs once per bump:
  // bump the target to rerun on the next release. Fresh installs hit this
  // path too but trivially — no items to unlink, just seals the marker.
  async runStartupCleanup(targetVersion: number): Promise<number> {
    const current = (this.store.get('cleanupVersion') as number | undefined) ?? 0
    if (current >= targetVersion) return 0
    const items = this.store.get('items')
    await Promise.all(items.map(it => this.unlinkItemFiles(it)))
    this.store.set('items', [])
    this.store.set('cleanupVersion', targetVersion)
    return items.length
  }

  // Shared file cleanup for delete + prune. Bounded to the user's home
  // directory so a tampered history entry can't coax us into unlinking
  // system files; ENOENT is swallowed because the goal state (file gone)
  // is already achieved.
  private async unlinkItemFiles(item: HistoryItem): Promise<void> {
    const paths = [item.filePath, item.annotatedFilePath].filter((p): p is string => !!p)
    for (const p of paths) {
      try {
        const resolved = resolve(normalize(p))
        if (resolved.startsWith(homedir())) await unlink(resolved)
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          console.error('[history] failed to unlink', p, err)
        }
      }
    }
  }
}
