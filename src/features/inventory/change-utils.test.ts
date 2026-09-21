import { describe, expect, it } from 'vitest'
import { primaryVehicleChangeSignal, vehicleChangeSignals, visibleVehicleChangeSignals } from './change-utils'

describe('vehicle change signals', () => {
  it('suppresses unchanged rows and maps the current report categories', () => {
    expect(vehicleChangeSignals('No change')).toEqual([])
    expect(primaryVehicleChangeSignal('New arrival')?.shortLabel).toBe('New today')
    expect(primaryVehicleChangeSignal('Price change')?.label).toBe('Price changed')
    // Website status is listing noise: recognised, but never shown as a badge
    // and never downgraded to a generic "Updated" badge either.
    expect(primaryVehicleChangeSignal('Status change')).toBeNull()
    expect(vehicleChangeSignals('Website status changed')).toEqual([])
  })

  it('caps row badges while retaining an additional-signal count', () => {
    const result = visibleVehicleChangeSignals('New arrival; price changed; mileage changed; website status changed', 2)
    expect(result.visible.map((signal) => signal.kind)).toEqual(['new_arrival', 'price_change'])
    expect(result.hiddenCount).toBe(1)
  })

  it('keeps an unfamiliar non-empty change visible without inventing a category', () => {
    expect(vehicleChangeSignals('Description was refreshed')).toEqual([
      { kind: 'other', label: 'Inventory updated', shortLabel: 'Updated' },
    ])
  })
})
