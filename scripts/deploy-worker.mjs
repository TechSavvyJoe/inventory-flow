// Cross-platform `wrangler deploy` wrapper that tags every version with the
// commit it was built from. The deployment host runs PowerShell, where the
// POSIX `--tag $(git rev-parse --short HEAD)` these scripts used to carry is
// not command substitution and would have been passed through as a literal.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { isMainModule } from './lib/is-main.mjs'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))

const CONFIGS = {
  app: 'cloudflare/wrangler.jsonc',
  integrations: 'cloudflare/integrations.wrangler.jsonc',
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 })
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') throw new Error(`GIT_COMMAND_FAILED: git ${args.join(' ')}`)
  return result.stdout
}

/** Wrangler tags are limited to alphanumerics, dashes and underscores. */
export function deployTag({ sha, dirty, allowDirty }) {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error('COMMIT_SHA_UNRESOLVED')
  if (!dirty) return sha
  // A tag that claims a commit the deployed bundle does not match is worse
  // than no tag at all, so a dirty tree stops the deploy unless the operator
  // says in the command that they know the version is not that commit.
  if (!allowDirty) throw new Error('WORKING_TREE_DIRTY: commit or stash your changes, or pass --allow-dirty to tag this deploy <sha>-dirty.')
  return `${sha}-dirty`
}

export function resolveTag({ allowDirty }) {
  return deployTag({ sha: git(['rev-parse', '--short', 'HEAD']).trim(), dirty: git(['status', '--porcelain']).trim().length > 0, allowDirty })
}

function main(argv) {
  const target = argv[0]
  const config = CONFIGS[target]
  if (!config) throw new Error(`DEPLOY_TARGET_REQUIRED: expected one of ${Object.keys(CONFIGS).join(', ')}`)
  const extra = argv.slice(1).filter(argument => argument !== '--allow-dirty')
  const tag = resolveTag({ allowDirty: argv.includes('--allow-dirty') })
  const wrangler = path.join(path.dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js')
  if (!existsSync(wrangler)) throw new Error('WRANGLER_NOT_INSTALLED')
  process.stdout.write(`Deploying ${target} Worker from ${config} tagged ${tag}\n`)
  const result = spawnSync(process.execPath, [wrangler, 'deploy', '--config', config, '--tag', tag, ...extra], { cwd: root, stdio: 'inherit', shell: false, windowsHide: true })
  if (result.error || result.status !== 0) throw new Error('WRANGLER_DEPLOY_FAILED')
}

if (isMainModule(import.meta.url)) {
  try { main(process.argv.slice(2)) } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}
