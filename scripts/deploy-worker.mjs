// Cross-platform `wrangler deploy` wrapper that tags every version with the
// commit it was built from. The deployment host runs PowerShell, where the
// POSIX `--tag $(git rev-parse --short HEAD)` these scripts used to carry is
// not command substitution and would have been passed through as a literal.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))

const CONFIGS = {
  app: 'cloudflare/wrangler.jsonc',
  integrations: 'cloudflare/integrations.wrangler.jsonc',
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 })
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') throw new Error(`GIT_COMMAND_FAILED: git ${args.join(' ')}\n${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

function runCmd(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: false, windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(`COMMAND_FAILED: ${cmd} ${args.join(' ')}`)
}

function runCmdCapture(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: false, windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(`COMMAND_FAILED: ${cmd} ${args.join(' ')}\n${result.stderr || result.stdout}`)
  return result.stdout
}

// Pure decision logic, kept free of spawnSync so it can be unit-tested
// without a real git checkout: refuse a dirty tree or a HEAD that is not
// origin/main unless the operator opts in with --allow-branch, in which
// case the tag is marked so a hotfix build is never mistaken for main.
export function deployTag({ head, shortHead, originMain, dirty, allowBranch }) {
  if (dirty && !allowBranch) throw new Error('WORKING_TREE_DIRTY: commit or stash your changes, or pass --allow-branch to deploy.')
  if (head !== originMain && !allowBranch) throw new Error('NOT_ON_ORIGIN_MAIN: HEAD does not match origin/main. Pass --allow-branch to deploy an explicit hotfix.')
  return allowBranch ? `${shortHead}-branch` : shortHead
}

function checkBranch(allowBranch) {
  git(['fetch'])
  const head = git(['rev-parse', 'HEAD'])
  const originMain = git(['rev-parse', 'origin/main'])
  const dirty = git(['status', '--porcelain']).length > 0
  const shortHead = git(['rev-parse', '--short', 'HEAD'])
  return deployTag({ head, shortHead, originMain, dirty, allowBranch })
}

function main(argv) {
  const allowBranch = argv.includes('--allow-branch')
  const tag = checkBranch(allowBranch)

  const wrangler = path.join(path.dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js')
  if (!existsSync(wrangler)) throw new Error('WRANGLER_NOT_INSTALLED')

  // Pre-deploy checks
  process.stdout.write(`Running pnpm check...\n`)
  const npmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  runCmd(npmCmd, ['check'])
  
  // dist/build.json is created after build by us
  const distDir = path.join(root, 'dist')
  const buildJsonPath = path.join(distDir, 'build.json')
  const buildInfo = { commit: git(['rev-parse', 'HEAD']) }
  writeFileSync(buildJsonPath, JSON.stringify(buildInfo, null, 2))
  
  process.stdout.write(`Running pnpm cloud:validate...\n`)
  runCmd(npmCmd, ['cloud:validate'])
  
  // Assert dist/build.json before upload
  if (!existsSync(buildJsonPath)) throw new Error('dist/build.json is missing before upload')
  const writtenBuildInfo = JSON.parse(readFileSync(buildJsonPath, 'utf8'))
  if (writtenBuildInfo.commit !== buildInfo.commit) throw new Error('dist/build.json commit mismatch')

  // Pre-deploy D1 check
  process.stdout.write(`Checking pending D1 migrations...\n`)
  const migrationsOut = runCmdCapture(process.execPath, [wrangler, 'd1', 'migrations', 'list', '--remote', '--config', CONFIGS.app])
  if (migrationsOut.includes('unapplied') || migrationsOut.includes('❌') || migrationsOut.includes('[ ]')) {
    throw new Error('PENDING_D1_MIGRATIONS: Apply migrations before deploying')
  }

  // Deploy both app and integrations
  const versionIds = {}
  for (const [target, config] of Object.entries(CONFIGS)) {
    process.stdout.write(`Deploying ${target} Worker from ${config} tagged ${tag}\n`)
    runCmd(process.execPath, [wrangler, 'deploy', '--config', config, '--tag', tag])
    
    // Extract version id
    const out = runCmdCapture(process.execPath, [wrangler, 'deployments', 'list', '--config', config])
    // Parse version ID from `wrangler deployments list`. Output is typically a table. The top row usually is the latest.
    const match = out.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/)
    versionIds[target] = match ? match[1] : 'unknown'
  }

  const deployLog = path.join(root, 'docs', 'SHARED_DATA_DEPLOYMENT.md')
  const logEntry = `\n- ${new Date().toISOString()} | Tag: ${tag} | App Version: ${versionIds.app} | Integrations Version: ${versionIds.integrations}`
  if (existsSync(deployLog)) {
    appendFileSync(deployLog, logEntry)
  }
  process.stdout.write(`\nDeployed successfully.\nApp version: ${versionIds.app}\nIntegrations version: ${versionIds.integrations}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)) } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}
