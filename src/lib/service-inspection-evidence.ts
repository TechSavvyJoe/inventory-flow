type AutoCheckInspection = {
  date?: string | null
  types?: string[] | null
}

type ReadinessEvidence = {
  source?: string | null
  inspectionDate?: string | null
  types?: string[] | null
}

type ServiceReadiness = {
  status?: string | null
  readinessEvidence?: ReadinessEvidence | null
} | null | undefined

/**
 * AutoCheck is a vehicle-history source. Only the readiness engine may decide
 * that one of its inspections belongs to the vehicle's current store cycle.
 */
export function qualifyingAutoCheckInspection(
  service: ServiceReadiness,
  report: { recentInspection?: AutoCheckInspection | null } | null | undefined,
): { date: string; types: string[] } | null {
  const evidence = service?.readinessEvidence
  const inspection = report?.recentInspection
  if (
    service?.status !== 'serviced' ||
    evidence?.source !== 'autocheck' ||
    typeof evidence.inspectionDate !== 'string' ||
    inspection?.date !== evidence.inspectionDate
  ) return null

  const types = (evidence.types ?? []).filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
  return types.length ? { date: evidence.inspectionDate, types } : null
}
