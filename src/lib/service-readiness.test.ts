import { describe, expect, it } from 'vitest'
import { SERVICE_STATUS_OPTIONS, serviceStatusLabel, serviceWorkflowStatus } from './service-readiness'

describe('three-state service vocabulary', () => {
  it('offers exactly Waiting for service, In service, and Ready', () => {
    expect(SERVICE_STATUS_OPTIONS.map((option) => option.label)).toEqual(['Waiting for service', 'In service', 'Ready'])
  })
  it('keeps absent and legacy service fields waiting until a manager confirms Ready', () => {
    expect(serviceWorkflowStatus()).toBe('needs_service')
    expect(serviceStatusLabel()).toBe('Waiting for service')
    expect(serviceWorkflowStatus({ status: 'unknown' })).toBe('needs_service')
    expect(serviceStatusLabel({ status: 'unknown' })).toBe('Waiting for service')
    expect(serviceStatusLabel({ status: 'in_service' })).toBe('In service')
  })
})
