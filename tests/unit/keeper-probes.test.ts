// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
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
  probeServiceTargets,
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

describe('session keeper fresh-tab recovery', () => {
  // Synthetic targets and injected callbacks only; no operational keeper import.
  it('recovers once when all existing probes time out or throw without closing existing tabs', async () => {
    vi.useFakeTimers()
    try {
      const stalled = { id: 'existing-stalled' }
      const broken = { id: 'existing-broken' }
      const fresh = { id: 'keeper-fresh' }
      const attempts: { id: string; opened: boolean; signal: AbortSignal }[] = []
      const openTarget = vi.fn(async () => fresh)
      const closeTarget = vi.fn(async () => {})
      const pending = probeServiceTargets([stalled, broken], async (target, signal, opened) => {
        attempts.push({ id: target.id, opened, signal })
        if (target === stalled) return new Promise<never>(() => {})
        if (target === broken) throw new Error('synthetic CDP failure')
        return { target, opened, authenticated: true }
      }, classifyKeeperProbe, { openTarget, closeTarget, timeoutMs: 25, budgetMs: 100 })

      await vi.advanceTimersByTimeAsync(25)
      const selected = await pending
      expect(attempts.map(({ id, opened }) => ({ id, opened }))).toEqual([
        { id: stalled.id, opened: false },
        { id: broken.id, opened: false },
        { id: fresh.id, opened: true },
      ])
      expect(attempts[0].signal.aborted).toBe(true)
      expect(openTarget).toHaveBeenCalledTimes(1)
      expect(closeTarget).not.toHaveBeenCalled()
      expect(selected?.target).toBe(fresh)
      expect(selected?.status).toBe('OK')
      expect(selected?.result).toEqual({ target: fresh, opened: true, authenticated: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries structured network failures in one fresh target', async () => {
    const existing = [{ id: 'existing-first' }, { id: 'existing-last' }]
    const fresh = { id: 'keeper-fresh' }
    const openTarget = vi.fn(async () => fresh)
    const closeTarget = vi.fn(async () => {})
    const selected = await probeServiceTargets(existing, async (target, _signal, opened) => ({
      target, opened, value: target === fresh
        ? { httpStatus: 200, hasGrid: true }
        : { httpStatus: 0, error: 'synthetic network unavailable' },
    }), result => classifyDealerMailProbe(result.value), { openTarget, closeTarget })
    expect(selected?.target).toBe(fresh)
    expect(selected?.status).toBe('OK')
    expect(openTarget).toHaveBeenCalledTimes(1)
    expect(closeTarget).not.toHaveBeenCalled()
  })

  it.each([
    { status: 'OK', value: { httpStatus: 200, hasGrid: true } },
    { status: 'SESSION_EXPIRED', value: { httpStatus: 401 } },
    { status: 'SESSION_EXPIRED', value: { httpStatus: 200, sessionEnded: true } },
  ])('does not open a fresh tab after positive $status evidence', async ({ status, value }) => {
    const existing = { id: 'existing-classified' }
    const openTarget = vi.fn(async () => ({ id: 'unexpected-fresh' }))
    const closeTarget = vi.fn(async () => {})
    const selected = await probeServiceTargets([existing, { id: 'existing-error' }], async (target, _signal, opened) => ({
      target, opened, value: target === existing ? value : { httpStatus: 0 },
    }), result => classifyDealerMailProbe(result.value), { openTarget, closeTarget })
    expect(selected?.target).toBe(existing)
    expect(selected?.status).toBe(status)
    expect(selected?.result).toEqual({ target: existing, opened: false, value })
    expect(openTarget).not.toHaveBeenCalled()
    expect(closeTarget).not.toHaveBeenCalled()
  })

  it.each(['throw', 'timeout'] as const)('closes only the owned fresh tab when its probe fails with %s', async failure => {
    vi.useFakeTimers()
    try {
      const existing = { id: 'existing-error' }
      const fresh = { id: 'keeper-fresh' }
      const signals: AbortSignal[] = []
      const openTarget = vi.fn(async () => fresh)
      const closeTarget = vi.fn(async () => {})
      const pending = probeServiceTargets([existing], async (target, signal) => {
        if (target === existing) return { authenticated: false }
        signals.push(signal)
        if (failure === 'throw') throw new Error('synthetic fresh probe failure')
        return new Promise<never>(() => {})
      }, classifyKeeperProbe, { openTarget, closeTarget, timeoutMs: 25, budgetMs: 100 })
      await vi.advanceTimersByTimeAsync(25)
      const selected = await pending
      expect(selected?.target).toBe(fresh)
      expect(selected?.status).toBe('ERROR')
      expect(selected?.result).toEqual(failure === 'throw'
        ? { probeError: 'synthetic fresh probe failure' }
        : { probeTimedOut: true })
      expect(openTarget).toHaveBeenCalledTimes(1)
      expect(closeTarget).toHaveBeenCalledExactlyOnceWith(fresh)
      expect(signals[0].aborted).toBe(failure === 'timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('retains a fresh structured MSAL error and exact target for the Fordvisions renewal caller', async () => {
    const existing = { id: 'existing-error' }
    const fresh = { id: 'keeper-fresh' }
    const openTarget = vi.fn(async () => fresh)
    const closeTarget = vi.fn(async () => {})
    const renewalResult = { value: { httpStatus: 200, msal: true, pdf: false, fordRefusal: false }, target: fresh, opened: true }
    const selected = await probeServiceTargets([existing], async target => {
      if (target === existing) throw new Error('synthetic existing probe failure')
      return renewalResult
    }, result => classifyKeeperProbe({ authenticated: result.value.pdf || result.value.fordRefusal }), { openTarget, closeTarget })
    expect(selected?.status).toBe('ERROR')
    expect(selected?.target).toBe(fresh)
    expect(selected?.result).toBe(renewalResult)
    expect(openTarget).toHaveBeenCalledTimes(1)
    expect(closeTarget).not.toHaveBeenCalled()
  })

  it('closes the owned fresh target if classification throws', async () => {
    const fresh = { id: 'keeper-fresh' }
    const closeTarget = vi.fn(async () => {})
    await expect(probeServiceTargets([], async () => ({ authenticated: false }), () => {
      throw new Error('synthetic classification failure')
    }, { openTarget: async () => fresh, closeTarget })).rejects.toThrow('synthetic classification failure')
    expect(closeTarget).toHaveBeenCalledExactlyOnceWith(fresh)
  })

  it('preserves inconclusive and missing-target results when no fresh-tab URL is configured', async () => {
    const existing = { id: 'existing-error' }
    const closeTarget = vi.fn(async () => {})
    const selected = await probeServiceTargets([existing], async (target, _signal, opened) => ({
      target, opened, authenticated: false,
    }), classifyKeeperProbe, { closeTarget })
    expect(selected).toEqual({ target: existing, result: { target: existing, opened: false, authenticated: false }, status: 'ERROR' })
    expect(await probeServiceTargets([], async () => ({ authenticated: true }), classifyKeeperProbe, { closeTarget })).toBeNull()
    expect(closeTarget).not.toHaveBeenCalled()
  })

  it('opens and probes exactly one target when no matching tab exists', async () => {
    const fresh = { id: 'keeper-fresh' }
    const openTarget = vi.fn(async () => fresh)
    const probe = vi.fn(async (target: typeof fresh, _signal: AbortSignal, opened: boolean) => ({ target, opened, authenticated: true }))
    const selected = await probeServiceTargets([], probe, classifyKeeperProbe, { openTarget })
    expect(openTarget).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(selected?.result).toEqual({ target: fresh, opened: true, authenticated: true })
    expect(selected?.status).toBe('OK')
  })
})
