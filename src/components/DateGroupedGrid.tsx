import type { ReactNode } from 'react'
import { groupByDate } from '../utils/dateGroup'

interface DateGroupedGridProps<T> {
  items: T[]
  getTimestamp: (item: T) => number
  renderItem: (item: T, index: number) => ReactNode
  gridClassName?: string
  emptyState?: ReactNode
  /** When true, skip date grouping and render flat grid */
  flat?: boolean
}

export function DateGroupedGrid<T>({
  items,
  getTimestamp,
  renderItem,
  gridClassName = 'grid grid-cols-4 gap-5',
  emptyState,
  flat = false,
}: DateGroupedGridProps<T>) {
  if (items.length === 0) {
    return <>{emptyState}</>
  }

  if (flat) {
    return (
      <div className={gridClassName}>
        {items.map((item, i) => renderItem(item, i))}
      </div>
    )
  }

  const groups = groupByDate(items, getTimestamp)

  return (
    <div className="space-y-8">
      {groups.map(group => (
        <section key={group.label}>
          <div className="flex items-center gap-4 mb-4">
            <h4
              className="text-[11px] font-bold tracking-[0.15em] uppercase text-slate-500 whitespace-nowrap"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              {group.label}
            </h4>
            <div className="flex-1 h-px bg-white/5" />
            <span className="text-[10px] text-slate-600 font-medium">{group.items.length}</span>
          </div>
          <div className={gridClassName}>
            {group.items.map((item, i) => renderItem(item, i))}
          </div>
        </section>
      ))}
    </div>
  )
}
