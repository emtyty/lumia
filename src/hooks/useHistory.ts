import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_HISTORY = 100

/**
 * Generic undo/redo history hook with cross-platform keyboard shortcut support.
 *
 * Hotkeys:
 *   Cmd+Z / Ctrl+Z          → undo  (macOS + Windows)
 *   Cmd+Shift+Z / Ctrl+Shift+Z → redo (macOS + Windows)
 *   Ctrl+Y                  → redo  (Windows convention)
 *
 * Uses refs internally to avoid stale closures — `set` always operates on the
 * latest committed state regardless of when it is called.
 */
export function useHistory<T>(initialState: T) {
  const history = useRef<T[]>([initialState])
  const cursor  = useRef(0)
  // tick is only used to trigger re-renders; real state lives in refs above
  const [, bump] = useState(0)
  const rerender = useCallback(() => bump(n => n + 1), [])

  const state   = history.current[cursor.current]
  const canUndo = cursor.current > 0
  const canRedo = cursor.current < history.current.length - 1

  /**
   * Commit a new state.  Accepts a value OR a functional updater, just like
   * React's setState.  Any "future" redo states are discarded.
   */
  const set = useCallback((next: T | ((prev: T) => T)) => {
    const cur   = history.current[cursor.current]
    const value = typeof next === 'function' ? (next as (p: T) => T)(cur) : next

    // Discard any redo branch
    history.current = history.current.slice(0, cursor.current + 1)
    history.current.push(value)

    // Keep memory bounded
    if (history.current.length > MAX_HISTORY) history.current.shift()

    cursor.current = history.current.length - 1
    rerender()
  }, [rerender])

  const undo = useCallback(() => {
    if (cursor.current <= 0) return
    cursor.current--
    rerender()
  }, [rerender])

  const redo = useCallback(() => {
    if (cursor.current >= history.current.length - 1) return
    cursor.current++
    rerender()
  }, [rerender])

  /** Reset history to the initial state (cannot be undone). */
  const clear = useCallback(() => {
    history.current = [history.current[0]]
    cursor.current  = 0
    rerender()
  }, [rerender])

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't steal keys while the user is typing in a text field
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // Modifier: Cmd on macOS, Ctrl on Windows/Linux
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
      } else if ((e.key === 'y' || e.key === 'Y') && !e.metaKey) {
        // Ctrl+Y = redo (Windows convention; Cmd+Y is not standard on macOS)
        e.preventDefault()
        redo()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  return { state, set, undo, redo, canUndo, canRedo, clear }
}
