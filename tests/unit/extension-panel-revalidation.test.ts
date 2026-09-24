// PRODUCT-RULE TEST
// @ts-nocheck -- exercises the unbundled panel's plain-JS api.mjs module directly.
// The panel keeps polling the same bootstrap document; this pins the ETag
// revalidation path added alongside the app's calm-polling fix (M08): the
// panel sends If-None-Match once it has a validator, and a 304 must be
// handled before fetchJson's generic "every non-ok status is an error"
// branch, or a healthy revalidation would be reported as a server failure.
import { beforeEach, describe, expect, it } from 'vitest'
import { fetchBootstrap } from '../../extension/sidepanel/lib/api.mjs'

const workspace = { origin: 'https://demo.synthetic.invalid', demo: true }

// The module keeps its ETag cache per URL, and the URL embeds demoStore/role
// for the synthetic demo transport. Each test uses its own store name so
// these tests never read a validator a previous test already cached.
function settingsFor(demoStore: string) {
  return { demoStore, demoRole: 'manager' }
}

function jsonResponse(body: unknown, etag: string) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', etag },
  })
}

describe('extension panel bootstrap revalidation', () => {
  let calls: Array<{ url: string; headers: Headers }>

  beforeEach(() => {
    calls = []
  })

  function fetchImplFor(responses: Response[]) {
    let index = 0
    return async (url: string, init: RequestInit) => {
      calls.push({ url, headers: new Headers(init.headers) })
      const response = responses[Math.min(index, responses.length - 1)]
      index += 1
      return response
    }
  }

  it('sends no If-None-Match on the first read, then sends the stored ETag and reuses the cached payload on 304', async () => {
    const settings = settingsFor('Synthetic Store A')
    const body = { meta: { reportDate: '2026-09-22' }, vehicles: [] }
    const fetchImpl = fetchImplFor([
      jsonResponse(body, '"synthetic-a"'),
      new Response(null, { status: 304, headers: { etag: '"synthetic-a"' } }),
    ])

    const first = await fetchBootstrap(workspace, settings, { fetchImpl })
    expect(calls[0].headers.get('If-None-Match')).toBeNull()
    expect(first).toEqual(body)

    const second = await fetchBootstrap(workspace, settings, { fetchImpl })
    expect(calls[1].headers.get('If-None-Match')).toBe('"synthetic-a"')
    // The 304 branch must be handled before the generic !response.ok check,
    // which would otherwise report this healthy revalidation as PanelApiError('server').
    expect(second).toBe(first)
  })

  it('replaces the cached payload and validator when the document changes', async () => {
    const settings = settingsFor('Synthetic Store B')
    const first = { meta: { reportDate: '2026-09-22' }, vehicles: [] }
    const second = { meta: { reportDate: '2026-09-23' }, vehicles: [] }
    const fetchImpl = fetchImplFor([
      jsonResponse(first, '"synthetic-a"'),
      jsonResponse(second, '"synthetic-b"'),
      new Response(null, { status: 304, headers: { etag: '"synthetic-b"' } }),
    ])

    await fetchBootstrap(workspace, settings, { fetchImpl })
    const changed = await fetchBootstrap(workspace, settings, { fetchImpl })
    expect(changed).toEqual(second)

    const revalidated = await fetchBootstrap(workspace, settings, { fetchImpl })
    expect(calls[2].headers.get('If-None-Match')).toBe('"synthetic-b"')
    expect(revalidated).toBe(changed)
  })

  it('still surfaces a genuine server failure as PanelApiError, not a swallowed 304', async () => {
    const settings = settingsFor('Synthetic Store C')
    const fetchImpl = fetchImplFor([new Response('boom', { status: 500 })])
    await expect(fetchBootstrap(workspace, settings, { fetchImpl })).rejects.toMatchObject(
      { name: 'PanelApiError', kind: 'server', status: 500 },
    )
  })
})
