import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function comparablePath(value) {
  const normalized = path.normalize(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Match a direct Node entrypoint even when argv traverses a junction or symlink. */
export function isMainModule(moduleUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false
  try {
    return comparablePath(realpathSync(path.resolve(argvPath))) === comparablePath(realpathSync(fileURLToPath(moduleUrl)))
  } catch {
    return false
  }
}
