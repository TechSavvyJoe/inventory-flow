import '@testing-library/jest-dom/vitest'

import { afterEach } from 'vitest'
import { clearWorkspaceMemory } from '../../src/lib/workspace-memory'

function memoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() { return items.size },
    clear: () => items.clear(),
    getItem: key => items.get(key) ?? null,
    key: index => Array.from(items.keys())[index] ?? null,
    removeItem: key => items.delete(key),
    setItem: (key, value) => { items.set(key, String(value)) },
  }
}

function exposeJsdomStorage(name: 'localStorage' | 'sessionStorage') {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
  if (!descriptor || typeof descriptor.value === 'undefined') {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: memoryStorage(),
      writable: true,
    })
  }
}

exposeJsdomStorage('localStorage')
exposeJsdomStorage('sessionStorage')

afterEach(clearWorkspaceMemory)
