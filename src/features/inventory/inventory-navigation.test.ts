import { describe, expect, it } from 'vitest'
import {
  createInventorySearchNavigation,
  hasInventorySearchRequest,
  inventorySearchAccessContext,
  readInventorySearchRequest,
  stripLegacyInventorySearchQuery,
} from './inventory-navigation'

describe('private inventory search navigation', () => {
  it('keeps the raw query out of the destination URL and scopes transient state', () => {
    const accessContext = inventorySearchAccessContext('manager', 'Howell')
    const navigation = createInventorySearchNavigation('  customer note: call after 5  ', accessContext)

    expect(`${navigation.pathname}${navigation.search}`).toBe('/inventory?scope=group')
    expect(`${navigation.pathname}${navigation.search}`).not.toContain('customer')
    expect(readInventorySearchRequest(navigation.state, accessContext)).toEqual({
      query: 'customer note: call after 5',
      accessContext,
    })
  })

  it('rejects a request created under another role or home store', () => {
    const navigation = createInventorySearchNavigation(
      'private alert text',
      inventorySearchAccessContext('manager', 'Howell'),
    )

    expect(
      readInventorySearchRequest(
        navigation.state,
        inventorySearchAccessContext('porter', 'Howell'),
      ),
    ).toBeNull()
    expect(
      readInventorySearchRequest(
        navigation.state,
        inventorySearchAccessContext('manager', 'Lincoln'),
      ),
    ).toBeNull()
    expect(hasInventorySearchRequest(navigation.state)).toBe(true)
  })

  it('supports an explicit blank request without placing it in the URL', () => {
    const accessContext = inventorySearchAccessContext('sales', 'Howell')
    const navigation = createInventorySearchNavigation('   ', accessContext)

    expect(readInventorySearchRequest(navigation.state, accessContext)?.query).toBe('')
    expect(navigation.search).toBe('?scope=group')
  })

  it('sanitizes a legacy public deep-link query while preserving other filters', () => {
    expect(stripLegacyInventorySearchQuery('?q=F-150&scope=group')).toBe('?scope=group')
    expect(stripLegacyInventorySearchQuery('?scope=home&q=%2420%2C988&sort=price')).toBe(
      '?scope=home&sort=price',
    )
  })
})
