// @vitest-environment node
// @ts-nocheck -- scans the Worker ESM sources for the machine codes they throw.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { humanErrorMessage } from '../../cloudflare/src/error-messages.mjs'
import { errorRoute } from '../../cloudflare/src/worker.mjs'

const source = ['cloudflare/src/worker.mjs', 'cloudflare/src/access.mjs']
  .map((file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')).join('\n')
const thrown = [...new Set([...source.matchAll(/new (?:HttpError|AccessError)\('([A-Z_]+)'/g)].map((match) => match[1]))].sort()

describe('employee-facing error messages', () => {
  it('cover every machine code the Worker and access layer throw', () => {
    expect(thrown.length).toBeGreaterThan(20)
    const missing = thrown.filter((code) => humanErrorMessage(code, null) === null)
    expect(missing).toEqual([])
  })

  it('fall back to a generic sentence for an unknown code without echoing it', () => {
    expect(humanErrorMessage('SYNTHETIC_UNKNOWN_CODE')).toBe('The request could not be completed. Please try again.')
    expect(humanErrorMessage('SYNTHETIC_UNKNOWN_CODE')).not.toContain('SYNTHETIC')
  })
})

describe('error log route templates', () => {
  const host = 'https://inventory.synthetic.test'
  it.each([
    ['/api/vehicle-issues', '/api/vehicle-issues'],
    ['/api/vehicle-issues/issue-synthetic-01', '/api/vehicle-issues/:id'],
    [`/api/vehicle-issues/issue-synthetic-01/photos/${'a'.repeat(64)}`, '/api/vehicle-issues/:id/photos/:hash'],
    ['/api/vehicles/1FTSYNTHETICVIN01/service', '/api/vehicles/:id/service'],
    ['/api/transfers/transfer-synthetic-01', '/api/transfers/:id'],
    ['/assets/index-synthetic.js', '/assets/:file'],
    ['/api/bootstrap?vin=1FTSYNTHETICVIN01', '/api/bootstrap'],
  ])('maps %s to %s without record ids or query values', (pathname, template) => {
    const route = errorRoute(`${host}${pathname}`)
    expect(route).toBe(template)
    expect(route).not.toMatch(/SYNTHETIC|synthetic-01|aaaa/)
  })
})
