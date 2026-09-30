// @ts-nocheck -- loads the plain MV3 service worker against a minimal Chrome API stub.
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { clearApiCache, fetchBootstrap, fetchSavedLists, mutateSavedList } from '../../extension/sidepanel/lib/api.mjs'

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
    await expect(fetchSavedLists(workspace, settings, { fetchImpl, expectedOwnerId:'synthetic-owner-a' })).resolves.toEqual({ lists: [list] })
    expect(fetchImpl).toHaveBeenCalledWith(`${origin}/api/saved-lists`, expect.objectContaining({ method: 'GET', credentials: 'include' }))
    expect(new Headers(fetchImpl.mock.calls[0][1].headers).get('x-inventory-saved-list-owner')).toBe('synthetic-owner-a')
  })

  it('sends only the saved-list mutation message and validates the direct list response', async () => {
    const runtime = { sendMessage: vi.fn(async () => ({ status: 201, payload: list })) }
    await expect(mutateSavedList(workspace, settings, { action: 'create', label: 'AB' }, {
      idempotencyKey: 'panel-create', runtime, expectedOwnerId:'synthetic-owner-a',
    })).resolves.toEqual(list)
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      type: 'inventory-flow:saved-list-mutation', origin,
      input: { action: 'create', label: 'AB' }, idempotencyKey: 'panel-create', expectedOwnerId:'synthetic-owner-a',
    })
  })

  it('refuses a transport request without verified owner identity', async () => {
    const fetchImpl = vi.fn(), runtime = { sendMessage:vi.fn() }
    await expect(fetchSavedLists(workspace, settings, { fetchImpl })).rejects.toMatchObject({ status:403 })
    await expect(mutateSavedList(workspace, settings, { action:'create', label:'AB' }, { runtime })).rejects.toMatchObject({ status:403 })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(runtime.sendMessage).not.toHaveBeenCalled()
  })

  it.each([201, 403])('ignores a late owner-A mutation response (%s) and retains owner-B validators', async (status) => {
    clearApiCache()
    let finishMutation
    const runtime = { sendMessage:vi.fn(() => new Promise(resolve => { finishMutation = resolve })) }
    const pending = mutateSavedList(workspace, settings, { action:'create', label:'AB' }, { runtime, idempotencyKey:'late-a', expectedOwnerId:'synthetic-owner-a' })
    const rejected = expect(pending).rejects.toMatchObject({ name:'AbortError' })
    clearApiCache()
    const b = { meta:{ reportDate:'2026-09-30' }, vehicles:[], access:{ userId:'synthetic-owner-b' } }
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(b), { headers:{ 'content-type':'application/json', etag:'"owner-b"' } })).mockResolvedValueOnce(new Response(null, { status:304 }))
    await fetchBootstrap(workspace, settings, { fetchImpl })
    finishMutation({ status, payload:list })
    await rejected
    expect(await fetchBootstrap(workspace, settings, { fetchImpl })).toEqual(b)
    expect(new Headers(fetchImpl.mock.calls[1][1].headers).get('If-None-Match')).toBe('"owner-b"')
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
    input: { action: 'create', label: 'AB' }, idempotencyKey: 'broker-create', expectedOwnerId: 'saved-sales-1',
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
    expect(execution.args).toEqual([{ action: 'create', label: 'AB' }, 'broker-create', origin, null, 'saved-sales-1'])
    expect(String(execution.func)).toMatch(/new URL\(["']\/api\/saved-lists["'], expectedOrigin\)/)
    expect(String(execution.func)).toMatch(/method:\s*["']POST["']/)
    expect(String(execution.func)).toMatch(/["']x-inventory-saved-list-owner["']:\s*expectedOwnerId/)
  })

  it.each([
    ['content-script sender', validMessage(), { id: 'inventory-flow-test', url: `${origin}/inventory`, tab: { id: 9 } }],
    ['tab-backed sidepanel sender', validMessage(), { ...panelSender(), tab: { id: 9 } }],
    ['wrong extension page', validMessage(), { id: 'inventory-flow-test', url: 'chrome-extension://inventory-flow-test/options.html' }],
    ['wrong extension id', validMessage(), { id: 'different-extension', url: panelUrl }],
    ['wrong origin', { ...validMessage(), origin: 'https://evil.example' }, panelSender()],
    ['unknown action', { ...validMessage(), input: { action: 'email', label: 'AB' } }, panelSender()],
    ['extra field', { ...validMessage(), input: { action: 'create', label: 'AB', phone: '555-0100' } }, panelSender()],
    ['missing expected owner', { ...validMessage(), expectedOwnerId: undefined }, panelSender()],
    ['blank expected owner', { ...validMessage(), expectedOwnerId: ' ' }, panelSender()],
    ['control character in expected owner', { ...validMessage(), expectedOwnerId: 'owner\u0000id' }, panelSender()],
    ['overlong expected owner', { ...validMessage(), expectedOwnerId: 'a'.repeat(161) }, panelSender()],
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
    expect(chromeApi.scripting.executeScript.mock.calls.at(-1)[0].args[3]).toEqual({ role: 'sales', store: 'Howell' })
  })

  it('preserves the original expected owner through delayed execution so the server can reject an account switch', async () => {
    let executionStarted
    const started = new Promise((resolve) => { executionStarted = resolve })
    let continueExecution
    const paused = new Promise((resolve) => { continueExecution = resolve })
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init.headers['x-inventory-saved-list-owner']).toBe('saved-sales-1')
      return new Response(JSON.stringify({ code: 'ACCESS_CONTEXT_CHANGED' }), {
        status: 403, headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('location', { origin })
    vi.stubGlobal('fetch', fetchImpl)
    chromeApi.scripting.executeScript.mockImplementationOnce(async (execution) => {
      executionStarted()
      await paused
      return [{ result: await execution.func(...execution.args) }]
    })
    let resolveResponse
    const response = new Promise((resolve) => { resolveResponse = resolve })
    const message = validMessage()
    expect(listener(message, panelSender(), resolveResponse)).toBe(true)
    await started
    message.expectedOwnerId = 'saved-sales-2'
    continueExecution()
    await expect(response).resolves.toEqual({
      status: 403, redirected: false, payload: { code: 'ACCESS_CONTEXT_CHANGED' },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
