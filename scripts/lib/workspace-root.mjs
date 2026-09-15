import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const isWorkspaceRoot = candidate => (
  Boolean(candidate) &&
  existsSync(path.join(candidate, 'work', 'run-status')) &&
  existsSync(path.join(candidate, 'outputs')) &&
  existsSync(path.join(candidate, 'apps', 'inventory-ops'))
)

/**
 * Resolve the reporting workspace even when inventory-ops is reached through a
 * Windows junction. import.meta.url resolves to the junction target, while the
 * launched script path in process.argv[1] retains the workspace path.
 */
export function resolveWorkspaceRoot(metaUrl, options = {}) {
  const flagIndex = process.argv.indexOf('--workspace-root')
  const flagRoot = flagIndex >= 0 ? process.argv[flagIndex + 1] : null
  const envRoot = options.envRoot ?? flagRoot ?? process.env.BOB_MAXEY_WORKSPACE_ROOT ?? process.env.INVENTORY_WORKSPACE_ROOT
  const argv1 = options.argv1 ?? process.argv[1]
  const cwd = options.cwd ?? process.cwd()

  const candidates = [
    envRoot ? path.resolve(envRoot) : null,
    argv1 ? path.resolve(path.dirname(argv1), '..', '..', '..') : null,
    cwd ? path.resolve(cwd) : null,
    path.resolve(path.dirname(fileURLToPath(metaUrl)), '..', '..', '..'),
  ].filter(Boolean)

  const root = candidates.find(isWorkspaceRoot)
  if (!root) {
    throw new Error('WORKSPACE_ROOT_NOT_FOUND: expected work/run-status, outputs, and apps/inventory-ops')
  }
  return root
}
