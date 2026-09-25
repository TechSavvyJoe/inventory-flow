// @ts-nocheck -- exercises a standalone Node ESM release helper.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EXPECTED_FILES, MAX_BUNDLE_BYTES, PLAYWRIGHT_VERSION, RENDERER, REPOSITORY,
  fetchPinnedBaselineAsset, main, packVisualBaselines, restoreVisualBaselines,
  validateBaselinePin, validateVisualBaselineBundle,
} from '../../scripts/visual-baselines.mjs'

const sourceCommit = 'a'.repeat(40)
const sourceRunId = '123456789'
const token = 'synthetic-visual-token-never-use-live'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const raw = (bundle) => Buffer.from(JSON.stringify(bundle))
const images = new Map()

function chunk(type, data) {
  const result = Buffer.alloc(data.length + 12)
  result.writeUInt32BE(data.length)
  result.write(type, 4, 'ascii')
  data.copy(result, 8)
  result.writeUInt32BE(crc32(result.subarray(4, result.length - 4)), result.length - 4)
  return result
}

function png(width, height) {
  const key = `${width}x${height}`
  if (!images.has(key)) {
    const header = Buffer.alloc(13)
    header.writeUInt32BE(width); header.writeUInt32BE(height, 4)
    header[8] = 8; header[9] = 2
    const scanlines = Buffer.alloc((width * 3 + 1) * height)
    images.set(key, Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
      chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0)),
    ]))
  }
  return images.get(key)
}

let temporary, directory, repoRoot, packed
beforeEach(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'inventory-visual-baselines-test-'))
  directory = join(temporary, 'screenshots')
  repoRoot = join(temporary, 'repository')
  await mkdir(directory); await mkdir(repoRoot)
  for (const name of EXPECTED_FILES) {
    const [, width, height] = /-visual-(\d+)x(\d+)-linux\.png$/.exec(name)
    await writeFile(join(directory, name), png(Number(width), Number(height)))
  }
  packed = await packVisualBaselines({ directory, sourceCommit, sourceRunId })
})
afterEach(async () => {
  // This is the test's own freshly allocated directory, never a caller path.
  await rm(temporary, { recursive: true, force: true })
})

function pinFor(bytes = packed.bytes, extra = {}) {
  return {
    schemaVersion: 1, repository: REPOSITORY, renderer: RENDERER, playwrightVersion: PLAYWRIGHT_VERSION,
    sourceCommit, sourceRunId, assetId: '987654321', sha256: digest(bytes), fileCount: 32,
    reviewedAt: '2026-09-25T17:00:00Z', ...extra,
  }
}

function restore(options = {}) {
  return restoreVisualBaselines({
    pin: pinFor(), outputDirectory: join(temporary, 'restored'), repoRoot, token,
    fetchImpl: vi.fn(async () => new Response(packed.bytes)), ...options,
  })
}

describe('reviewed external visual baseline bundles', () => {
  it('packs deterministic bytes and restores the complete validated set without overwriting', async () => {
    expect(packed.bundle.files.map((file) => file.name)).toEqual(EXPECTED_FILES)
    expect(packed.sha256).toBe(digest(packed.bytes))
    expect((await packVisualBaselines({ directory, sourceCommit, sourceRunId })).bytes).toEqual(packed.bytes)
    expect(validateVisualBaselineBundle(packed.bytes, { pin: pinFor() })).toEqual(packed.bundle)
    const result = await restore()
    expect(result).toMatchObject({ fileCount: 32, sha256: packed.sha256 })
    expect((await readdir(result.directory)).sort()).toEqual(EXPECTED_FILES)
    for (const file of packed.bundle.files) expect(await readFile(join(result.directory, file.name))).toEqual(Buffer.from(file.data, 'base64'))
    await expect(restore()).rejects.toThrow('already exists')
    expect(await readFile(join(result.directory, EXPECTED_FILES[0]))).toEqual(Buffer.from(packed.bundle.files[0].data, 'base64'))
  })

  it('checks the raw pinned digest before parsing and never creates output on a bad bundle', async () => {
    const invalid = Buffer.from('SECRET-NOT-JSON')
    expect(() => validateVisualBaselineBundle(invalid, { pin: pinFor() })).toThrow('checksum')
    await expect(restore({ fetchImpl: async () => new Response(invalid) })).rejects.toThrow('checksum')
    await expect(stat(join(temporary, 'restored'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['sourceCommit', 'sourceRunId', 'renderer', 'playwrightVersion'])('rejects mismatched %s provenance', (field) => {
    const bundle = structuredClone(packed.bundle)
    bundle[field] = field === 'sourceCommit' ? 'b'.repeat(40) : field === 'sourceRunId' ? '222222' : 'unexpected-renderer'
    const bytes = raw(bundle)
    expect(() => validateVisualBaselineBundle(bytes, { pin: pinFor(bytes) })).toThrow('provenance')
  })

  it.each([
    { repository: 'another-owner/inventory-flow' }, { assetId: '../latest' }, { sourceCommit: 'main' },
    { sourceRunId: 123 }, { fileCount: 31 }, { reviewedAt: '2026-02-30T17:00:00Z' },
    { reviewedAt: '2026-09-25' }, { sha256: 'f'.repeat(63) }, { schemaVersion: 2 },
  ])('rejects an invalid or unreviewable pin before any network request: %j', async (change) => {
    const fetchImpl = vi.fn()
    await expect(restore({ pin: pinFor(packed.bytes, change), fetchImpl })).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(['missing', 'extra', 'duplicate', 'traversal', 'wrong-platform', 'unsorted'])('rejects the %s filename case', (kind) => {
    const bundle = structuredClone(packed.bundle)
    if (kind === 'missing') bundle.files.pop()
    if (kind === 'extra') bundle.files.push(bundle.files[0])
    if (kind === 'duplicate') bundle.files[1] = bundle.files[0]
    if (kind === 'traversal') bundle.files[0].name = '../outside.png'
    if (kind === 'wrong-platform') bundle.files[0].name = bundle.files[0].name.replace('-linux', '-darwin')
    if (kind === 'unsorted') bundle.files.reverse()
    expect(() => validateVisualBaselineBundle(raw(bundle))).toThrow()
  })

  it('rejects noncanonical base64, individual digest corruption and PNG corruption even with a recomputed digest', () => {
    const altered = (change) => { const bundle = structuredClone(packed.bundle); change(bundle.files[0]); return raw(bundle) }
    expect(() => validateVisualBaselineBundle(altered((file) => { file.data += '\n' }))).toThrow('entry')
    expect(() => validateVisualBaselineBundle(altered((file) => { file.data = 'AR=='; file.sha256 = digest(Buffer.from([1])) }))).toThrow('canonical')
    expect(() => validateVisualBaselineBundle(altered((file) => { file.sha256 = '0'.repeat(64) }))).toThrow('checksum')
    for (const index of [0, 20, 40]) {
      expect(() => validateVisualBaselineBundle(altered((file) => {
        const bytes = Buffer.from(file.data, 'base64'); bytes[index] ^= 1
        file.data = bytes.toString('base64'); file.sha256 = digest(bytes)
      }))).toThrow('PNG')
    }
  })

  it('rejects viewport substitution and validates the last file before writing any images', async () => {
    const bundle = structuredClone(packed.bundle)
    const wrong = png(7, 9)
    bundle.files.at(-1).data = wrong.toString('base64')
    bundle.files.at(-1).sha256 = digest(wrong)
    const bytes = raw(bundle)
    await expect(restore({ pin: pinFor(bytes), fetchImpl: async () => new Response(bytes) })).rejects.toThrow('viewport')
    await expect(stat(join(temporary, 'restored'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses extra source files and source symlinks rather than packaging unrelated content', async () => {
    await writeFile(join(directory, 'extra.png'), png(7, 9))
    await expect(packVisualBaselines({ directory, sourceCommit, sourceRunId })).rejects.toThrow('exactly')
    await rm(join(directory, 'extra.png'))
    await rm(join(directory, EXPECTED_FILES[0]))
    await symlink(join(directory, EXPECTED_FILES[1]), join(directory, EXPECTED_FILES[0]))
    await expect(packVisualBaselines({ directory, sourceCommit, sourceRunId })).rejects.toThrow('exactly')
  })

  it('uses the exact same-repository asset endpoint and never sends its bearer token through a redirect', async () => {
    const signed = 'https://release-assets.githubusercontent.com/synthetic/baselines?signature=synthetic'
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: signed } }))
      .mockResolvedValueOnce(new Response(packed.bytes))
    expect(await fetchPinnedBaselineAsset(pinFor(), { token, fetchImpl })).toEqual(packed.bytes)
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://api.github.com/repos/${REPOSITORY}/releases/assets/987654321`)
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'manual', headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream' } })
    expect(fetchImpl.mock.calls[1][0]).toBe(signed)
    expect(fetchImpl.mock.calls[1][1].headers).not.toHaveProperty('Authorization')
    expect(JSON.stringify(fetchImpl.mock.calls[1])).not.toContain(token)
  })

  it.each([
    'https://evil.example/baseline.json', 'http://release-assets.githubusercontent.com/file',
    'https://api.github.com/repos/another-owner/repo/releases/assets/1',
    'https://user:password@release-assets.githubusercontent.com/file', 'file:///tmp/baselines',
  ])('rejects unsafe asset redirects without contacting them: %s', async (location) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location } }))
    await expect(fetchPinnedBaselineAsset(pinFor(), { token, fetchImpl })).rejects.toThrow('redirect')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('requires authentication and reports download failures without echoing tokens or server content', async () => {
    const noAuth = vi.fn()
    await expect(fetchPinnedBaselineAsset(pinFor(), { token: '', fetchImpl: noAuth })).rejects.toThrow('GITHUB_TOKEN')
    expect(noAuth).not.toHaveBeenCalled()
    const unauthorized = vi.fn(async () => new Response(`SERVER-SECRET ${token}`, { status: 401 }))
    const failure = await fetchPinnedBaselineAsset(pinFor(), { token, fetchImpl: unauthorized }).catch((error) => error)
    expect(failure.message).toBe('The pinned visual baseline asset could not be downloaded.')
    expect(unauthorized).toHaveBeenCalledTimes(1)
    const networkFailure = await fetchPinnedBaselineAsset(pinFor(), { token, fetchImpl: async () => { throw new Error(`NETWORK-SECRET ${token}`) } }).catch((error) => error)
    expect(networkFailure.message).not.toMatch(/SECRET|synthetic-visual-token/)
  })

  it('bounds declared and streaming response sizes without trusting content-length', async () => {
    await expect(fetchPinnedBaselineAsset(pinFor(), { token, fetchImpl: async () => new Response('x', { headers: { 'content-length': String(MAX_BUNDLE_BYTES + 1) } }) })).rejects.toThrow('too large')
    const data = new Uint8Array(1024 * 1024)
    const cancel = vi.fn()
    let reads = 0
    const response = { status: 200, headers: new Headers(), body: { getReader: () => ({
      read: async () => { reads++; return { value: data, done: false } }, cancel, releaseLock: vi.fn(),
    }) } }
    await expect(fetchPinnedBaselineAsset(pinFor(), { token, fetchImpl: async () => response })).rejects.toThrow('too large')
    expect(reads).toBe(65)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects missing, relative, repository, Playwright-output and symlink-to-repository destinations', async () => {
    const output = join(temporary, 'playwright-output')
    await mkdir(output)
    const link = join(temporary, 'repo-link')
    await symlink(repoRoot, link, 'dir')
    for (const outputDirectory of [undefined, 'relative-baselines', join(repoRoot, 'baselines'), join(output, 'baselines'), join(link, 'baselines')]) {
      const fetchImpl = vi.fn()
      await expect(restore({ outputDirectory, playwrightOutputDirectories: [output], fetchImpl })).rejects.toThrow()
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('keeps unrelated existing destination files intact', async () => {
    const outputDirectory = join(temporary, 'existing')
    await mkdir(outputDirectory)
    await writeFile(join(outputDirectory, 'unrelated.txt'), 'SYNTHETIC fixture sentinel')
    await expect(restore({ outputDirectory })).rejects.toThrow('already exists')
    expect(await readFile(join(outputDirectory, 'unrelated.txt'), 'utf8')).toBe('SYNTHETIC fixture sentinel')
  })

  it('packages the actual CLI inputs on any platform using only explicit source-run provenance', async () => {
    const destination = join(temporary, 'bundle.json')
    const result = await main(['pack', '--dir', directory, '--out', destination], { GITHUB_SHA: sourceCommit, GITHUB_RUN_ID: sourceRunId })
    expect(result).toMatchObject({ sha256: packed.sha256, fileCount: 32, sourceCommit, sourceRunId })
    expect(await readFile(destination)).toEqual(packed.bytes)
    await expect(main(['pack', '--dir', directory, '--out', join(temporary, 'missing-provenance.json')], {})).rejects.toThrow('provenance')
    await expect(main(['pack', '--dir', directory, '--out', destination], { GITHUB_SHA: sourceCommit, GITHUB_RUN_ID: sourceRunId })).rejects.toThrow('already exists')
  })
})
