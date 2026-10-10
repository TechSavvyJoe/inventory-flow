import type { PlatformConnection, PlatformConnections, PlatformGroup } from './types'
import { OEMS } from './platformPresentation'

export type OemFamily = Exclude<keyof typeof OEMS, 'not_applicable'>
export type OemSourceStatus = 'configured' | 'missing' | 'paused'
export interface OemProfile {
  id: OemFamily
  label: string
  brands: string[]
  evidencePlanning: string[]
  guidance: string[]
}

const PLANNING_FIELDS = [
  'Factory build, installed options, and package details',
  'Original MSRP and base MSRP as separate values',
  'Warranty terms and in-service date as separate fields',
  'Recall or campaign source and source date',
]

const profile = (id: OemFamily, label: string, brands: string[], evidencePlanning: string[] = PLANNING_FIELDS): OemProfile => ({
  id,
  label,
  brands,
  evidencePlanning,
  guidance: ['Map only fields your authorized provider supplies, and retain the source and capture date.'],
})

export const OEM_PROFILES: Record<OemFamily, OemProfile> = {
  ford_lincoln: profile('ford_lincoln', 'Ford / Lincoln', ['Ford', 'Lincoln'], [
    ...PLANNING_FIELDS,
    'OASIS and invoice are known evidence categories for Ford/Lincoln planning; this is registry guidance, not adapter capability.',
  ]),
  gm: profile('gm', 'General Motors', ['Buick', 'Cadillac', 'Chevrolet', 'GMC']),
  stellantis: profile('stellantis', 'Stellantis', ['Chrysler', 'Dodge', 'Jeep', 'Ram']),
  toyota_lexus: profile('toyota_lexus', 'Toyota / Lexus', ['Toyota', 'Lexus']),
  honda_acura: profile('honda_acura', 'Honda / Acura', ['Honda', 'Acura']),
  hyundai_kia: profile('hyundai_kia', 'Hyundai / Kia', ['Hyundai', 'Kia']),
  volkswagen_audi: profile('volkswagen_audi', 'Volkswagen / Audi', ['Volkswagen', 'Audi']),
  bmw: profile('bmw', 'BMW', ['BMW']),
  mercedes_benz: profile('mercedes_benz', 'Mercedes-Benz', ['Mercedes-Benz']),
  other: profile('other', 'Other OEM', ['Other manufacturer']),
}

export interface OemCoverageCell {
  dealershipId: string
  dealershipName: string
  status: OemSourceStatus
  configured: number
  enabled: number
  paused: number
}

export interface OemCoverageRow {
  oem: OemFamily
  label: string
  configured: number
  enabled: number
  paused: number
  noOEMSource: boolean
  dealerships: OemCoverageCell[]
}

export function buildOemCoverage(group: PlatformGroup, connections: PlatformConnection[]): OemCoverageRow[] {
  return (Object.keys(OEMS) as Array<keyof typeof OEMS>)
    .filter((oem): oem is OemFamily => oem !== 'not_applicable')
    .map(oem => {
      const familyConnections = connections.filter(connection => connection.groupId === group.id && connection.oem === oem && group.dealerships.some(dealership => dealership.id === connection.dealershipId && dealership.groupId === group.id))
      const dealerships = group.dealerships.map(dealership => {
        const rows = familyConnections.filter(connection => connection.dealershipId === dealership.id)
        const enabled = rows.filter(connection => connection.enabled).length
        const paused = rows.length - enabled
        const status: OemSourceStatus = rows.length === 0 ? 'missing' : enabled > 0 ? 'configured' : 'paused'
        return {
          dealershipId: dealership.id,
          dealershipName: dealership.name,
          status,
          configured: rows.length,
          enabled,
          paused,
        }
      })
      const enabled = familyConnections.filter(connection => connection.enabled).length
      return {
        oem,
        label: OEMS[oem],
        configured: familyConnections.length,
        enabled,
        paused: familyConnections.length - enabled,
        noOEMSource: familyConnections.length === 0,
        dealerships,
      }
    })
}

export type SourceCheckStatus = 'configured' | 'missing' | 'blocked'
export interface SourceConfigurationCheck {
  key: string
  label: string
  status: SourceCheckStatus
  detail: string
}

export interface SourceReadiness {
  checks: SourceConfigurationCheck[]
  access: { status: 'unverified'; detail: string }
  executor: { connected: boolean; detail: string }
  planner: { enabled: boolean; nextLocal?: string; due?: boolean; detail: string }
}

export function sourceReadiness(item: PlatformConnection, data: PlatformConnections, group: PlatformGroup): SourceReadiness {
  const dealership = item.groupId === group.id ? group.dealerships.find(candidate => candidate.id === item.dealershipId && candidate.groupId === group.id) : undefined
  const queued = item.groupId === group.id && data.groupId === group.id && data.requests.some(request => request.connectionId === item.id && ['queued','running','reconciliation_required'].includes(request.state))
  const sourceIdentity = Boolean(item.name.trim() && item.provider.trim() && (item.vendor ?? '').trim())
  const endpointConfigured = item.method === 'collector' || Boolean(item.endpoint.trim())
  const scheduled = item.cadence !== 'manual'
  const scheduleConfigured = !scheduled || Boolean(item.localTime && item.timezone)
  const checks: SourceConfigurationCheck[] = [
    { key: 'dealership', label: 'Dealership scope', status: dealership ? 'configured' : 'blocked', detail: dealership ? `Assigned to ${dealership.name}.` : 'The source and dealership must belong to this group.' },
    { key: 'source', label: 'Source identity', status: sourceIdentity ? 'configured' : 'missing', detail: sourceIdentity ? 'Source name, provider, and vendor are recorded.' : 'Add a source name, provider, and vendor.' },
    { key: 'endpoint', label: 'Connection endpoint', status: endpointConfigured ? 'configured' : 'missing', detail: item.method === 'collector' ? 'A dealership collector is selected; local execution remains separate.' : endpointConfigured ? 'An endpoint is saved but has not been contacted.' : 'Add the configured API or file endpoint.' },
    { key: 'schedule', label: 'Schedule preference', status: scheduleConfigured ? 'configured' : 'missing', detail: scheduled ? scheduleConfigured ? `${item.cadence} at ${item.localTime} (${item.timezone}).` : 'Set a local start time and timezone.' : 'Manual requests only.' },
    { key: 'source-state', label: 'Source preference', status: item.enabled ? 'configured' : 'blocked', detail: item.enabled ? 'Enabled in the registry.' : 'Paused in the registry; no new request can be made.' },
    { key: 'queue', label: 'Waiting request', status: queued ? 'blocked' : 'configured', detail: queued ? 'A queued request blocks configuration changes and another request.' : 'No request is currently waiting for an executor.' },
  ]
  const planner = data.scheduler?.enabled === true
  return {
    checks,
    access: { status: 'unverified', detail: 'Source credentials, permissions, and sessions have not been verified.' },
    executor: { connected: data.execution.connected, detail: data.execution.connected ? 'An executor is reported as connected; this does not confirm a successful source capture.' : 'No source executor is connected.' },
    planner: {
      enabled: planner,
      ...(item.schedule?.nextLocal ? { nextLocal: item.schedule.nextLocal } : {}),
      ...(typeof item.schedule?.due === 'boolean' ? { due: item.schedule.due } : {}),
      detail: !scheduled ? 'This source has no automatic planner schedule.' : planner ? 'The planner may queue a request; it does not collect data.' : 'The planner is not activated.',
    },
  }
}
