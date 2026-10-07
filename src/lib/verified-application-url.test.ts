import { describe, expect, it } from 'vitest'
import { verifiedApplicationUrl } from './verified-application-url'

describe('verified application URLs', () => {
  it.each([
    ['https://inventory-admin.joegallant.me/platform', '/platform', 'https://inventory-admin.joegallant.me/platform'],
    ['https://dealer.example.com/inventory', '/inventory', 'https://dealer.example.com/inventory'],
    ['https://dealer.example.com:443/inventory', '/inventory', 'https://dealer.example.com/inventory'],
  ] as const)('accepts the explicit public URL %s', (value, path, expected) => {
    expect(verifiedApplicationUrl(value, path)).toBe(expected)
  })

  it.each([
    'http://dealer.example.com/inventory',
    'https://user:secret@dealer.example.com/inventory',
    'https://dealer.example.com:8443/inventory',
    'https://dealer.example.com/inventory?token=synthetic',
    'https://dealer.example.com/inventory#fragment',
    'https://dealer.example.com/other',
    'https://dealer.local/inventory',
    'https://localhost/inventory',
    'https://127.0.0.1/inventory',
    'https://[::1]/inventory',
  ])('rejects unsafe or mismatched URL %s', (value) => {
    expect(verifiedApplicationUrl(value, '/inventory')).toBeUndefined()
  })

  it('rejects missing values and enforces the software-admin path', () => {
    expect(verifiedApplicationUrl(undefined, '/platform')).toBeUndefined()
    expect(verifiedApplicationUrl('https://inventory-admin.joegallant.me/inventory', '/platform')).toBeUndefined()
  })
})
