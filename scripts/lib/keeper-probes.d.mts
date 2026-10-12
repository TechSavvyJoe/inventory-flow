export type KeeperProbeStatus = 'OK' | 'SESSION_EXPIRED' | 'ERROR'
export const KEEPER_FETCH_TIMEOUT_MS: 30000
export const KEEPER_TARGET_TIMEOUT_MS: 32000
export const KEEPER_CDP_TIMEOUT_MS: 35000
export const KEEPER_PROBE_BUDGET_MS: 120000
export type KeeperProbeResult<T, R> =
  | { target: T; result: R; status: KeeperProbeStatus }
  | { target?: T; result: { probeTimedOut: true }; status: 'ERROR' }
  | { target: T; result: { probeError: string }; status: 'ERROR' }

export function matchingPageTargets<T extends { type?: string; url?: string }>(
  targets: T[],
  pattern: RegExp,
): T[]

export function classifyKeeperProbe(input?: {
  authenticated?: boolean
  expired?: boolean
}): KeeperProbeStatus

export function classifyDealerMailProbe(value?: {
  httpStatus?: number
  sessionEnded?: boolean
  hasGrid?: boolean
  finalUrl?: string
}): KeeperProbeStatus

export function classifyOasisProbe(value?: {
  httpStatus?: number
  oasis?: boolean
  login?: boolean
  finalUrl?: string
}): KeeperProbeStatus

export function isRecognizedSignInRedirect(value?: string): boolean

export function probeMatchingTargets<T, R>(
  targets: T[],
  probe: (target: T, signal: AbortSignal) => Promise<R>,
  classify: (result: R) => KeeperProbeStatus,
  options?: { budgetMs?: number; timeoutMs?: number },
): Promise<KeeperProbeResult<T, R> | null>

export function probeServiceTargets<T, R>(
  targets: T[],
  probe: (target: T, signal: AbortSignal, opened: boolean) => Promise<R>,
  classify: (result: R) => KeeperProbeStatus,
  options?: {
    budgetMs?: number
    timeoutMs?: number
    openTarget?: () => Promise<T>
    closeTarget?: (target: T) => Promise<unknown>
  },
): Promise<KeeperProbeResult<T, R> | null>
