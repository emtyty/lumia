export interface DateGroup<T> {
  label: string
  items: T[]
}

export function groupByDate<T>(
  items: T[],
  getTimestamp: (item: T) => number
): DateGroup<T>[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86_400_000
  const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay() // Mon=1 … Sun=7
  const startOfWeek = startOfToday - (dayOfWeek - 1) * 86_400_000
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime()

  const buckets: { label: string; items: T[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This Week', items: [] },
    { label: 'This Month', items: [] },
    { label: 'Earlier', items: [] },
  ]

  for (const item of items) {
    const ts = getTimestamp(item)
    if (ts >= startOfToday) {
      buckets[0].items.push(item)
    } else if (ts >= startOfYesterday) {
      buckets[1].items.push(item)
    } else if (ts >= startOfWeek) {
      buckets[2].items.push(item)
    } else if (ts >= startOfMonth) {
      buckets[3].items.push(item)
    } else {
      buckets[4].items.push(item)
    }
  }

  return buckets.filter(b => b.items.length > 0)
}
