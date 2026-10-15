import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readPreviewPreference, writePreviewPreference } from '../../src/lib/preview-preference-storage'

describe('preview preference storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('keeps demo preview choices in localStorage across reloads', () => {
    writePreviewPreference('maxey-role', 'sales', { durableAcrossReloads: true })
    expect(window.localStorage.getItem('maxey-role')).toBe('sales')
    expect(window.sessionStorage.getItem('maxey-role')).toBeNull()
    expect(readPreviewPreference('maxey-role', { durableAcrossReloads: true })).toBe('sales')
  })

  it('keeps hosted preview choices session-only and clears durable leftovers on write', () => {
    window.localStorage.setItem('maxey-role', 'manager')
    writePreviewPreference('maxey-role', 'sales', { durableAcrossReloads: false })
    expect(window.sessionStorage.getItem('maxey-role')).toBe('sales')
    expect(window.localStorage.getItem('maxey-role')).toBeNull()
  })

  it('lifts one legacy durable key into the session store for hosted builds', () => {
    window.localStorage.setItem('maxey-home-store', 'Lincoln')
    expect(readPreviewPreference('maxey-home-store', { durableAcrossReloads: false })).toBe('Lincoln')
    expect(window.sessionStorage.getItem('maxey-home-store')).toBe('Lincoln')
    expect(window.localStorage.getItem('maxey-home-store')).toBeNull()
  })

  it('returns null when storage access throws', () => {
    const blocked = {
      getItem: () => { throw new DOMException('The operation is insecure.', 'SecurityError') },
      setItem: () => { throw new DOMException('The operation is insecure.', 'SecurityError') },
      removeItem: () => { throw new DOMException('The operation is insecure.', 'SecurityError') },
      clear: () => {},
      key: () => null,
      length: 0,
    }
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: blocked })
    expect(readPreviewPreference('maxey-role', { durableAcrossReloads: false })).toBeNull()
    expect(() => writePreviewPreference('maxey-role', 'sales', { durableAcrossReloads: false })).not.toThrow()
  })
})
