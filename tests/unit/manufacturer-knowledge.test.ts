// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { equipmentTalkingPoints, manufacturerReferences } from '../../extension/sidepanel/lib/manufacturer-knowledge.mjs'

describe('manufacturer knowledge applicability', () => {
  it('matches exact model years and models without borrowing a nearby guide', () => {
    expect(manufacturerReferences({ make:'Ford', model:'F-150', year:2025 }).filter(item => item.modelYear)).toHaveLength(1)
    expect(manufacturerReferences({ make:'Ford', model:'F-150 Lightning', year:2025 }).filter(item => item.modelYear)).toEqual([])
    expect(manufacturerReferences({ make:'Ford', model:'Bronco', year:2025 }).filter(item => item.modelYear)).toEqual([])
    expect(manufacturerReferences({ make:'Lincoln', model:'Nautilus', year:2023 }).filter(item => item.modelYear)).toEqual([])
    expect(manufacturerReferences({ make:'Toyota', model:'RAV4', year:2024 }).filter(item => item.modelYear)).toEqual([])
  })

  it('uses captured labels rather than trim names to offer a demonstration prompt', () => {
    const vehicle = { make:'Lincoln', model:'Nautilus', year:2024, trim:'Black Label' }
    expect(equipmentTalkingPoints(vehicle, [])).toEqual([])
    expect(equipmentTalkingPoints(vehicle, ['Adaptive cruise control']).some(point => point.id === 'hands-free')).toBe(false)
    const points = equipmentTalkingPoints(vehicle, ['Revel Ultima 3D Audio System', 'Perfect Position Seats', 'Lincoln BlueCruise', 'Jet Appearance Package'])
    expect(points.map(point => point.id)).toEqual(expect.arrayContaining(['audio', 'seats', 'hands-free', 'appearance', 'packages']))
    expect(JSON.stringify(points)).not.toMatch(/28 speakers|24-way|installed|self-driving/i)
  })

  it('does not apply a US model-year reference to an explicitly different original market', () => {
    const vehicle = { make:'Lincoln', model:'Nautilus', year:2024, windowSticker:{ originalMarket:'Canada' } }
    expect(manufacturerReferences(vehicle).filter(item => item.modelYear)).toEqual([])
    expect(equipmentTalkingPoints(vehicle, ['Revel Ultima 3D']).some(point => point.id === 'audio')).toBe(false)
  })

  it('does not reuse a new Nautilus feature description for a different Lincoln', () => {
    for (const vehicle of [{ make:'Lincoln', model:'Corsair', year:2024 }, { make:'Lincoln', model:'Nautilus', year:2022 }]) {
      expect(equipmentTalkingPoints(vehicle, ['Revel', 'Perfect Position Seats']).map(point => point.id)).toEqual([])
    }
  })

  it('does not manufacture package contents or redirect missing guides to an unrelated topic', () => {
    const vehicle = { make:'Ford', model:'Maverick', year:2022 }
    const labels = ['FX4 Off-Road Package']
    const before = JSON.stringify({ vehicle, labels })
    const point = equipmentTalkingPoints(vehicle, labels).find(item => item.id === 'packages')
    expect(point?.url).toBeNull()
    expect(point?.detail).toContain('same model year and market')
    expect(JSON.stringify({ vehicle, labels })).toBe(before)
  })

  it('keeps other manufacturers distinct and recognizes only their explicit systems', () => {
    expect(equipmentTalkingPoints({ make:'Chevrolet' }, ['Adaptive cruise control'])).toEqual([])
    expect(equipmentTalkingPoints({ make:'Chevrolet' }, ['Super Cruise'])[0].detail).toContain('active OnStar service')
    expect(equipmentTalkingPoints({ make:'Toyota' }, ['Toyota Safety Sense 3.0'])[0].detail).toContain('captured version')
    expect(equipmentTalkingPoints({ make:'Ford' }, ['Super Cruise'])).toEqual([])
    expect(manufacturerReferences({ make:'Unknown' })).toEqual([])
  })
})
