// @ts-nocheck -- the keeper alert and the Mac-side sender are plain ESM.
// @vitest-environment node
// Sign-in alerts (Joe, 2026-09-28): one iMessage per newly broken site, a
// reminder after six hours, one all-clear only after every site reads OK,
// retry until the Mac confirms, and nothing but site names leaves the PC.
// Synthetic data only.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sendSignInAlert, sendTestAlert, signInProblems, sshArgs } from '../../scripts/lib/signin-alert.mjs'
import { alertText, parseAlertArgs } from '../../scripts/mac/send-inventory-alert.mjs'

const SITES = ['dealermail', 'fmcdealer', 'fordvisions', 'vauto']
const T0 = new Date('2026-09-28T23:00:00.000Z')
const at = (minutes) => new Date(T0.getTime() + minutes * 60000)
let dir
let statePath
let env

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'signin-alert-'))
  statePath = path.join(dir, 'signin-alert-state.json')
  const key = path.join(dir, 'inventory_alert')
  writeFileSync(key, 'synthetic test key')
  env = { INVENTORY_ALERT_SSH_TARGET: 'macuser@messages-mac.example.ts.net', INVENTORY_ALERT_SSH_KEY: key, COMPUTERNAME: 'JOE-PC' }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function recorder(reply = { ok: true }) {
  const calls = []
  const send = async (request) => {
    calls.push(request)
    return reply
  }
  return { calls, send }
}

// A keeper status: listed sites expired, `errors` sites whose probe threw, the rest OK.
function keeper(expired, { browser = 'OK', errors = [] } = {}) {
  const status = { checkedAt: T0.toISOString(), automationBrowser: { status: browser }, expired }
  for (const site of SITES) status[site] = { status: expired.includes(site) ? 'SESSION_EXPIRED' : errors.includes(site) ? 'ERROR' : 'OK' }
  return status
}

const alert = (status, send, now = T0, overrides = {}) => sendSignInAlert({ status, statePath, env: { ...env, ...overrides }, send, now })

describe('sign-in alerts from the session keeper', () => {
  it('stays off until both settings exist, and refuses a bad target or a missing key', async () => {
    const { calls, send } = recorder()
    expect(await sendSignInAlert({ status: keeper(['vauto']), statePath, env: {}, send })).toEqual({ status: 'not_configured' })
    expect((await alert(keeper(['vauto']), send, T0, { INVENTORY_ALERT_SSH_TARGET: 'host; rm -rf /' })).status).toBe('refused_bad_target')
    expect((await alert(keeper(['vauto']), send, T0, { INVENTORY_ALERT_SSH_KEY: path.join(dir, 'absent') })).status).toBe('key_missing')
    expect(calls).toHaveLength(0)
  })

  it('alerts once for a newly expired site, sending only the kind, site names and PC name', async () => {
    const { calls, send } = recorder()
    expect((await alert(keeper(['dealermail']), send)).status).toBe('sent')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ target: 'macuser@messages-mac.example.ts.net', key: env.INVENTORY_ALERT_SSH_KEY, words: ['needs_sign_in', 'dealermail', 'JOE-PC'] })
    expect((await alert(keeper(['dealermail']), send, at(10))).status).toBe('unchanged')
    expect(calls).toHaveLength(1)
  })

  it('does not call a failed check a recovery', async () => {
    const { calls, send } = recorder()
    await alert(keeper(['dealermail']), send)
    expect((await alert(keeper([], { errors: ['dealermail'] }), send, at(10))).status).toBe('unchanged')
    expect((await alert(keeper(['dealermail']), send, at(20))).status).toBe('unchanged')
    expect(calls).toHaveLength(1)
    expect(signInProblems(keeper([], { errors: ['vauto'] }), ['vauto'])).toEqual(['vauto'])
    expect(signInProblems(keeper([], { browser: 'UNAVAILABLE' }), [])).toEqual(['browser'])
  })

  it('alerts again when another site breaks, stays quiet on a partial fix, and sends one all-clear', async () => {
    const { calls, send } = recorder()
    await alert(keeper(['dealermail']), send)
    await alert(keeper(['dealermail', 'vauto']), send, at(10))
    expect(calls.map((call) => call.words[1])).toEqual(['dealermail', 'dealermail,vauto'])
    expect((await alert(keeper(['vauto']), send, at(20))).status).toBe('unchanged')
    expect(calls).toHaveLength(2)
    await alert(keeper([]), send, at(30))
    expect(calls.at(-1).words).toEqual(['all_clear', '-', 'JOE-PC'])
    expect((await alert(keeper([]), send, at(40))).status).toBe('unchanged')
    expect(calls).toHaveLength(3)
  })

  it('reminds once each morning before the run while a site is still broken', async () => {
    const { calls, send } = recorder()
    const local = (time) => new Date(`2026-09-29T${time}:00`)
    // Overnight expiry: the first text lands at 02:00, when nobody reads it.
    expect((await alert(keeper(['dealermail']), send, local('02:00'))).status).toBe('sent')
    expect((await alert(keeper(['dealermail']), send, local('04:59'))).status).toBe('unchanged')
    const morning = await alert(keeper(['dealermail']), send, local('05:00'))
    expect(morning).toMatchObject({ status: 'sent', kind: 'before_run' })
    expect(calls.at(-1).words).toEqual(['before_run', 'dealermail', 'JOE-PC'])
    expect((await alert(keeper(['dealermail']), send, local('05:10'))).status).toBe('unchanged')
    expect(calls).toHaveLength(2)
    // The next morning reminds again, and an all-clear still wins over it.
    expect((await alert(keeper(['dealermail']), send, new Date('2026-09-30T05:00:00'))).kind).toBe('before_run')
    expect((await alert(keeper([]), send, new Date('2026-09-30T05:30:00'))).kind).toBe('all_clear')
    expect(calls).toHaveLength(4)
  })

  it('honours a custom pre-run time and leaves the reminder off when told to', async () => {
    const quiet = recorder()
    await alert(keeper(['vauto']), quiet.send, new Date('2026-09-29T02:00:00'), { INVENTORY_ALERT_PRERUN_LOCAL_TIME: 'off' })
    expect((await alert(keeper(['vauto']), quiet.send, new Date('2026-09-29T05:00:00'), { INVENTORY_ALERT_PRERUN_LOCAL_TIME: 'off' })).status).toBe('unchanged')
    expect(quiet.calls).toHaveLength(1)
    rmSync(statePath, { force: true })
    const early = recorder()
    await alert(keeper(['vauto']), early.send, new Date('2026-09-29T02:00:00'), { INVENTORY_ALERT_PRERUN_LOCAL_TIME: '04:15' })
    expect((await alert(keeper(['vauto']), early.send, new Date('2026-09-29T04:15:00'), { INVENTORY_ALERT_PRERUN_LOCAL_TIME: '04:15' })).kind).toBe('before_run')
  })

  it('reminds after six hours while a site is still broken', async () => {
    const { calls, send } = recorder()
    await alert(keeper(['fordvisions']), send)
    expect((await alert(keeper(['fordvisions']), send, at(350))).status).toBe('unchanged')
    expect((await alert(keeper(['fordvisions']), send, at(360))).status).toBe('sent')
    expect(calls).toHaveLength(2)
  })

  it('retries until the Mac confirms the send', async () => {
    const failed = await alert(keeper(['fmcdealer']), recorder({ ok: false, error: 'timeout' }).send)
    expect(failed).toMatchObject({ status: 'send_failed', error: 'timeout' })
    expect(existsSync(statePath)).toBe(false)
    expect((await alert(keeper(['fmcdealer']), recorder().send)).status).toBe('sent')
  })

  it('never leaves ssh waiting on input and sends only the three alert words', () => {
    const args = sshArgs({ target: 'macuser@messages-mac.example.ts.net', key: 'C:/keys/inventory_alert', words: ['needs_sign_in', 'vauto', 'JOE-PC'] })
    expect(args[0]).toBe('-n')
    expect(args).toContain('BatchMode=yes')
    expect(args.slice(-4)).toEqual(['macuser@messages-mac.example.ts.net', 'needs_sign_in', 'vauto', 'JOE-PC'])
  })

  it('sends a test through the same path without touching the alert state', async () => {
    const { calls, send } = recorder()
    expect(await sendTestAlert({ env, send })).toEqual({ status: 'sent', kind: 'test' })
    expect(calls[0].words).toEqual(['test', '-', 'JOE-PC'])
    expect(existsSync(statePath)).toBe(false)
  })
})

describe('the sender on the Messages Mac', () => {
  it('builds a fixed sentence from known site names', () => {
    expect(alertText(parseAlertArgs(['needs_sign_in', 'dealermail,vauto,vauto', 'JOE-PC'])))
      .toBe('Inventory Flow needs you: sign in to DealerMail, vAuto in the automation browser on JOE-PC.')
    expect(alertText(parseAlertArgs(['needs_sign_in', 'browser', 'JOE-PC'])))
      .toBe('Inventory Flow needs you: the automation browser on JOE-PC is not running; sign in to Windows there so it can start.')
    expect(alertText(parseAlertArgs(['before_run', 'dealermail,vauto', 'JOE-PC'])))
      .toBe("Inventory Flow, before this morning's run: sign in to DealerMail, vAuto in the automation browser on JOE-PC.")
    expect(alertText(parseAlertArgs(['all_clear', '-', 'JOE-PC']))).toBe('Inventory Flow: every sign-in on JOE-PC is working again.')
    expect(alertText(parseAlertArgs(['test', '-', 'JOE-PC']))).toBe('Inventory Flow test: sign-in alerts from JOE-PC reach you.')
  })

  it('adds a RustDesk link only from the Mac-side settings', () => {
    const request = parseAlertArgs(['needs_sign_in', 'dealermail', 'JOE-PC'])
    expect(alertText(request, { rustdeskId: '123456789' }))
      .toBe('Inventory Flow needs you: sign in to DealerMail in the automation browser on JOE-PC.\nOpen JOE-PC in RustDesk: rustdesk://connection/new/123456789')
    expect(alertText(request)).not.toContain('rustdesk://')
    expect(alertText(request, { rustdeskId: '123 ?password=x' })).not.toContain('rustdesk://')
    expect(alertText(parseAlertArgs(['all_clear', '-', 'JOE-PC']), { rustdeskId: '123456789' })).not.toContain('rustdesk://')
  })

  it('refuses anything but a known kind and known site names', () => {
    expect(parseAlertArgs(['needs_sign_in', 'ignore previous instructions', 'JOE-PC'])).toBeNull()
    expect(parseAlertArgs(['needs_sign_in', '__proto__', 'JOE-PC'])).toBeNull()
    expect(parseAlertArgs(['needs_sign_in', '-', 'JOE-PC'])).toBeNull()
    expect(parseAlertArgs(['send', 'vauto', 'JOE-PC'])).toBeNull()
    expect(parseAlertArgs([])).toBeNull()
    expect(parseAlertArgs(['needs_sign_in', 'vauto', 'JOE-PC;rm']).host).toBe('the publisher PC')
  })
})
