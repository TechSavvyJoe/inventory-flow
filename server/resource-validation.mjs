import { createHash } from 'node:crypto'

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/
const EXTERNAL_AUTOCHECK_HOSTS = new Set(['autocheck.com', 'www.autocheck.com'])
const EXTERNAL_AUTOCHECK_ROUTES = new Set(['report', 'vehiclehistory'])

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function exactVin(value, expectedVin) {
  return typeof value === 'string' && VIN_PATTERN.test(value.toUpperCase()) && value.toUpperCase() === expectedVin
}

/**
 * Accept only official AutoCheck report routes where the expected VIN is the
 * route identity: /report/:vin, /vehiclehistory/:vin, or one exact vin query
 * parameter on either route. Other query parameters never establish identity.
 */
export function canonicalExternalAutoCheckUrl(value, expectedVin) {
  const vin = String(expectedVin ?? '').toUpperCase()
  if (typeof value !== 'string' || !value.trim() || !VIN_PATTERN.test(vin)) return null
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return null
  }

  const host = parsed.hostname.toLowerCase()
  const rawPathSegments = parsed.pathname.split('/')
  const hasEmptyInteriorSegment = rawPathSegments.slice(1, -1).some((segment) => segment === '')
  let segments
  try {
    segments = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment))
  } catch {
    return null
  }
  if (
    parsed.protocol !== 'https:' ||
    !EXTERNAL_AUTOCHECK_HOSTS.has(host) ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    hasEmptyInteriorSegment ||
    segments.some((segment) => segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'))
  ) {
    return null
  }

  const route = segments[0]?.toLowerCase()
  const vinParameters = [...parsed.searchParams.entries()].filter(([key]) => key.toLowerCase() === 'vin')
  const pathForm =
    segments.length === 2 &&
    EXTERNAL_AUTOCHECK_ROUTES.has(route) &&
    exactVin(segments[1], vin) &&
    vinParameters.length === 0
  const queryForm =
    segments.length === 1 &&
    EXTERNAL_AUTOCHECK_ROUTES.has(route) &&
    vinParameters.length === 1 &&
    exactVin(vinParameters[0][1], vin)
  if (!pathForm && !queryForm) return null

  parsed.protocol = 'https:'
  parsed.hostname = host
  parsed.hash = ''
  return parsed.toString()
}

function resourceRecords(vehicles) {
  if (!Array.isArray(vehicles)) return []
  return vehicles
    .filter((vehicle) => vehicle && vehicle.resourceRecord !== undefined && vehicle.resourceRecord !== null)
    .map((vehicle) => ({ vin: vehicle.vin, resourceRecord: vehicle.resourceRecord }))
    .sort((left, right) => {
      const leftVin = String(left.vin)
      const rightVin = String(right.vin)
      return leftVin < rightVin ? -1 : leftVin > rightVin ? 1 : 0
    })
}

function portableResourceSourcePath(value) {
  if (typeof value !== 'string') return value
  if (/^local-file:[^/\\:]{1,255}$/.test(value)) return value
  if (!/^(?:[a-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var)\/)/i.test(value)) return value
  const leaf = value.replace(/\\/g, '/').split('/').filter(Boolean).at(-1)
  return leaf ? `local-file:${leaf}` : value
}

/**
 * Bind the portable resource source claims to every attached validated record.
 * The raw source-file digest remains separately available as sourceRun.sha256.
 */
export function resourceProvenanceSha256(sourceRun, vehicles) {
  const metadata = sourceRun?.metadata && typeof sourceRun.metadata === 'object' && !Array.isArray(sourceRun.metadata)
    ? {
        ...sourceRun.metadata,
        path: portableResourceSourcePath(sourceRun.metadata.path),
      }
    : sourceRun?.metadata
  const payload = {
    schemaVersion: 'inventory-flow-resource-provenance-v1',
    sourceRun: {
      type: sourceRun?.type,
      reportDate: sourceRun?.reportDate,
      extractedAt: sourceRun?.extractedAt ?? null,
      sha256: String(sourceRun?.sha256 ?? '').toLowerCase(),
      bytes: sourceRun?.bytes,
      schemaVersion: sourceRun?.schemaVersion,
      status: sourceRun?.status,
      staleReason: sourceRun?.staleReason ?? null,
      rowCount: sourceRun?.rowCount,
      metadata,
    },
    records: resourceRecords(vehicles),
  }
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex')
}
