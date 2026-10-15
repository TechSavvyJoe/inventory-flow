/**
 * Role and home-store preview choices are UI preferences only — never auth.
 * Hosted production keeps them session-only so a leftover preview cannot outlive
 * the Access tab. The local synthetic demo may keep them across reloads.
 */

export type PreviewPreferenceEnv = {
  durableAcrossReloads: boolean
}

function activeStorage(env: PreviewPreferenceEnv): Storage {
  return env.durableAcrossReloads ? window.localStorage : window.sessionStorage
}

export function readPreviewPreference(key: string, env: PreviewPreferenceEnv = defaultPreviewPreferenceEnv()): string | null {
  try {
    const primary = activeStorage(env)
    const value = primary.getItem(key)
    if (value != null) return value
    if (!env.durableAcrossReloads) {
      // Lift one legacy durable key into the session store, then drop it.
      const legacy = window.localStorage.getItem(key)
      if (legacy != null) {
        primary.setItem(key, legacy)
        window.localStorage.removeItem(key)
        return legacy
      }
    }
    return null
  } catch {
    return null
  }
}

export function writePreviewPreference(key: string, value: string, env: PreviewPreferenceEnv = defaultPreviewPreferenceEnv()): void {
  try {
    const primary = activeStorage(env)
    primary.setItem(key, value)
    if (!env.durableAcrossReloads) window.localStorage.removeItem(key)
  } catch {
    // Best-effort only; the app must keep working with the in-memory value.
  }
}

export function defaultPreviewPreferenceEnv(): PreviewPreferenceEnv {
  return { durableAcrossReloads: import.meta.env.DEV }
}
