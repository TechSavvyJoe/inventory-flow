import { useCallback, useLayoutEffect, useRef } from 'react'
import { apiAccessGeneration } from './apiSession'

/** Capture before async work; only update the workspace that started it. */
export function useWorkspaceLifetime(context: string) {
  const scope = useRef({ context, version: 0, mounted: true })
  if (scope.current.context !== context) {
    scope.current = { ...scope.current, context, version: scope.current.version + 1 }
  }
  useLayoutEffect(() => {
    scope.current.mounted = true
    return () => { scope.current.mounted = false; scope.current.version += 1 }
  }, [])
  return useCallback(() => {
    const version = scope.current.version
    const access = apiAccessGeneration()
    return () => scope.current.mounted && scope.current.version === version && apiAccessGeneration() === access
  }, [])
}
