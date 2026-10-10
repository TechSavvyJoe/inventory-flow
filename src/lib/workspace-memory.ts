import { useCallback, useLayoutEffect, useRef, useState, type SetStateAction } from 'react'

// Working context is deliberately memory-only. It must never outlive a verified
// identity, or put a customer search/draft into browser storage or a URL.
const views = new Map<string, unknown>()
let generation = 0

export function clearWorkspaceMemory(): void {
  generation += 1
  views.clear()
}

export function useWorkspaceScroll(context: string | undefined, key: string, {
  initialTop,
  preserveRecordedPositionOnExit = false,
}: { initialTop?: number; preserveRecordedPositionOnExit?: boolean } = {}): void {
  useLayoutEffect(() => {
    if (!context) return
    const cacheKey = `${context}\u0000scroll:${key}`
    const epoch = generation
    const saved = views.get(cacheKey) as { y: number; vehicle?: string } | undefined
    let recorded = saved ?? { y: window.scrollY, vehicle: undefined as string | undefined }
    const top = saved?.y ?? initialTop
    const frame = requestAnimationFrame(() => {
      if (epoch !== generation || top === undefined) return
      window.scrollTo({ top, behavior: 'instant' })
      recorded = { y: top, vehicle: saved?.vehicle }
      if (saved?.vehicle && !document.querySelector('[aria-modal="true"]')) {
        const target = Array.from(document.querySelectorAll<HTMLElement>('[data-inventory-vehicle-trigger]'))
          .find(element => element.dataset.inventoryVehicleTrigger === saved.vehicle && element.getClientRects().length)
        target?.focus({ preventScroll: true })
      }
    })
    const remember = () => {
      if (epoch !== generation) return
      const active = document.activeElement as HTMLElement | null
      const previous = views.get(cacheKey) as { vehicle?: string } | undefined
      recorded = { y: window.scrollY, vehicle: active?.dataset.inventoryVehicleTrigger ?? previous?.vehicle }
      views.set(cacheKey, recorded)
    }
    window.addEventListener('scroll', remember, { passive: true })
    document.addEventListener('focusin', remember)
    return () => {
      cancelAnimationFrame(frame)
      if (preserveRecordedPositionOnExit) {
        // The replacement DOM may already have clamped scrollY. Keep the last
        // observed position of this workspace, not that shorter next screen.
        if (epoch === generation) views.set(cacheKey, recorded)
      } else remember()
      window.removeEventListener('scroll', remember)
      document.removeEventListener('focusin', remember)
    }
  }, [context, key, initialTop, preserveRecordedPositionOnExit])
}

export function useWorkspaceState<T>(context: string | undefined, key: string, initial: T | (() => T)) {
  const cacheKey = context ? `${context}\u0000${key}` : null
  const initialValue = () => typeof initial === 'function' ? (initial as () => T)() : initial
  const read = () => cacheKey && views.has(cacheKey) ? views.get(cacheKey) as T : initialValue()
  const [state, setState] = useState(() => ({ key: cacheKey, generation, value: read() }))
  const current = state.key === cacheKey && state.generation === generation ? state.value : read()
  const scope = useRef({ cacheKey, generation, version: 0 })
  if (scope.current.cacheKey !== cacheKey || scope.current.generation !== generation) {
    scope.current = { cacheKey, generation, version: scope.current.version + 1 }
  }
  const version = scope.current.version
  const epoch = generation
  const mounted = useRef(true)
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const ref = useRef({ cacheKey, value: current, generation, version })
  ref.current = { cacheKey, value: current, generation, version }
  const setValue = useCallback((next: SetStateAction<T>) => {
    const snapshot = ref.current
    if (!mounted.current || epoch !== generation || snapshot.generation !== epoch || snapshot.cacheKey !== cacheKey || snapshot.version !== version) return
    const value = typeof next === 'function' ? (next as (previous: T) => T)(snapshot.value) : next
    ref.current = { ...snapshot, value }
    if (snapshot.cacheKey) views.set(snapshot.cacheKey, value)
    setState({ key: snapshot.cacheKey, generation, value })
  }, [cacheKey, epoch, version])
  return [current, setValue] as const
}
