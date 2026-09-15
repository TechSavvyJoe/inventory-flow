// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
// The local demo has no production membership database. This explicit,
// server-owned fixture exercises the read-only directory projection without
// inventing activity timestamps, email addresses, credentials, or live access.
export const SYNTHETIC_ADMIN_MEMBERS = Object.freeze([
  Object.freeze({ user_id: 'synthetic-group-manager', name: 'Demo Group Manager', role: 'group_manager', home_store: 'Lincoln', enabled: 1 }),
  Object.freeze({ user_id: 'synthetic-howell-manager', name: 'Demo Howell Manager', role: 'manager', home_store: 'Howell', enabled: 1 }),
  Object.freeze({ user_id: 'synthetic-fowlerville-manager', name: 'Demo Fowlerville Manager', role: 'manager', home_store: 'Fowlerville', enabled: 1 }),
  Object.freeze({ user_id: 'synthetic-detroit-manager', name: 'Demo Detroit Manager', role: 'manager', home_store: 'Ford Detroit', enabled: 1 }),
  Object.freeze({ user_id: 'synthetic-lincoln-manager', name: 'Demo Lincoln Manager', role: 'manager', home_store: 'Lincoln', enabled: 1 }),
  Object.freeze({ user_id: 'synthetic-sales', name: 'Demo Salesperson', role: 'sales', home_store: 'Howell', enabled: 1 }),
  Object.freeze({ user_id: 'synthetic-coordinator', name: 'Demo Transport Coordinator', role: 'coordinator', home_store: 'Fowlerville', enabled: 1 }),
  Object.freeze({ user_id: 'synthetic-driver-disabled', name: 'Demo Former Driver', role: 'driver', home_store: 'Ford Detroit', enabled: 0 }),
])

export function createSyntheticAdminDirectory() {
  return Object.freeze({
    listMembers() {
      return SYNTHETIC_ADMIN_MEMBERS.map((member) => ({ ...member }))
    },
  })
}
