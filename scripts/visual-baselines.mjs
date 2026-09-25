import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { crc32 } from 'node:zlib'

export const REPOSITORY = 'TechSavvyJoe/inventory-flow'
export const RENDERER = 'mcr.microsoft.com/playwright:v1.62.1-noble'
export const PLAYWRIGHT_VERSION = '1.62.1'
export const MAX_PNG_BYTES = 8 * 1024 * 1024
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const VIEWPORTS = ['390x844', '1024x768', '1320x820', '1440x900']
const STATES = ['inventory-list', 'inventory-filters-open', 'vehicle-workspace-overview', 'vehicle-workspace-holds', 'moves-list', 'moves-tracker', 'service', 'admin']
export const EXPECTED_FILES = Object.freeze(STATES.flatMap((state) => VIEWPORTS.map((viewport) => `${state}-visual-${viewport}-linux.png`)).sort())
const EXPECTED_NAMES = new Set(EXPECTED_FILES)
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const HASH = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const DIGITS = /^\d{1,32}$/
const ASSET_HOSTS = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com'])

export class VisualBaselineError extends Error {
  constructor(message) { super(message); this.name = 'VisualBaselineError' }
}

function fail(message) { throw new VisualBaselineError(message) }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex') }

function exactObject(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field))
}

function provenance(value) {
  if (value.renderer !== RENDERER || value.playwrightVersion !== PLAYWRIGHT_VERSION ||
      typeof value.sourceCommit !== 'string' || !COMMIT.test(value.sourceCommit) ||
      typeof value.sourceRunId !== 'string' || !DIGITS.test(value.sourceRunId)) {
    fail('Visual baseline provenance is invalid.')
  }
}

export function validateBaselinePin(pin) {
  if (!exactObject(pin, ['schemaVersion', 'repository', 'renderer', 'playwrightVersion', 'sourceCommit', 'sourceRunId', 'assetId', 'sha256', 'fileCount', 'reviewedAt']) ||
      pin.schemaVersion !== 1 || pin.repository !== REPOSITORY || pin.fileCount !== EXPECTED_FILES.length ||
      typeof pin.assetId !== 'string' || !DIGITS.test(pin.assetId) || typeof pin.sha256 !== 'string' || !HASH.test(pin.sha256) ||
      typeof pin.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(pin.reviewedAt)) {
    fail('The reviewed visual baseline pin is invalid.')
  }
  const reviewed = new Date(pin.reviewedAt)
  if (!Number.isFinite(reviewed.valueOf()) || reviewed.toISOString() !== pin.reviewedAt.replace(/Z$/, pin.reviewedAt.includes('.') ? 'Z' : '.000Z')) {
    fail('The reviewed visual baseline timestamp is invalid.')
  }
  provenance(pin)
  return pin
}

function png(bytes, name) {
  if (bytes.length < 57 || bytes.length > MAX_PNG_BYTES || !bytes.subarray(0, 8).equals(SIGNATURE)) fail('A visual baseline PNG is invalid.')
  const [, width, height] = /-visual-(\d+)x(\d+)-linux\.png$/.exec(name)
  let offset = 8
  let seenHeader = false
  let seenData = false
  let seenEnd = false
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) fail('A visual baseline PNG is truncated.')
    const length = bytes.readUInt32BE(offset)
    if (length > bytes.length - offset - 12) fail('A visual baseline PNG is truncated.')
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    if (!/^[A-Za-z]{4}$/.test(type)) fail('A visual baseline PNG chunk is invalid.')
    const end = offset + 8 + length
    if (crc32(bytes.subarray(offset + 4, end)) !== bytes.readUInt32BE(end)) fail('A visual baseline PNG checksum is invalid.')
    if (!seenHeader && type !== 'IHDR') fail('A visual baseline PNG header is invalid.')
    if (type === 'IHDR') {
      if (seenHeader || length !== 13 || bytes.readUInt32BE(offset + 8) !== Number(width) || bytes.readUInt32BE(offset + 12) !== Number(height) ||
          bytes[offset + 16] !== 8 || ![2, 6].includes(bytes[offset + 17]) ||
          bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0) {
        fail('A visual baseline PNG does not match its viewport or renderer format.')
      }
      seenHeader = true
    }
    if (type === 'IDAT') seenData = true
    if (type === 'IEND') {
      if (length !== 0 || !seenData || end + 4 !== bytes.length) fail('A visual baseline PNG ending is invalid.')
      seenEnd = true
    }
    offset = end + 4
  }
  if (!seenEnd) fail('A visual baseline PNG is incomplete.')
}

function decodeFile(file) {
  if (!exactObject(file, ['name', 'sha256', 'data']) || typeof file.name !== 'string' || !EXPECTED_NAMES.has(file.name) ||
      typeof file.sha256 !== 'string' || !HASH.test(file.sha256) || typeof file.data !== 'string' ||
      file.data.length > Math.ceil(MAX_PNG_BYTES / 3) * 4 ||
      file.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) {
    fail('A visual baseline file entry is invalid.')
  }
  const bytes = Buffer.from(file.data, 'base64')
  if (bytes.toString('base64') !== file.data) fail('A visual baseline image is not canonical base64.')
  if (hash(bytes) !== file.sha256) fail('A visual baseline image checksum does not match.')
  png(bytes, file.name)
  return bytes
}

export function validateVisualBaselineBundle(raw, { pin } = {}) {
  if (!(raw instanceof Uint8Array) || raw.byteLength === 0 || raw.byteLength > MAX_BUNDLE_BYTES) fail('The visual baseline bundle size is invalid.')
  const bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
  if (pin) {
    validateBaselinePin(pin)
    // Check the pinned raw bytes before parsing or trusting any bundle content.
    if (hash(bytes) !== pin.sha256) fail('The visual baseline bundle checksum does not match the reviewed pin.')
  }
  let bundle
  try { bundle = JSON.parse(bytes.toString('utf8')) } catch { fail('The visual baseline bundle is not valid JSON.') }
  if (!exactObject(bundle, ['schemaVersion', 'renderer', 'playwrightVersion', 'sourceCommit', 'sourceRunId', 'files']) ||
      bundle.schemaVersion !== 1 || !Array.isArray(bundle.files) || bundle.files.length !== EXPECTED_FILES.length) {
    fail('The visual baseline bundle schema or file count is invalid.')
  }
  provenance(bundle)
  if (pin && ['renderer', 'playwrightVersion', 'sourceCommit', 'sourceRunId'].some((field) => bundle[field] !== pin[field])) {
    fail('The visual baseline bundle provenance does not match the reviewed pin.')
  }
  for (let index = 0; index < EXPECTED_FILES.length; index++) {
    if (bundle.files[index]?.name !== EXPECTED_FILES[index]) fail('The visual baseline bundle must contain the exact sorted set of 32 PNGs.')
    decodeFile(bundle.files[index])
  }
  return bundle
}

function inside(candidate, root) {
  const difference = relative(root, candidate)
  return difference === '' || (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference))
}

async function canonicalProspectivePath(value) {
  const pending = []
  let current = value
  for (;;) {
    try { return join(await realpath(current), ...pending.reverse()) } catch (error) {
      if (error?.code !== 'ENOENT') fail('The visual baseline path is not accessible.')
      const parent = dirname(current)
      if (parent === current) fail('The visual baseline path is not accessible.')
      pending.push(basename(current))
      current = parent
    }
  }
}

async function externalDestination(value, { repoRoot = REPO_ROOT, playwrightOutputDirectories = [] } = {}) {
  if (typeof value !== 'string' || !isAbsolute(value)) fail('An absolute external visual baseline output path is required.')
  const target = await canonicalProspectivePath(resolve(value))
  const root = await canonicalProspectivePath(resolve(repoRoot))
  const blocked = [root, resolve(repoRoot, 'test-results'), resolve(repoRoot, 'playwright-report'), '/tmp/inventory-flow-qa', ...playwrightOutputDirectories]
  for (const directory of blocked) {
    if (typeof directory !== 'string' || !isAbsolute(directory)) fail('A Playwright output path is invalid.')
    if (inside(target, await canonicalProspectivePath(resolve(directory)))) fail('Visual baselines must stay outside the repository and Playwright output directories.')
  }
  // A new destination prevents overwriting baselines or following an existing
  // file link. No cleanup or recursive deletion is ever performed here.
  try { await lstat(target); fail('The visual baseline output already exists.') } catch (error) {
    if (error instanceof VisualBaselineError) throw error
    if (error?.code !== 'ENOENT') fail('The visual baseline output is not accessible.')
  }
  try { if (!(await lstat(dirname(target))).isDirectory()) fail('The visual baseline output parent must be an existing directory.') } catch (error) {
    if (error instanceof VisualBaselineError) throw error
    fail('The visual baseline output parent must be an existing directory.')
  }
  return target
}

export async function packVisualBaselines({ directory, sourceCommit, sourceRunId }) {
  try {
    provenance({ renderer: RENDERER, playwrightVersion: PLAYWRIGHT_VERSION, sourceCommit, sourceRunId })
    if (typeof directory !== 'string' || !isAbsolute(directory) || !(await lstat(directory)).isDirectory()) fail('An absolute screenshot directory is required.')
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    if (entries.length !== EXPECTED_FILES.length || entries.some((entry, index) => !entry.isFile() || entry.name !== EXPECTED_FILES[index])) {
      fail('The screenshot directory must contain exactly the 32 expected PNGs.')
    }
    const files = []
    let total = 0
    for (const entry of entries) {
      const file = await open(join(directory, entry.name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      let bytes
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > MAX_PNG_BYTES) fail('A visual baseline PNG size is invalid.')
        // Read at most the checked size plus one byte. A file growing or being
        // replaced during packaging must not turn a size check into an
        // unbounded read, and links cannot replace the reviewed input file.
        const buffer = Buffer.alloc(stat.size + 1)
        let count = 0
        while (count < buffer.length) {
          const { bytesRead } = await file.read(buffer, count, buffer.length - count, null)
          if (!bytesRead) break
          count += bytesRead
        }
        if (count > stat.size) fail('A visual baseline PNG changed during packaging.')
        bytes = buffer.subarray(0, count)
      } finally { await file.close() }
      png(bytes, entry.name)
      const data = bytes.toString('base64')
      total += data.length
      if (total > MAX_BUNDLE_BYTES) fail('The visual baseline bundle is too large.')
      files.push({ name: entry.name, sha256: hash(bytes), data })
    }
    const bundle = { schemaVersion: 1, renderer: RENDERER, playwrightVersion: PLAYWRIGHT_VERSION, sourceCommit, sourceRunId, files }
    const bytes = Buffer.from(`${JSON.stringify(bundle)}\n`)
    validateVisualBaselineBundle(bytes)
    return { bundle, bytes, sha256: hash(bytes) }
  } catch (error) {
    if (error instanceof VisualBaselineError) throw error
    fail('Unable to package the visual baselines.')
  }
}

async function boundedResponse(response) {
  const declared = response.headers.get('content-length')
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_BUNDLE_BYTES) {
    await response.body?.cancel()
    fail('The visual baseline download is too large.')
  }
  if (!response.body) fail('The visual baseline download is empty.')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BUNDLE_BYTES) { await reader.cancel(); fail('The visual baseline download is too large.') }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks, size)
}

export async function fetchPinnedBaselineAsset(pin, { token = process.env.GITHUB_TOKEN, fetchImpl = globalThis.fetch } = {}) {
  validateBaselinePin(pin)
  if (typeof token !== 'string' || !token.trim() || /\s/.test(token)) fail('GITHUB_TOKEN is required to download the pinned visual baseline asset.')
  let url = `https://api.github.com/repos/${REPOSITORY}/releases/assets/${pin.assetId}`
  const signal = AbortSignal.timeout(30_000)
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const headers = { Accept: 'application/octet-stream', 'User-Agent': 'inventory-flow-visual-baselines' }
      // The token is sent to one fixed same-repository API endpoint only.
      if (redirects === 0) headers.Authorization = `Bearer ${token}`
      const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', headers, signal })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location || redirects === 3) fail('The visual baseline asset redirect is invalid.')
        const next = new URL(location, url)
        if (next.protocol !== 'https:' || next.username || next.password || next.port || !ASSET_HOSTS.has(next.hostname)) {
          fail('The visual baseline asset redirect is not permitted.')
        }
        url = next.href
        continue
      }
      if (response.status !== 200) {
        await response.body?.cancel()
        fail('The pinned visual baseline asset could not be downloaded.')
      }
      return await boundedResponse(response)
    }
  } catch (error) {
    if (error instanceof VisualBaselineError) throw error
    fail('The pinned visual baseline asset could not be downloaded.')
  }
  fail('The pinned visual baseline asset could not be downloaded.')
}

export async function restoreVisualBaselines({ pin, outputDirectory, repoRoot = REPO_ROOT, playwrightOutputDirectories = [], token, fetchImpl }) {
  try {
    validateBaselinePin(pin)
    const directory = await externalDestination(outputDirectory, { repoRoot, playwrightOutputDirectories })
    const bytes = await fetchPinnedBaselineAsset(pin, { token, fetchImpl })
    const bundle = validateVisualBaselineBundle(bytes, { pin })
    // No directory or file exists until every image and all provenance pass.
    await mkdir(directory, { mode: 0o700 })
    for (const file of bundle.files) {
      const handle = await open(join(directory, file.name), 'wx', 0o600)
      try { await handle.writeFile(Buffer.from(file.data, 'base64')) } finally { await handle.close() }
    }
    return { directory, fileCount: bundle.files.length, sha256: hash(bytes) }
  } catch (error) {
    if (error instanceof VisualBaselineError) throw error
    fail('Unable to restore the reviewed visual baselines.')
  }
}

export async function main(args = process.argv.slice(2), environment = process.env) {
  const [command, ...options] = args
  const values = new Map()
  for (let index = 0; index < options.length; index += 2) {
    const key = options[index]
    if (!['--dir', '--out', '--pin'].includes(key) || !options[index + 1] || options[index + 1].startsWith('--') || values.has(key)) fail('Invalid visual baseline command arguments.')
    values.set(key, options[index + 1])
  }
  if (command === 'pack' && values.size === 2 && values.has('--dir') && values.has('--out')) {
    const destination = await externalDestination(values.get('--out'))
    const result = await packVisualBaselines({ directory: values.get('--dir'), sourceCommit: environment.GITHUB_SHA, sourceRunId: environment.GITHUB_RUN_ID })
    const handle = await open(destination, 'wx', 0o600)
    try { await handle.writeFile(result.bytes) } finally { await handle.close() }
    return { fileCount: EXPECTED_FILES.length, sha256: result.sha256, sourceCommit: result.bundle.sourceCommit, sourceRunId: result.bundle.sourceRunId, renderer: RENDERER, playwrightVersion: PLAYWRIGHT_VERSION }
  }
  if (command === 'restore' && (values.size === 0 || (values.size === 1 && values.has('--pin')))) {
    let pin
    try {
      const location = resolve(values.get('--pin') ?? join(REPO_ROOT, 'tests/visual/baseline-pin.json'))
      if ((await lstat(location)).size > 8192) fail('The reviewed visual baseline pin is too large.')
      pin = JSON.parse(await readFile(location, 'utf8'))
    } catch (error) {
      if (error instanceof VisualBaselineError) throw error
      fail('Unable to read the reviewed visual baseline pin.')
    }
    return restoreVisualBaselines({ pin, outputDirectory: environment.INVENTORY_VISUAL_BASELINE_DIR, token: environment.GITHUB_TOKEN })
  }
  fail('Use visual-baselines.mjs pack --dir ABSOLUTE --out ABSOLUTE, or restore --pin FILE.')
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error instanceof VisualBaselineError ? error.message : 'The visual baseline command failed.')
    process.exitCode = 1
  })
}
