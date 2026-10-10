// @vitest-environment node
// @ts-nocheck -- dependency-free ESM; synthetic fixtures only.
import { describe, expect, it } from 'vitest'
import { groupMatchesByStore, resolveStoreScope, scopeCounts, scopeMatches } from '../../extension/sidepanel/lib/scope.mjs'

const match = (vin, homeStore, held) => ({ vehicle: { vin, homeStore, hold: { hasActiveHold: held } } })
const matches = [match('F1', 'Fowlerville', true), match('H1', 'Howell', false), match('L1', 'Lincoln', null), match('H2', 'Howell', true), match('F2', 'Fowlerville', false)]

describe('deal desk store scope', () => {
  it('keeps Held at the working store until the user explicitly widens it', () => {
    expect(scopeMatches(matches, { workingStore: 'Howell', view: 'held' }).map((m) => m.vehicle.vin)).toEqual(['H2'])
    expect(scopeMatches(matches, { workingStore: 'Howell', storeScope: 'all', view: 'held' }).map((m) => m.vehicle.vin)).toEqual(['F1', 'H2'])
    expect(scopeMatches(matches, { workingStore: 'Howell', storeScope: 'Fowlerville', view: 'held' }).map((m) => m.vehicle.vin)).toEqual(['F1'])
  })

  it('counts only current search/filter matches inside the selected store and never counts unknown holds as held', () => {
    expect(scopeCounts(matches, { workingStore: 'Howell' })).toEqual({ inventory: 2, held: 1, moving: 0 })
    expect(scopeCounts(matches, { workingStore: 'Howell', storeScope: 'all' })).toEqual({ inventory: 5, held: 2, moving: 0 })
    expect(scopeCounts(matches.filter((m) => m.vehicle.vin === 'F1'), { workingStore: 'Howell' })).toEqual({ inventory: 0, held: 0, moving: 0 })
  })

  it('includes current and retained provider holds plus active app reservations', () => {
    const observed = match('provider-held', 'Howell', false)
    observed.vehicle.operationalEvidence = { records: [{ provider: 'autocheck', dataState: 'current', complete: true, holdState: 'held' }] }
    const reserved = match('manual-held', 'Howell', false)
    reserved.vehicle.manualHold = { state: 'active' }
    const genericDealerMail = match('generic-dealermail', 'Howell', false)
    genericDealerMail.vehicle.operationalEvidence = { records: [{ provider: 'dealermail', dataState: 'current', complete: true, holdState: 'held' }] }
    const legacyDealerMail = match('legacy-dealermail', 'Howell', false)
    legacyDealerMail.vehicle.operationalEvidence = { records: [{ provider: 'legacy-dealermail', dataState: 'current', complete: true, holdState: 'held' }] }
    const stale = match('stale-only', 'Howell', false)
    stale.vehicle.operationalEvidence = { records: [{ provider: 'carfax', dataState: 'stale_unverified', complete: false, holdState: 'held' }] }
    const held = scopeMatches([observed, reserved, genericDealerMail, legacyDealerMail, stale], { workingStore: 'Howell', view: 'held' }).map(({ vehicle }) => vehicle.vin)
    expect(held).toEqual(['provider-held', 'manual-held', 'generic-dealermail', 'stale-only'])
  })

  it('keeps Moving local until expansion and uses normalized movement rather than service or hold', () => {
    const moving = matches.map(item => ({ vehicle: {...item.vehicle, movement: ['H1','F1'].includes(item.vehicle.vin) ? {state:'in_transit'} : null, serviceReadiness: {status:'in_service'} } }))
    expect(scopeMatches(moving, {workingStore:'Howell', view:'moving'}).map(item=>item.vehicle.vin)).toEqual(['H1'])
    expect(scopeMatches(moving, {workingStore:'Howell', storeScope:'all', view:'moving'}).map(item=>item.vehicle.vin)).toEqual(['F1','H1'])
    expect(scopeCounts(moving, {workingStore:'Howell'}).moving).toBe(1)
  })

  it('groups all-store matches with the working store first and preserves ranking within each store', () => {
    const groups = groupMatchesByStore(matches, 'Howell')
    expect(groups.map((group) => group.store)).toEqual(['Howell', 'Fowlerville', 'Lincoln'])
    expect(groups[0].matches.map((m) => m.vehicle.vin)).toEqual(['H1', 'H2'])
    expect(groups[1].matches.map((m) => m.vehicle.vin)).toEqual(['F1', 'F2'])
  })

  it('resolves the actual signed-in store and handles users without one truthfully', () => {
    expect(resolveStoreScope('home', 'Lincoln')).toBe('Lincoln')
    expect(resolveStoreScope('home', null)).toBeNull()
    expect(resolveStoreScope('all', 'Howell')).toBeNull()
  })
})
