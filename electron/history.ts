import Store from 'electron-store'
import type { HistoryItem } from './types'

export class HistoryStore {
  private store: Store<{ items: HistoryItem[] }>

  constructor() {
    this.store = new Store<{ items: HistoryItem[] }>({
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
    // Keep last 200 items
    if (items.length > 200) items.splice(200)
    this.store.set('items', items)
  }

  delete(id: string): boolean {
    const items = this.store.get('items')
    const filtered = items.filter(i => i.id !== id)
    if (filtered.length === items.length) return false
    this.store.set('items', filtered)
    return true
  }

  // Drops items older than `days` days. `days <= 0` means keep forever (no-op).
  // Returns the number of items removed.
  pruneOlderThan(days: number): number {
    if (!Number.isFinite(days) || days <= 0) return 0
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    const items = this.store.get('items')
    const kept = items.filter(i => i.timestamp >= cutoff)
    const removed = items.length - kept.length
    if (removed > 0) this.store.set('items', kept)
    return removed
  }
}
