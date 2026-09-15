/**
 * Read-only projection for the Control Center. This intentionally represents
 * only the operational facts that managers need to inspect; it carries no
 * mutation controls, credentials, notes, or vehicle/customer details.
 */
export interface AdminOverview {
  generatedAt: string | null
  readOnly: true
  summary: {
    activeUsers: number
    connectedStores: number
    feedsCurrent: number
    lastVerifiedAt: string | null
  }
  people: AdminPerson[]
  feeds: AdminFeed[]
  audit: AdminAuditEntry[]
}

export interface AdminPerson {
  id: string
  name: string
  role: string
  storeAccess: string[]
  status: 'active' | 'disabled'
  lastActiveAt: string | null
}

export interface AdminFeed {
  store: string
  status: 'current' | 'stale_unverified' | 'incomplete' | 'unknown'
  lastSuccessfulAt: string | null
  vehicleCount: number | null
  issueSummary: string | null
}

export interface AdminAuditEntry {
  id: string
  occurredAt: string
  actor: string | null
  activity: string
  scope: string
  result: 'recorded'
}
