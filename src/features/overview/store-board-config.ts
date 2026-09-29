import type { StoreName } from '../../types'

/**
 * Where each store sits on the Overview's store board (OVERVIEW_SPEC §4).
 * Approximate relative positions on an abstract board (viewBox 0 0 100 70),
 * not geographic coordinates: they encode only "Fowlerville west of Howell;
 * the two Detroit-area stores south-east". No addresses, no distances, no
 * basemap. `anchor` places the store name: `middle` under the pin, `end` to
 * its left, `start` to its right. Joe confirms these; edit x/y freely.
 */
export interface StoreBoardPosition {
  store: StoreName
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
}

export const STORE_BOARD_VIEWBOX = { width: 100, height: 70 } as const

export const STORE_BOARD_POSITIONS: readonly StoreBoardPosition[] = [
  { store: 'Fowlerville', x: 13, y: 24, anchor: 'middle' },
  { store: 'Howell', x: 44, y: 24, anchor: 'middle' },
  { store: 'Ford Detroit', x: 70, y: 49, anchor: 'end' },
  { store: 'Lincoln', x: 88, y: 60, anchor: 'end' },
]
