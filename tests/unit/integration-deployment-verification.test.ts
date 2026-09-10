// @ts-nocheck -- deployment verifier ESM; synthetic responses only, no credentials or live requests.
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { oauthDiscovery, oauthReady, parseExpectedMetadata, reconcileExpectedMetadata, verificationPassed } from '../../scripts/verify-integration-deployment.mjs'

const HOST = 'https://inventory-data.joegallant.me'
const ISSUER = 'https://techsavvyjoe.cloudflareaccess.com/cdn-cgi/access/sso/oidc/test'
const expected = { bundleSha256: 'a'.repeat(64), total: 4, byStore: { Howell: 1, Fowlerville: 1, 'Ford Detroit': 1, Lincoln: 1 } }
const ready = { protected: true, discoveryReady: true, pkce: true, dynamicRegistration: true, liveClientSignInVerified: false }
const success = () => ({ unauthenticatedApiDenied: true, oauth: { ...ready }, api: { verified: true, independentReconciliation: { provided: false, verified: false } } })
const response = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('integration deployment verification gates', () => {
  it('requires REST verification separately and never equates discovery with actual hosted sign-in', () => {
    expect(oauthReady(ready)).toBe(true)
    expect(verificationPassed(success())).toBe(true)
    expect(verificationPassed({ ...success(), api: { verified: false, performed: false } })).toBe(false)
    expect(verificationPassed({ ...success(), unauthenticatedApiDenied: false })).toBe(false)
    expect(ready.liveClientSignInVerified).toBe(false)
  })

  it.each(['protected', 'discoveryReady', 'pkce', 'dynamicRegistration'])('fails overall verification when OAuth %s is absent or false even if REST passed', key => {
    for (const value of [false, undefined, 'true', 1]) {
      const output = success(); output.oauth[key] = value
      expect(verificationPassed(output)).toBe(false)
      expect(output.api.verified).toBe(true)
    }
  })

  it('validates all independent release metadata and its sum', () => {
    expect(parseExpectedMetadata(expected)).toEqual(expected)
    expect(reconcileExpectedMetadata(expected, expected)).toEqual({ provided: true, verified: true, releaseHashMatches: true, totalMatches: true, storeCountsMatch: true })
    expect(reconcileExpectedMetadata(expected)).toEqual({ provided: false, verified: false })
  })

  it.each([
    { ...expected, bundleSha256: 'not-a-hash' },
    { ...expected, total: 5 },
    { ...expected, total: 0 },
    { ...expected, byStore: { Howell: 4 } },
    { ...expected, byStore: { ...expected.byStore, Lincoln: -1 } },
    { ...expected, byStore: { ...expected.byStore, Other: 0 } },
    { ...expected, token: 'synthetic-secret-not-accepted' },
    null,
  ])('rejects unsafe or incomplete independent metadata %#', metadata => {
    expect(() => parseExpectedMetadata(metadata)).toThrow('INTEGRATION_VERIFICATION_FAILED')
  })

  it.each([
    { ...expected, bundleSha256: 'b'.repeat(64) },
    { ...expected, total: 3 },
    { ...expected, byStore: { ...expected.byStore, Howell: 2, Lincoln: 0 } },
    { ...expected, byStore: { ...expected.byStore, Other: 0 } },
  ])('fails when independently expected data does not reconcile %#', actual => {
    const output = success()
    output.api.independentReconciliation = reconcileExpectedMetadata(actual, expected)
    expect(output.api.independentReconciliation.verified).toBe(false)
    expect(verificationPassed(output)).toBe(false)
  })

  it('accepts omitted zero-count stores only when independent metadata expects zero', () => {
    const metadata = { ...expected, byStore: { Howell: 4, Fowlerville: 0, 'Ford Detroit': 0, Lincoln: 0 } }
    expect(reconcileExpectedMetadata({ ...metadata, byStore: { Howell: 4 } }, metadata).verified).toBe(true)
  })

  it('follows synthetic OAuth discovery without logging metadata payloads', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${HOST}/.well-known/oauth-protected-resource/mcp"` } }))
      .mockResolvedValueOnce(response({ resource: `${HOST}/mcp`, authorization_servers: [ISSUER] }))
      .mockResolvedValueOnce(response({ issuer: ISSUER, code_challenge_methods_supported: ['S256'], registration_endpoint: `${ISSUER}/register`, authorization_response_iss_parameter_supported: true, extra: 'synthetic-private-payload' }))
    const result = await oauthDiscovery(fetch)
    expect(result).toMatchObject({ ...ready, issuerIdentificationAdvertised: true })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(result)).not.toContain('synthetic-private-payload')
    expect(result).not.toHaveProperty('issuer')
  })

  it.each([200, 302, 403, 503])('does not accept HTTP %s as a usable OAuth challenge', async status => {
    expect(oauthReady(await oauthDiscovery(async () => new Response(null, { status })))).toBe(false)
  })

  it('does not follow discovery pointers to unapproved hosts', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://unapproved.example/metadata"' } }))
    await expect(oauthDiscovery(fetch)).rejects.toThrow('INTEGRATION_VERIFICATION_FAILED')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('fails issuer mismatch, non-S256 PKCE, and unapproved registration endpoints', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${HOST}/.well-known/oauth-protected-resource/mcp"` } }))
      .mockResolvedValueOnce(response({ resource: `${HOST}/mcp`, authorization_servers: [ISSUER] }))
      .mockResolvedValueOnce(response({ issuer: `${ISSUER}/wrong`, code_challenge_methods_supported: ['plain'], registration_endpoint: 'https://unapproved.example/register' }))
    const result = await oauthDiscovery(fetch)
    expect(result).toMatchObject({ discoveryReady: false, pkce: false, dynamicRegistration: false })
    expect(oauthReady(result)).toBe(false)
  })
})
