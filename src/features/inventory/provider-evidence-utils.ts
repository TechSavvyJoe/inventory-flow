import type { InventoryVehicle } from './types'
import type { InventoryDecisionEvidence } from '../../types'

export function providerHoldLabel(record: Pick<InventoryDecisionEvidence, 'dataState' | 'complete' | 'holdState'>) {
  if (record.dataState !== 'current' || !record.complete) return 'Hold status not verified'
  return record.holdState === 'held' ? 'Hold observed' : record.holdState === 'not_observed' ? 'No hold observed' : 'Hold status not verified'
}

/** Generic evidence exists only when a release supplied it; absent data is not a connection claim. */
export function importedHoldSummary(vehicle: InventoryVehicle) {
  const records = vehicle.inventoryDecision?.evidence ?? vehicle.operationalEvidence?.records ?? []
  if (!records.length) return vehicle.dealerMail.conciseState || 'Hold status not verified'
  const current = records.filter(record => record.dataState === 'current' && record.complete)
  if (current.some(record => record.holdState === 'held')) return 'Imported hold observed'
  if (current.length === records.length && current.length && current.every(record => record.holdState === 'not_observed')) return 'No hold observed in current reports'
  return 'Hold status not verified'
}

export function hasProviderHold(vehicle: InventoryVehicle) {
  return vehicle.operationalEvidence?.records.some(record => record.holdState === 'held') === true
}
export function providerHoldState(vehicle: InventoryVehicle): boolean | null {
  if (!vehicle.operationalEvidence) return null
  const records = vehicle.inventoryDecision?.evidence ?? vehicle.operationalEvidence.records
  if (records.some(record => record.dataState === 'current' && record.complete && record.holdState === 'held')) return true
  if (records.length && records.every(record => record.dataState === 'current' && record.complete && record.holdState === 'not_observed')) return false
  return null
}
