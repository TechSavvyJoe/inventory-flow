import type { ManualHold, ManualHoldInput, UserRole } from '../../types'

export function holdStateLabel(state: ManualHold['state']): string {
  switch (state) {
    case 'requested': return 'Pending approval'
    case 'active': return 'Held'
    case 'released': return 'Hold released'
    case 'rejected': return 'Request declined'
    case 'cancelled': return 'Request cancelled'
    default: return 'No hold recorded'
  }
}

export function holdActionLabel(hold: ManualHold, role: UserRole): string {
  if (!hold.canManage) return 'View hold'
  if (hold.state === 'requested') return hold.canApprove === true ? 'Review hold request' : 'Manage hold request'
  if (hold.state === 'active') return 'Manage hold'
  return role === 'sales' ? 'Request hold' : 'Place hold'
}

export function initialHoldAction(hold: ManualHold, role: UserRole): ManualHoldInput['state'] {
  if (hold.state === 'active') return 'active'
  if (hold.state === 'requested') return hold.canApprove === true ? 'active' : 'requested'
  return role === 'sales' ? 'requested' : 'active'
}
