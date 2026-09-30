// @ts-nocheck -- loads the plain MV3 service worker against a minimal Chrome API stub.
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fetchSavedLists, mutateSavedList } from '../../extension/sidepanel/lib/api.mjs'

const origin = 'https://inventory-ops.joegallant.me'
const list = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'AB', revision: 1,
  createdAt: '2026-09-30T12:00:00.000Z', updatedAt: '2026-09-30T12:00:00.000Z', items: [],
}

describe('saved-list panel API transport', () => {
  const workspace = { origin, demo: false }
  const settings = { demoRole: 'sales', demoStore: 'Howell' }

  it('validates the owner-list read response', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ lists: [list] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    await expect(fetchSavedLists(workspace, settings, { fetchImpl })).resolves.toEqual({ lists: [list] })
    expect(fetchImpl).toHaveBeenCalledWith(`${origin}/api/saved-lists`, expect.objectContaining({ method: 'GET', credentials: 'include' }))
  })

  it('sends only the saved-list mutation message and validates the direct list response', async () => {
    const runtime = { sendMessage: vi.fn(async () => ({ status: 201, payload: list })) }
    await expect(mutateSavedList(workspace, settings, { action: 'create', label: 'AB' }, {
      idempotencyKey: 'panel-create', runtime,
    })).resolves.toEqual(list)
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      type: 'inventory-flow:saved-list-mutation', origin,
      input: { action: 'create', label: 'AB' }, idempotencyKey: 'panel-create',
    })
  })
})

describe('saved-list service-worker broker boundary', () => {
  let listener
  let chromeApi
  const panelUrl = 'chrome-extension://inventory-flow-test/sidepanel/index.html'

  beforeAll(async () => {
    chromeApi = {
      runtime: {
        id: 'inventory-flow-test',
        getURL: (path) => `chrome-extension://inventory-flow-test/${path}`,
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn((callback) => { listener = callback }) },
      },
      sidePanel: { setPanelBehavior: vi.fn() },
      contextMenus: { removeAll: vi.fn(), create: vi.fn(), onClicked: { addListener: vi.fn() } },
      tabs: {
        query: vi.fn(async () => [{ id: 7, status: 'complete' }]),
        get: vi.fn(async () => ({ id: 7, status: 'complete' })),
        create: vi.fn(), remove: vi.fn(), onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      scripting: { executeScript: vi.fn(async () => [{ result: { status: 201, payload: list } }]) },
    }
    vi.stubGlobal('chrome', chromeApi)
    await import('../../extension/service-worker.js?extension-saved-lists-test')
  })
  afterAll(() => vi.unstubAllGlobals())

  const validMessage = () => ({
    type: 'inventory-flow:saved-list-mutation', origin,
    input: { action: 'create', label: 'AB' }, idempotencyKey: 'broker-create',
  })
  const panelSender = () => ({ id: 'inventory-flow-test', url: panelUrl })

  it('accepts the side panel and executes only the fixed saved-list route in the app origin', async () => {
    let resolveResponse
    const response = new Promise((resolve) => { resolveResponse = resolve })
    expect(listener(validMessage(), panelSender(), resolveResponse)).toBe(true)
    await expect(response).resolves.toEqual({ status: 201, payload: list })
    expect(chromeApi.tabs.query).toHaveBeenCalledWith({ url: `${origin}/*` })
    const execution = chromeApi.scripting.executeScript.mock.calls.at(-1)[0]
    expect(execution).toMatchObject({ target: { tabId: 7 }, world: 'MAIN' })
    expect(execution.args).toEqual([{ action: 'create', label: 'AB' }, 'broker-create', origin, null])
    expect(String(execution.func)).toMatch(/new URL\(["']\/api\/saved-lists["'], expectedOrigin\)/)
    expect(String(execution.func)).toMatch(/method:\s*["']POST["']/)
  })

  it.each([
    ['content-script sender', validMessage(), { id: 'inventory-flow-test', url: `${origin}/inventory`, tab: { id: 9 } }],
    ['tab-backed sidepanel sender', validMessage(), { ...panelSender(), tab: { id: 9 } }],
    ['wrong extension page', validMessage(), { id: 'inventory-flow-test', url: 'chrome-extension://inventory-flow-test/options.html' }],
    ['wrong extension id', validMessage(), { id: 'different-extension', url: panelUrl }],
    ['wrong origin', { ...validMessage(), origin: 'https://evil.example' }, panelSender()],
    ['unknown action', { ...validMessage(), input: { action: 'email', label: 'AB' } }, panelSender()],
    ['extra field', { ...validMessage(), input: { action: 'create', label: 'AB', phone: '555-0100' } }, panelSender()],
  ])('rejects %s without opening or scripting a tab', (_label, message, sender) => {
    const before = chromeApi.scripting.executeScript.mock.calls.length
    expect(listener(message, sender, vi.fn())).toBe(false)
    expect(chromeApi.scripting.executeScript).toHaveBeenCalledTimes(before)
  })

  it('accepts the exact dev-only loopback workspace with an allowlisted demo context', async () => {
    chromeApi.tabs.query.mockResolvedValueOnce([{ id: 8, status: 'complete' }])
    chromeApi.tabs.get.mockResolvedValueOnce({ id: 8, status: 'complete' })
    let resolveResponse
    const response = new Promise((resolve) => { resolveResponse = resolve })
    const message = {
      ...validMessage(), origin: 'http://127.0.0.1:4173',
      demo: { role: 'sales', store: 'Howell' },
    }
    expect(listener(message, panelSender(), resolveResponse)).toBe(true)
    await response
    expect(chromeApi.scripting.executeScript.mock.calls.at(-1)[0].args.at(-1)).toEqual({ role: 'sales', store: 'Howell' })
  })
})
