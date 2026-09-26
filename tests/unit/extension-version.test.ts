// @vitest-environment node
// @ts-nocheck -- The unpacked companion modules are browser-native ESM.
import { describe, expect, it, vi } from 'vitest'
import { fetchCompanionRelease } from '../../extension/sidepanel/lib/api.mjs'
import { compareVersions } from '../../extension/sidepanel/lib/version.mjs'

const workspace = { origin: 'https://inventory-ops.joegallant.me', demo: false }

describe('companion release notice', () => {
  it('compares strict three-part extension versions', () => {
    expect(compareVersions('1.3.2', '1.3.1')).toBe(1)
    expect(compareVersions('1.3.2', '1.3.2')).toBe(0)
    expect(compareVersions('1.2.9', '1.3.0')).toBe(-1)
    expect(compareVersions('next', '1.3.0')).toBeNull()
  })

  it('accepts only the same-origin reviewed companion download', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ version: '1.3.2', downloadPath: '/downloads/inventory-flow-deal-desk.zip' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    await expect(fetchCompanionRelease(workspace, {}, { fetchImpl })).resolves.toEqual({ version: '1.3.2', downloadPath: '/downloads/inventory-flow-deal-desk.zip' })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://inventory-ops.joegallant.me/downloads/companion-version.json')
  })

  it('rejects an unreviewed download target', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ version: '9.0.0', downloadPath: 'https://outside.example/companion.zip' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    await expect(fetchCompanionRelease(workspace, {}, { fetchImpl })).rejects.toMatchObject({ kind: 'invalid' })
  })
})
