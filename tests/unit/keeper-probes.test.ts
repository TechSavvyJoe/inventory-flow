// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  classifyDealerMailProbe,
  classifyKeeperProbe,
  classifyOasisProbe,
  isRecognizedSignInRedirect,
  KEEPER_CDP_TIMEOUT_MS,
  KEEPER_FETCH_TIMEOUT_MS,
  KEEPER_TARGET_TIMEOUT_MS,
  matchingPageTargets,
  probeMatchingTargets,
} from '../../scripts/lib/keeper-probes.mjs'

describe('session keeper probe classification', () => {
  it('continues past three structured network failures and selects a later healthy target', async () => {
    const pages = Array.from({ length: 5 }, (_, index) => ({
      id: String(index), type: 'page', url: `https://service.example.invalid/page/${index}`,
    }))
    const calls: string[] = []
    const matching = matchingPageTargets(pages, /service\.example\.invalid/)
    const selected = await probeMatchingTargets(matching, async page => {
      calls.push(page.id)
      return page.id === '3' || page.id === '4'
        ? { httpStatus: 200, authenticated: true }
        : { httpStatus: 0, error: 'network unavailable' }
    }, value => classifyKeeperProbe({ authenticated: value.authenticated }))
    expect(calls).toEqual(['0', '1', '2', '3'])
    expect(selected?.target?.id).toBe('3')
    expect(selected?.status).toBe('OK')

    calls.length = 0
    const fifth = await probeMatchingTargets(matching, async page => {
      calls.push(page.id)
      return page.id === '4' ? { httpStatus: 200, authenticated: true } : { httpStatus: 0 }
    }, value => classifyKeeperProbe({ authenticated: value.authenticated }))
    expect(calls).toEqual(['0', '1', '2', '3', '4'])
    expect(fifth?.target?.id).toBe('4')
  })

  it('keeps the first positive-expiry result only when no later target is healthy', async () => {
    const targets = [{ id: 'expired' }, { id: 'ambiguous' }]
    const selected = await probeMatchingTargets(targets, async target => target.id === 'expired'
      ? { httpStatus: 401 }
      : { httpStatus: 0, error: 'network unavailable' }, value => classifyKeeperProbe({
      expired: value.httpStatus === 401,
    }))
    expect(selected?.target?.id).toBe('expired')
    expect(selected?.status).toBe('SESSION_EXPIRED')

    const recovered = await probeMatchingTargets([{ id: 'expired' }, { id: 'healthy' }], async target => target.id === 'expired'
      ? { httpStatus: 403 }
      : { httpStatus: 200, authenticated: true }, value => classifyKeeperProbe({
      authenticated: value.authenticated,
      expired: value.httpStatus === 403,
    }))
    expect(recovered?.target?.id).toBe('healthy')
    expect(recovered?.status).toBe('OK')
  })

  it('returns an ambiguous result when every target is ambiguous', async () => {
    const targets = [{ id: 'first' }, { id: 'last' }]
    const selected = await probeMatchingTargets(targets, async target => ({ error: target.id }), () => 'ERROR')
    expect(selected?.target?.id).toBe('last')
    expect(selected?.status).toBe('ERROR')
  })

  it('aborts a stalled probe before the outer target deadline and obeys an overall budget', async () => {
    const signals: AbortSignal[] = []
    const started = Date.now()
    const selected = await probeMatchingTargets([{ id: 'stalled' }, { id: 'over-budget' }], (_target, signal) => {
      signals.push(signal)
      return new Promise(() => {})
    }, () => 'ERROR', { timeoutMs: 200, budgetMs: 75 })
    expect(Date.now() - started).toBeLessThan(250)
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(true)
    expect(selected?.result).toEqual({ probeTimedOut: true })
    expect(KEEPER_FETCH_TIMEOUT_MS).toBeLessThan(KEEPER_TARGET_TIMEOUT_MS)
    expect(KEEPER_TARGET_TIMEOUT_MS).toBeLessThan(KEEPER_CDP_TIMEOUT_MS)
  })

  it('recognizes only a known identity host with a sign-in protocol path', () => {
    expect(isRecognizedSignInRedirect('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')).toBe(true)
    expect(isRecognizedSignInRedirect('https://www.fordvisions.dealerconnection.com/vinv/login/report')).toBe(false)
    expect(isRecognizedSignInRedirect('https://www.fordvisions.dealerconnection.com/vinv/GetInvoice.aspx')).toBe(false)
    expect(isRecognizedSignInRedirect('https://evil.example.invalid/login')).toBe(false)
    expect(isRecognizedSignInRedirect('https://evil.example.invalid/sso')).toBe(false)
  })

  it('preserves sign-in expiry through selection and final DealerMail and OASIS status', async () => {
    const microsoftRedirect = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
    const cases = [
      {
        classify: classifyDealerMailProbe,
        result: { httpStatus: 200, bytes: 0, finalUrl: microsoftRedirect, sessionEnded: false, hasGrid: false },
      },
      {
        classify: classifyOasisProbe,
        result: { httpStatus: 200, finalUrl: microsoftRedirect, oasis: false, login: false },
      },
    ]

    for (const { classify, result } of cases) {
      const selected = await probeMatchingTargets([{ id: 'current' }], async () => result, classify)
      expect(selected?.status).toBe('SESSION_EXPIRED')
      if (!selected || !('finalUrl' in selected.result)) throw new Error('Expected the selected sign-in redirect probe')
      expect(classify(selected.result)).toBe('SESSION_EXPIRED')
    }
  })

  it('keeps network failures retryable and reports expiry only from positive evidence', () => {
    expect(classifyKeeperProbe({})).toBe('ERROR')
    expect(classifyKeeperProbe({ expired: false })).toBe('ERROR')
    expect(classifyKeeperProbe({ expired: true })).toBe('SESSION_EXPIRED')
    expect(classifyKeeperProbe({ authenticated: true, expired: true })).toBe('OK')
  })
})
