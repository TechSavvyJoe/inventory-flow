import type { PublicChangeEvent, StoreName } from '../../types'

export function publicChangeMatchesStore(event: PublicChangeEvent, store: StoreName): boolean {
  if (event.store === store) return true
  if (event.type !== 'store_transfer') return false
  return event.beforeValue === store || event.afterValue === store
}

export function scopePublicChanges(
  events: PublicChangeEvent[],
  scope: 'home' | 'group',
  homeStore: StoreName,
): PublicChangeEvent[] {
  if (scope === 'group') return events
  return events.filter((event) => publicChangeMatchesStore(event, homeStore))
}
